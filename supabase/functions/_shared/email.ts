import { STAFF_URL } from './site.ts'
import { backoffSeconds } from './calendar-job.ts'
import type { PdfMaker } from './pdf.ts'
import {
  longDate,
  quoteFooterHtml,
  renderQuoteDocument,
  type QuoteDocumentInput,
} from './quote-document.ts'
import type { QuoteFiles } from './storage.ts'
import { toLocal } from './time.ts'
import {
  choiceLabel,
  renderAccountEmail,
  renderEstimate,
  renderQuoteEmail,
  renderVisitLink,
  renderMessage,
  renderStaffAlert,
  type RenderedMessage,
} from './messages.ts'
import type { BookingContext, Communication, Db, QuoteRow } from './types.ts'

export type OutgoingEmail = {
  to: string
  subject: string
  text: string
  /** Branded HTML part; the plain-text part is always sent alongside it. */
  html?: string
  idempotencyKey: string
  /** Files sent with it (the quote PDF). */
  attachments?: { filename: string; content: Uint8Array }[]
}

/** Bytes as base64, in chunks (no stack overflow on a large file). */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
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
            ...(email.attachments?.length
              ? {
                  attachments: email.attachments.map((a) => ({
                    filename: a.filename,
                    content: toBase64(a.content),
                  })),
                }
              : {}),
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
  /** The staff console (default STAFF_URL). */
  staffUrl?: string
  now?: () => number
  /** Staff account emails: who the person is, and a fresh single-use set-password token hash. */
  accounts?: {
    displayName(userId: string): Promise<string | null>
    recoveryTokenHash(email: string): Promise<string>
  }
  /** Quote emails: the PDF maker and the private bucket; without them a quote waits (retries). */
  quotes?: { pdf: PdfMaker; files: QuoteFiles }
}

/** The customer's quote pages (token in the path, as booking links). */
export function quotePageUrl(
  appUrl: string,
  token: string,
  quoteId: string,
  page?: 'deposit' | 'change',
) {
  return `${appUrl}/#/quote/${token}/${quoteId}${page ? `/${page}` : ''}`
}

/** The file name of the stored PDF and the attachment: "Q3-Q-0001.pdf", "Q3-Q-0001-v2.pdf". */
export const quotePdfName = (number: string, version: number) =>
  `${number}${version > 1 ? `-v${version}` : ''}.pdf`

/** The document's inputs from a quote, its enquiry and the business details. */
export async function quoteDocumentFor(
  db: Db,
  quote: QuoteRow,
  fontBase: string,
): Promise<QuoteDocumentInput | null> {
  const enquiry = await db.getEnquiry(quote.enquiry_id)
  if (!enquiry) return null
  const summary = await db.enquirySummary(quote.enquiry_id)
  const business = await db.businessDetails()
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const project = summary ? choiceLabel(summary, 'project_type') : null
  const area = text(enquiry.answers.location)
  return {
    number: quote.number,
    version: quote.version,
    sentOn: toLocal(Date.parse(quote.sent_at)).date,
    validUntil: quote.valid_until,
    customerName: text(enquiry.answers.name) ?? '',
    jobAddress: text(enquiry.site_details?.site_address),
    jobLine: [project, area].filter(Boolean).join(', ') || null,
    business: {
      legalName: business?.legal_name ?? business?.trading_name ?? null,
      phone: business?.contact_phone ?? null,
      email: business?.contact_email ?? null,
    },
    included: quote.included,
    excluded: quote.excluded,
    note: quote.note,
    price: quote.price_eur,
    depositPercent: Number(quote.deposit_percent),
    depositEur: quote.deposit_eur,
    terms: quote.terms,
    fontBase,
  }
}

/** The customer's "Get my quote" page for one estimate (token in the path, as booking links). */
export function quoteUrl(appUrl: string, token: string, estimateId: string): string {
  return `${appUrl}/#/estimate/${token}/${estimateId}`
}

/** The booking page on the time step with a site visit chosen (after a call). */
export function visitLinkUrl(appUrl: string, token: string): string {
  return `${appUrl}/#/book/${token}?visit=1`
}

/** The set-password page; GoTrue's token hash is verified there with verifyOtp. */
export function setPasswordUrl(staffUrl: string, tokenHash: string, template: string): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type: 'recovery' })
  if (template === 'staff_invite') params.set('welcome', '1')
  return `${staffUrl}/#/set-password?${params.toString()}`
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
        deps.staffUrl ?? STAFF_URL,
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
      renderAccountEmail(comm.template, {
        displayName: name,
        link,
        siteUrl: deps.appUrl,
        staffUrl: deps.staffUrl ?? STAFF_URL,
      }),
    )
  }
  if (comm.template === 'estimate') {
    const estimate = comm.estimate_id ? await db.estimateById(comm.estimate_id) : null
    const enquiry = estimate ? await db.getEnquiry(estimate.enquiry_id) : null
    if (!estimate || !enquiry) {
      await db.communicationSkipped(comm.id, 'Estimate no longer exists')
      return 'skipped'
    }
    const settings = await db.getSettings()
    // A fresh 30-day token, minted at send time and never logged, like the booking links.
    const token = await db.mintAccessToken(enquiry.id)
    const name = enquiry.answers.name
    return send(
      comm,
      deps,
      renderEstimate({
        customerName: typeof name === 'string' ? name : '',
        workItems: estimate.work_items ?? [],
        note: estimate.work_looked_at,
        low: estimate.low_eur,
        high: estimate.high_eur,
        caveats: estimate.caveats,
        quoteUrl: quoteUrl(deps.appUrl, token, estimate.id),
        businessPhone: settings.business_phone,
        privacyUrl: `${deps.appUrl}/#/privacy`,
        siteUrl: deps.appUrl,
        after: estimate.after === 'call' ? 'call' : 'visit',
      }),
    )
  }
  if (comm.template === 'quote') {
    const quote = comm.quote_id ? await db.quoteById(comm.quote_id) : null
    const doc = quote ? await quoteDocumentFor(db, quote, '') : null
    if (!quote || !doc) {
      await db.communicationSkipped(comm.id, 'Quote no longer exists')
      return 'skipped'
    }
    if (!quote.current) {
      await db.communicationSkipped(comm.id, 'Not sent: a newer version of the quote was sent')
      return 'skipped'
    }
    // The PDF is made now (Gotenberg) and stored; a quote is never sent without it.
    let pdf: Uint8Array
    try {
      if (!deps.quotes) throw new Error('PDF service not configured')
      pdf = await deps.quotes.pdf(renderQuoteDocument(doc), {
        footerHtml: quoteFooterHtml(quote.number),
      })
      const path = `${quote.enquiry_id}/${quote.id}.pdf`
      await deps.quotes.files.put(path, pdf)
      if (quote.pdf_path !== path) await db.quotePdfStored(quote.id, path)
    } catch (error) {
      const final = comm.attempts >= comm.max_attempts
      await db.communicationRetry(
        comm.id,
        `Quote PDF: ${error instanceof Error ? error.message : String(error)}`,
        backoffSeconds(comm.attempts),
        final,
      )
      return final ? 'failed' : 'retrying'
    }
    const token = await db.mintAccessToken(quote.enquiry_id)
    const settings = await db.getSettings()
    const project = doc.jobLine?.split(',')[0]?.trim().toLowerCase()
    return send(
      comm,
      deps,
      renderQuoteEmail({
        customerName: doc.customerName,
        workAt: doc.jobAddress ?? (project ? `your ${project} job` : 'your home'),
        price: quote.price_eur,
        goodUntil: longDate(quote.valid_until),
        version: quote.version,
        viewUrl: quotePageUrl(deps.appUrl, token, quote.id),
        depositUrl: quotePageUrl(deps.appUrl, token, quote.id, 'deposit'),
        changeUrl: quotePageUrl(deps.appUrl, token, quote.id, 'change'),
        businessPhone: settings.business_phone,
        privacyUrl: `${deps.appUrl}/#/privacy`,
        siteUrl: deps.appUrl,
      }),
      [{ filename: quotePdfName(quote.number, quote.version), content: pdf }],
    )
  }
  if (comm.template === 'visit_link') {
    const enquiry = comm.enquiry_id ? await db.getEnquiry(comm.enquiry_id) : null
    if (!enquiry) {
      await db.communicationSkipped(comm.id, 'Enquiry no longer exists')
      return 'skipped'
    }
    // Booked meanwhile (by them or by staff): the link has nothing left to do.
    const live = await db.liveBookingFor(enquiry.id)
    if (live && Date.parse(live.starts_at) > (deps.now ?? Date.now)()) {
      await db.communicationSkipped(comm.id, 'Not sent: an appointment is already booked')
      return 'skipped'
    }
    const settings = await db.getSettings()
    // A fresh 30-day token, minted at send time and never logged, like the booking links.
    const token = await db.mintAccessToken(enquiry.id)
    const name = enquiry.answers.name
    return send(
      comm,
      deps,
      renderVisitLink({
        customerName: typeof name === 'string' ? name : '',
        bookUrl: visitLinkUrl(deps.appUrl, token),
        businessPhone: settings.business_phone,
        privacyUrl: `${deps.appUrl}/#/privacy`,
        siteUrl: deps.appUrl,
      }),
    )
  }
  if (
    comm.template === 'staff_new_enquiry' ||
    comm.template === 'staff_callback_request' ||
    comm.template === 'staff_quote_request' ||
    comm.template === 'staff_quote_change'
  ) {
    const summary = comm.enquiry_id ? await db.enquirySummary(comm.enquiry_id) : null
    if (!summary) {
      await db.communicationSkipped(comm.id, 'Enquiry no longer exists')
      return 'skipped'
    }
    const estimate =
      comm.template === 'staff_quote_request' && comm.estimate_id
        ? await db.estimateById(comm.estimate_id)
        : null
    const message = renderStaffAlert(comm.template, {
      summary,
      staffUrl: `${deps.staffUrl ?? STAFF_URL}/#/enquiries/${summary.id}`,
      siteUrl: deps.appUrl,
      wording: await db.getWording(),
      estimate: estimate
        ? { low: estimate.low_eur, high: estimate.high_eur, sentAt: estimate.sent_at }
        : null,
      quote:
        comm.template === 'staff_quote_change' && comm.quote_id
          ? await db.quoteById(comm.quote_id)
          : null,
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
  attachments: OutgoingEmail['attachments'] = [],
): Promise<'sent' | 'retrying' | 'failed'> {
  const { db, mailer } = deps
  try {
    const id = await mailer.send({
      to: comm.recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      idempotencyKey: comm.dedupe_key,
      ...(attachments.length ? { attachments } : {}),
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
