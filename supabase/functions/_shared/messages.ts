// Every email's wording, in one file. PLACEHOLDER wording until Q3 Interiors confirms it:
// changing what people read is a change to this file only. Vocabulary follows the brand guide:
// an enquiry; a call or a site visit (the appointment); an estimate is a price range; a quote
// covers an agreed scope. Each message has a plain-text part and a branded HTML part.
import { formatLocal } from './time.ts'
import type { BookingContext, CustomerTemplate, EnquirySummary } from './types.ts'

export type MessageInput = {
  ctx: BookingContext
  /** Link back to the customer's booking page (change or cancel); null if unavailable. */
  manageUrl: string | null
  /** Business phone for "ring us", null while it is a placeholder. */
  businessPhone: string | null
  /** For a cancellation, the start that was cancelled. */
  cancelledStart?: string | null
  /** The privacy notice, linked from every customer email. */
  privacyUrl?: string | null
  /** The site's address (SITE_URL), for the badge image in the HTML part. */
  siteUrl?: string | null
}

export type RenderedMessage = { subject: string; text: string; html: string }

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName
}

/** The message as blocks, rendered once as text and once as HTML. */
type Draft = {
  subject: string
  /** Paragraphs; each is one or more lines. */
  paragraphs: string[][]
  action?: { label: string; url: string }
  after?: string[][]
}

const BRAND = { forest: '#415847', ink: '#1F2922', muted: '#526154', cream: '#E8E6D6' }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toText(d: Draft, footer: string[]): string {
  const blocks = [
    ...d.paragraphs.map((p) => p.join('\n')),
    ...(d.action ? [`${d.action.label}: ${d.action.url}`] : []),
    ...(d.after ?? []).map((p) => p.join('\n')),
    ...footer,
  ]
  return blocks.join('\n\n')
}

function toHtml(d: Draft, opts: { siteUrl: string | null; privacyUrl: string | null }): string {
  const p = (lines: string[]) =>
    `<p style="margin:0 0 16px;font:16px/1.55 Roboto,Arial,sans-serif;color:${BRAND.ink}">${lines
      .map(escapeHtml)
      .join('<br>')}</p>`
  const badge = opts.siteUrl
    ? `<img src="${escapeHtml(opts.siteUrl)}/brand/q3-badge-email.png" width="112" height="112" alt="Q3 Interiors" style="display:block;border:0;margin:0 0 24px">`
    : ''
  const button = d.action
    ? `<p style="margin:8px 0 24px"><a href="${escapeHtml(d.action.url)}" style="display:inline-block;background:${BRAND.forest};color:#ffffff;font:500 16px/1.4 Roboto,Arial,sans-serif;text-decoration:none;padding:12px 24px;border-radius:4px">${escapeHtml(d.action.label)}</a></p>`
    : ''
  const privacy = opts.privacyUrl
    ? `<p style="margin:24px 0 0;font:14px/1.5 Roboto,Arial,sans-serif;color:${BRAND.muted}"><a href="${escapeHtml(opts.privacyUrl)}" style="color:${BRAND.forest}">How we use your details</a></p>`
    : ''
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${escapeHtml(d.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto"><tr><td>
${badge}${d.paragraphs.map(p).join('\n')}${button}${(d.after ?? []).map(p).join('\n')}${privacy}
</td></tr></table></td></tr></table></body></html>`
}

function compose(
  d: Draft,
  input: { privacyUrl?: string | null; siteUrl?: string | null },
): RenderedMessage {
  const footer = input.privacyUrl ? [`How we use your details: ${input.privacyUrl}`] : []
  return {
    subject: d.subject,
    text: toText(d, footer),
    html: toHtml(d, { siteUrl: input.siteUrl ?? null, privacyUrl: input.privacyUrl ?? null }),
  }
}

function parts(input: MessageInput) {
  const { ctx } = input
  const answers = ctx.enquiry.answers
  const customer = typeof answers.name === 'string' ? (answers.name.split(/\s+/)[0] ?? '') : ''
  const phone = typeof answers.phone === 'string' ? answers.phone : ''
  const address = ctx.enquiry.site_details?.site_address
  const staff = firstName(ctx.staff.display_name)
  const when = formatLocal(Date.parse(ctx.booking.starts_at))
  const event = ctx.type.mode === 'on_site' ? 'site visit' : 'call'
  return {
    hello: customer ? `Hello ${customer},` : 'Hello,',
    event,
    when: `${when.weekday} ${when.date} at ${when.time} (Irish time)`,
    whenShort: `${when.weekday} ${when.date} at ${when.time}`,
    where:
      ctx.type.mode === 'phone'
        ? [`${staff} will ring you on ${phone}.`]
        : [
            `${staff} will visit you at:`,
            typeof address === 'string' ? address : 'the address you gave us',
          ],
    reference: ctx.enquiry.reference,
  }
}

function ringUs(input: MessageInput): string[][] {
  return input.businessPhone
    ? [[`Or ring us on ${input.businessPhone}.`]]
    : [['Or reply to this email.']]
}

export function renderMessage(template: CustomerTemplate, input: MessageInput): RenderedMessage {
  const p = parts(input)
  const { ctx } = input
  const disclaimer =
    ctx.type.mode === 'on_site'
      ? 'A site visit is for us to assess the work and give you an estimate, which is a price range. It does not commit you to a quote, and it is not a start date.'
      : 'This call is to talk your project through. It does not commit you to anything.'
  const change = input.manageUrl ? { label: 'Change or cancel', url: input.manageUrl } : undefined
  const reference = [[`Your enquiry reference is ${p.reference}.`], ['Q3 Interiors']]

  switch (template) {
    case 'booking_confirmation':
      return compose(
        {
          subject: `Booked: your ${p.event} on ${p.whenShort}`,
          paragraphs: [
            [p.hello],
            [`Your ${p.event} with Q3 Interiors is booked.`],
            [`When: ${p.when}`, `Length: about ${ctx.type.duration_minutes} minutes`],
            p.where,
            [`To prepare: ${ctx.type.what_to_prepare}`],
            [disclaimer],
          ],
          action: change,
          after: [...(change ? ringUs(input) : []), ...reference],
        },
        input,
      )
    case 'booking_reminder':
      return compose(
        {
          subject: `Reminder: your ${p.event} on ${p.whenShort}`,
          paragraphs: [
            [p.hello],
            [`A reminder of your ${p.event} with Q3 Interiors.`],
            [`When: ${p.when}`],
            p.where,
            [`To prepare: ${ctx.type.what_to_prepare}`],
          ],
          action: change,
          after: [...(change ? ringUs(input) : []), ...reference],
        },
        input,
      )
    case 'booking_rescheduled':
      return compose(
        {
          subject: `New time: your ${p.event} on ${p.whenShort}`,
          paragraphs: [
            [p.hello],
            [`Your ${p.event} with Q3 Interiors has moved to a new time.`],
            [`New time: ${p.when}`],
            p.where,
          ],
          action: change,
          after: [...(change ? ringUs(input) : []), ...reference],
        },
        input,
      )
    case 'booking_cancelled': {
      const was = input.cancelledStart ? formatLocal(Date.parse(input.cancelledStart)) : null
      const wasText = was ? ` on ${was.weekday} ${was.date} at ${was.time}` : ''
      return compose(
        {
          subject: `Cancelled: your ${p.event}${wasText}`,
          paragraphs: [
            [p.hello],
            [
              `Your ${p.event} with Q3 Interiors${wasText} is cancelled. Your enquiry is still saved.`,
            ],
            [
              input.manageUrl
                ? 'If you would like a new time, you can book one here:'
                : 'If you would like a new time, reply to this email.',
            ],
          ],
          action: input.manageUrl ? { label: 'Book a new time', url: input.manageUrl } : undefined,
          after: reference,
        },
        input,
      )
    }
  }
}

export type StaffAlertInput = {
  summary: EnquirySummary
  /** Staff detail page for the enquiry. */
  staffUrl: string
  siteUrl?: string | null
}

/** Label of a choice answer from the stored form version, or the raw value. */
function choiceLabel(summary: EnquirySummary, fieldId: string): string | null {
  const value = summary.answers[fieldId]
  if (typeof value !== 'string' || value === '') return null
  for (const step of summary.schema?.steps ?? []) {
    const field = step.fields.find((f) => f.id === fieldId)
    const option = field?.options?.find((o) => o.value === value)
    if (option) return option.label
  }
  return value
}

/**
 * Alerts to staff. The subject carries the reference and project type only, never the customer's
 * name, email, phone or address.
 */
export function renderStaffAlert(
  template: 'staff_new_enquiry' | 'staff_callback_request',
  input: StaffAlertInput,
): RenderedMessage {
  const { summary } = input
  const other =
    typeof summary.answers.project_type_other === 'string'
      ? summary.answers.project_type_other
      : null
  const project = other ?? choiceLabel(summary, 'project_type') ?? 'Project'
  const area = typeof summary.answers.location === 'string' ? summary.answers.location : 'not given'
  const timing = choiceLabel(summary, 'timing')
  const action = { label: 'Open the enquiry', url: input.staffUrl }
  if (template === 'staff_new_enquiry') {
    return compose(
      {
        subject: `New enquiry ${summary.reference}: ${project}`,
        paragraphs: [
          ['A new enquiry has come in.'],
          [
            `Reference: ${summary.reference}`,
            `Project: ${project}`,
            `Area: ${area}`,
            ...(timing ? [`Timing: ${timing}`] : []),
          ],
        ],
        action,
        after: [
          [
            'The customer may book a call or site visit straight away; if they do not, they are waiting to hear from us.',
          ],
        ],
      },
      { siteUrl: input.siteUrl },
    )
  }
  return compose(
    {
      subject: `Call-back requested ${summary.reference}: ${project}`,
      paragraphs: [
        ['A customer has asked us to ring them instead of booking online.'],
        [
          `Reference: ${summary.reference}`,
          `Project: ${project}`,
          `Area: ${area}`,
          ...(summary.contact_request_reason ? [`Why: ${summary.contact_request_reason}`] : []),
        ],
      ],
      action,
    },
    { siteUrl: input.siteUrl },
  )
}
