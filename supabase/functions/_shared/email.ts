import { backoffSeconds } from './calendar-job.ts'
import {
  renderAccountEmail,
  renderMessage,
  renderStaffAlert,
  type RenderedMessage,
} from './messages.ts'
import type { BookingContext, Communication, Db } from './types.ts'

export type OutgoingEmail = {
  to: string
  subject: string
  text: string
  /** Branded HTML part; the plain-text part is always sent alongside it. */
  html?: string
  idempotencyKey: string
}

export class MailError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'MailError'
    this.retryable = retryable
  }
}

export interface Mailer {
  /** Resolves to the provider's message id. */
  send(email: OutgoingEmail): Promise<string | null>
}

/** Resend's HTTP API. Its Idempotency-Key header makes a retried send a no-op for 24 hours. */
export function createResendMailer(opts: {
  apiKey: string
  from: string
  fetch?: typeof fetch
}): Mailer {
  const doFetch = opts.fetch ?? fetch
  return {
    async send(email) {
      let res: Response
      try {
        res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': email.idempotencyKey,
          },
          body: JSON.stringify({
            from: opts.from,
            to: [email.to],
            subject: email.subject,
            text: email.text,
            ...(email.html ? { html: email.html } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        })
      } catch (error) {
        throw new MailError(`Email provider unreachable: ${String(error)}`, true)
      }
      const body = await res.text()
      if (!res.ok) {
        throw new MailError(
          `Email provider said HTTP ${res.status}: ${body.slice(0, 200)}`,
          res.status === 429 || res.status >= 500,
        )
      }
      try {
        return (JSON.parse(body) as { id?: string }).id ?? null
      } catch {
        return null
      }
    },
  }
}

/** Addresses that must never be mailed: reserved test domains (RFC 2606) used by our own tests. */
export function isSuppressed(address: string): boolean {
  return /@(?:[^@]+\.)?(example\.(?:com|org|net)|[^@]+\.(?:invalid|test|example))$/i.test(
    address.trim(),
  )
}

export { firstName } from './messages.ts'

export type CommunicationDeps = {
  db: Db
  mailer: Mailer
  appUrl: string
  now?: () => number
  /** Staff account emails: who the person is, and a fresh single-use set-password token hash. */
  accounts?: {
    displayName(userId: string): Promise<string | null>
    recoveryTokenHash(email: string): Promise<string>
  }
}

/** The set-password page; GoTrue's token hash is verified there with verifyOtp. */
export function setPasswordUrl(appUrl: string, tokenHash: string, template: string): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type: 'recovery' })
  if (template === 'staff_invite') params.set('welcome', '1')
  return `${appUrl}/#/staff/set-password?${params.toString()}`
}

/** Why a queued message should not go out any more, or null to send it. */
export function staleReason(comm: Communication, ctx: BookingContext, now: number): string | null {
  const start = ctx.booking.starts_at
  const same = (a: string | null | undefined) =>
    a !== null && a !== undefined && Date.parse(a) === Date.parse(start)
  switch (comm.template) {
    case 'booking_reminder':
      if (ctx.booking.state !== 'confirmed') return 'Not sent: booking is not confirmed'
      if (!same(comm.about_start)) return 'Not sent: booking moved'
      if (Date.parse(start) <= now) return 'Not sent: appointment already started'
      return null
    case 'booking_rescheduled':
      if (ctx.booking.state === 'cancelled') return 'Not sent: booking cancelled'
      if (!same(comm.about_start)) return 'Not sent: booking moved again'
      return null
    case 'booking_cancelled':
      return ctx.booking.state === 'cancelled' ? null : 'Not sent: booking is no longer cancelled'
    case 'booking_confirmation':
      return ctx.booking.state === 'cancelled' ? 'Not sent: booking cancelled' : null
    default:
      return null
  }
}

/** Send one claimed message. The dedupe key doubles as the provider idempotency key. */
export async function processCommunication(
  comm: Communication,
  deps: CommunicationDeps,
): Promise<'sent' | 'retrying' | 'failed' | 'skipped'> {
  const { db } = deps
  if (isSuppressed(comm.recipient)) {
    await db.communicationSkipped(comm.id, 'Not sent: reserved test address')
    return 'skipped'
  }
  if (comm.template === 'staff_invite' || comm.template === 'staff_password_reset') {
    const name = comm.staff_user_id ? await deps.accounts?.displayName(comm.staff_user_id) : null
    if (!deps.accounts || !name) {
      await db.communicationSkipped(comm.id, 'Staff member no longer active')
      return 'skipped'
    }
    let link: string
    try {
      // Generated now, not when queued: no usable token is ever stored, and a retry gets a new one.
      link = setPasswordUrl(
        deps.appUrl,
        await deps.accounts.recoveryTokenHash(comm.recipient),
        comm.template,
      )
    } catch (error) {
      const final = comm.attempts >= comm.max_attempts
      await db.communicationRetry(
        comm.id,
        String(error instanceof Error ? error.message : error),
        backoffSeconds(comm.attempts),
        final,
      )
      return final ? 'failed' : 'retrying'
    }
    return send(
      comm,
      deps,
      renderAccountEmail(comm.template, { displayName: name, link, siteUrl: deps.appUrl }),
    )
  }
  if (comm.template === 'staff_new_enquiry' || comm.template === 'staff_callback_request') {
    const summary = comm.enquiry_id ? await db.enquirySummary(comm.enquiry_id) : null
    if (!summary) {
      await db.communicationSkipped(comm.id, 'Enquiry no longer exists')
      return 'skipped'
    }
    const message = renderStaffAlert(comm.template, {
      summary,
      staffUrl: `${deps.appUrl}/#/staff/enquiries/${summary.id}`,
      siteUrl: deps.appUrl,
      wording: await db.getWording(),
    })
    return send(comm, deps, message)
  }
  const ctx = comm.booking_id ? await db.bookingContext(comm.booking_id) : null
  if (!ctx) {
    await db.communicationRetry(comm.id, 'Booking not found for this message', 0, true)
    return 'failed'
  }
  const stale = staleReason(comm, ctx, (deps.now ?? Date.now)())
  if (stale) {
    await db.communicationSkipped(comm.id, stale)
    return 'skipped'
  }
  const settings = await db.getSettings()
  const token = await db.mintAccessToken(ctx.enquiry.id)
  const message = renderMessage(comm.template, {
    ctx,
    manageUrl: `${deps.appUrl}/#/book/${token}`,
    businessPhone: settings.business_phone,
    cancelledStart: comm.about_start ?? null,
    privacyUrl: `${deps.appUrl}/#/privacy`,
    siteUrl: deps.appUrl,
    wording: await db.getWording(),
  })
  return send(comm, deps, message)
}

async function send(
  comm: Communication,
  deps: CommunicationDeps,
  message: RenderedMessage,
): Promise<'sent' | 'retrying' | 'failed'> {
  const { db, mailer } = deps
  try {
    const id = await mailer.send({
      to: comm.recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      idempotencyKey: comm.dedupe_key,
    })
    await db.communicationSent(comm.id, id)
    return 'sent'
  } catch (error) {
    const retryable = error instanceof MailError ? error.retryable : true
    const final = !retryable || comm.attempts >= comm.max_attempts
    await db.communicationRetry(
      comm.id,
      String(error instanceof Error ? error.message : error),
      backoffSeconds(comm.attempts),
      final,
    )
    return final ? 'failed' : 'retrying'
  }
}
