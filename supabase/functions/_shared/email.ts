import { backoffSeconds } from './calendar-job.ts'
import { formatLocal } from './time.ts'
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

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName
}

export function renderBookingConfirmation(ctx: BookingContext): { subject: string; text: string } {
  const start = Date.parse(ctx.booking.starts_at)
  const when = formatLocal(start)
  const name =
    typeof ctx.enquiry.answers.name === 'string' ? ctx.enquiry.answers.name.split(/\s+/)[0] : ''
  const phone = typeof ctx.enquiry.answers.phone === 'string' ? ctx.enquiry.answers.phone : ''
  const address = ctx.enquiry.site_details?.site_address
  const staff = firstName(ctx.staff.display_name)
  const where =
    ctx.type.mode === 'phone'
      ? `${staff} will ring you on ${phone}.`
      : `${staff} will visit you at:\n${typeof address === 'string' ? address : 'the address you gave us'}`
  const lines = [
    name ? `Hello ${name},` : 'Hello,',
    '',
    `Your ${ctx.type.label.toLowerCase()} with Q3 Interiors is booked.`,
    '',
    `When: ${when.weekday} ${when.date} at ${when.time} (Irish time)`,
    `Length: about ${ctx.type.duration_minutes} minutes`,
    where,
    '',
    `To prepare: ${ctx.type.what_to_prepare}`,
    '',
    ctx.type.mode === 'on_site'
      ? 'This visit is for us to assess and price the work. It does not commit you to a quote, and it is not a start date.'
      : 'This call is to talk your project through. It does not commit you to anything.',
    '',
    `Your reference is ${ctx.enquiry.reference}. If you need to change anything, reply to this email or quote the reference when you contact us.`,
    '',
    'Q3 Interiors',
  ]
  return {
    subject: `Booked: ${ctx.type.label}, ${when.weekday} ${when.date} at ${when.time}`,
    text: lines.join('\n'),
  }
}

export type CommunicationDeps = { db: Db; mailer: Mailer }

/** Send one claimed message. The dedupe key doubles as the provider idempotency key. */
export async function processCommunication(
  comm: Communication,
  deps: CommunicationDeps,
): Promise<'sent' | 'retrying' | 'failed'> {
  const { db, mailer } = deps
  if (isSuppressed(comm.recipient)) {
    await db.communicationRetry(comm.id, 'Not sent: reserved test address', 0, true)
    return 'failed'
  }
  const ctx = comm.booking_id ? await db.bookingContext(comm.booking_id) : null
  if (!ctx) {
    await db.communicationRetry(comm.id, 'Booking not found for this message', 0, true)
    return 'failed'
  }
  const { subject, text } = renderBookingConfirmation(ctx)
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
