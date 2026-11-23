import { backoffSeconds } from './calendar-job.ts'
import { renderMessage } from './messages.ts'
import type { BookingContext, Communication, Db } from './types.ts'

export type OutgoingEmail = { to: string; subject: string; text: string; idempotencyKey: string }

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

export type CommunicationDeps = { db: Db; mailer: Mailer; appUrl: string; now?: () => number }

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
  }
}

/** Send one claimed message. The dedupe key doubles as the provider idempotency key. */
export async function processCommunication(
  comm: Communication,
  deps: CommunicationDeps,
): Promise<'sent' | 'retrying' | 'failed' | 'skipped'> {
  const { db, mailer } = deps
  if (isSuppressed(comm.recipient)) {
    await db.communicationSkipped(comm.id, 'Not sent: reserved test address')
    return 'skipped'
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
  const { subject, text } = renderMessage(comm.template, {
    ctx,
    manageUrl: `${deps.appUrl}/#/book/${token}`,
    businessPhone: settings.business_phone,
    cancelledStart: comm.about_start ?? null,
  })
  try {
    const id = await mailer.send({
      to: comm.recipient,
      subject,
      text,
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
