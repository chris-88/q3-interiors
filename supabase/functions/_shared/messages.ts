// Every email, in one file. Each message is a FIXED structure (greeting, the date and time, where,
// the reference, the Change-or-cancel button, the privacy link, the plain-text part) with NAMED
// TEXT BLOCKS inside it that an admin may reword in Settings > Wording. The defaults below are
// used for any block not reworded. Blocks are plain text: they are escaped like every other value,
// and may only use the tokens listed for them. Vocabulary follows the brand guide: an enquiry; a
// call or a site visit; an estimate is a price range after a call or visit; a written quote is the
// price for an agreed scope (never "full quote", "estimated range" or "quotation").
import { formatRange } from './estimate.ts'
import { formatLocal } from './time.ts'
import type {
  BookingContext,
  CustomerTemplate,
  EnquirySummary,
  StaffAccountTemplate,
} from './types.ts'

// ---------------------------------------------------------------------------------------------
// Named text blocks
// ---------------------------------------------------------------------------------------------

export type WordingBlock = {
  label: string
  /** Where it appears, for the admin screen. */
  where: string
  default: string
  max: number
  /** May the block be left empty (the paragraph is then left out)? */
  optional?: boolean
  tokens: readonly ('first_name' | 'event')[]
}

const CUSTOMER_TOKENS = ['first_name', 'event'] as const

export const WORDING = {
  'booking_confirmation.intro': {
    label: 'Opening line',
    where: 'Booking confirmation email',
    default: 'Your {event} with Q3 Interiors is booked.',
    max: 300,
    tokens: CUSTOMER_TOKENS,
  },
  'booking_confirmation.closing': {
    label: 'Extra paragraph (optional)',
    where: 'Booking confirmation email, before the sign-off',
    default: '',
    max: 600,
    optional: true,
    tokens: CUSTOMER_TOKENS,
  },
  'booking_reminder.intro': {
    label: 'Opening line',
    where: 'Reminder email',
    default: 'A reminder of your {event} with Q3 Interiors.',
    max: 300,
    tokens: CUSTOMER_TOKENS,
  },
  'booking_reminder.closing': {
    label: 'Extra paragraph (optional)',
    where: 'Reminder email, before the reference',
    default: '',
    max: 600,
    optional: true,
    tokens: CUSTOMER_TOKENS,
  },
  'booking_rescheduled.intro': {
    label: 'Opening line',
    where: 'New time email',
    default: 'Your {event} with Q3 Interiors has moved to a new time.',
    max: 300,
    tokens: CUSTOMER_TOKENS,
  },
  'booking_rescheduled.closing': {
    label: 'Extra paragraph (optional)',
    where: 'New time email, before the reference',
    default: '',
    max: 600,
    optional: true,
    tokens: CUSTOMER_TOKENS,
  },
  'booking_cancelled.intro': {
    label: 'Opening line',
    where: 'Cancellation email',
    default: 'Your {event} with Q3 Interiors is cancelled. Your enquiry is still saved.',
    max: 300,
    tokens: CUSTOMER_TOKENS,
  },
  'booking_cancelled.closing': {
    label: 'Extra paragraph (optional)',
    where: 'Cancellation email, before the reference',
    default: '',
    max: 600,
    optional: true,
    tokens: CUSTOMER_TOKENS,
  },
  visit_disclaimer: {
    label: 'Site visit: what it is and is not',
    where: 'Confirmation email for a site visit, and the booked page',
    default:
      'A site visit is for us to look at the work and price it. You get an estimate, which is a price range with VAT included. You’re not committing to anything, and it isn’t a start date.',
    max: 400,
    tokens: [],
  },
  call_disclaimer: {
    label: 'Call: what it is',
    where: 'Confirmation email for a call',
    default:
      'This call is to talk your project through. It does not commit you to anything. If you want a price, the next step is a site visit.',
    max: 400,
    tokens: [],
  },
  estimate_caveats: {
    label: 'Estimate: what it is and is not',
    where: 'Estimate email, under the price range (saved with each estimate as sent)',
    default:
      'This is an estimate, not a quote. It’s a price range for the work we looked at together, with VAT included. It could change if the scope changes or if we find something we couldn’t see on the visit, which is common in older homes. It’s good for 10 days. If you want to go ahead, tell us and we’ll send your quote: one price, with what’s included and what isn’t.',
    max: 600,
    tokens: [],
  },
  sign_off: {
    label: 'Sign-off',
    where: 'The last line of every customer email',
    default: 'Q3 Interiors',
    max: 120,
    tokens: [],
  },
  'staff_new_enquiry.intro': {
    label: 'Opening line',
    where: 'Staff alert: new enquiry',
    default: 'A new enquiry has come in.',
    max: 300,
    tokens: [],
  },
  'staff_new_enquiry.note': {
    label: 'Note under the details',
    where: 'Staff alert: new enquiry',
    default:
      'The customer may book a call or site visit straight away; if they do not, they are waiting to hear from us.',
    max: 400,
    optional: true,
    tokens: [],
  },
  'staff_callback_request.intro': {
    label: 'Opening line',
    where: 'Staff alert: call back requested',
    default: 'A customer has asked us to ring them instead of booking online.',
    max: 300,
    tokens: [],
  },
} as const satisfies Record<string, WordingBlock>

export type WordingKey = keyof typeof WORDING
export type Wording = Partial<Record<WordingKey, string>>

export const WORDING_KEYS = Object.keys(WORDING) as WordingKey[]

/** Why a block's text cannot be saved, or null. Server and screen use the same check. */
export function wordingProblem(key: WordingKey, text: string): string | null {
  const block: WordingBlock = WORDING[key]
  const trimmed = text.trim()
  if (!trimmed && !block.optional) return 'This cannot be empty.'
  if ([...trimmed].length > block.max) return `Use at most ${block.max} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B-\u001F\u007F]/.test(trimmed)) return 'Remove the unusual characters.'
  for (const match of trimmed.matchAll(/\{([^{}]*)\}/g)) {
    const token = match[1] ?? ''
    if (!(block.tokens as readonly string[]).includes(token)) {
      return block.tokens.length
        ? `Only these may go in curly brackets: ${block.tokens.map((t) => `{${t}}`).join(', ')}.`
        : 'Curly brackets cannot be used here.'
    }
  }
  return null
}

/** The block's text (reworded or default) with its tokens filled in. Still plain text. */
function block(
  wording: Wording | undefined,
  key: WordingKey,
  values: { first_name?: string; event?: string } = {},
): string {
  const custom = wording?.[key]
  const text =
    custom !== undefined && wordingProblem(key, custom) === null
      ? custom.trim()
      : WORDING[key].default
  return text.replace(
    /\{(first_name|event)\}/g,
    (_m, token: 'first_name' | 'event') => values[token] ?? '',
  )
}

export type MessageInput = {
  ctx: BookingContext
  /** Reworded blocks (from the database); anything missing uses the default. */
  wording?: Wording
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
  /** One line set large after the paragraphs (the estimate's range). */
  big?: string
  /** Paragraphs between the large line and the button. */
  beforeAction?: string[][]
  action?: { label: string; url: string }
  /** Further links written under the button (e.g. "Cancel appointment"). */
  links?: { label: string; url: string }[]
  after?: string[][]
}

// Brand guide v2.0: black actions and links, ink text, muted captions, on white.
const BRAND = { action: '#000000', ink: '#171717', muted: '#555555' }

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
    ...(d.big ? [d.big] : []),
    ...(d.beforeAction ?? []).map((p) => p.join('\n')),
    ...(d.action ? [`${d.action.label}: ${d.action.url}`] : []),
    ...(d.links ?? []).map((l) => `${l.label}: ${l.url}`),
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
  // The wordmark, served from the site at twice its displayed size.
  const badge = opts.siteUrl
    ? `<img src="${escapeHtml(opts.siteUrl)}/brand/q3-email-logo.png" width="160" height="61" alt="Q3 Interiors" style="display:block;border:0;margin:0 0 24px">`
    : ''
  const big = d.big
    ? `<p style="margin:8px 0 24px;font:700 28px/1.25 Roboto,Arial,sans-serif;color:${BRAND.ink}">${escapeHtml(d.big)}</p>`
    : ''
  const button = d.action
    ? `<p style="margin:8px 0 24px"><a href="${escapeHtml(d.action.url)}" style="display:inline-block;background:${BRAND.action};color:#ffffff;font:500 16px/1.4 Roboto,Arial,sans-serif;text-decoration:none;padding:12px 24px;border-radius:4px">${escapeHtml(d.action.label)}</a></p>`
    : ''
  const links = (d.links ?? [])
    .map(
      (l) =>
        `<p style="margin:0 0 24px;font:16px/1.55 Roboto,Arial,sans-serif"><a href="${escapeHtml(l.url)}" style="color:${BRAND.action}">${escapeHtml(l.label)}</a></p>`,
    )
    .join('\n')
  const privacy = opts.privacyUrl
    ? `<p style="margin:24px 0 0;font:14px/1.5 Roboto,Arial,sans-serif;color:${BRAND.muted}"><a href="${escapeHtml(opts.privacyUrl)}" style="color:${BRAND.action}">How we use your details</a></p>`
    : ''
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${escapeHtml(d.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td style="padding:24px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto"><tr><td>
${badge}${d.paragraphs.map(p).join('\n')}${big}${(d.beforeAction ?? []).map(p).join('\n')}${button}${links}${(d.after ?? []).map(p).join('\n')}${privacy}
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
    firstName: customer,
    hello: customer ? `Hello ${customer},` : 'Hello,',
    event,
    when: `${when.weekday} ${when.date} at ${when.time} (Irish time)`,
    whenShort: `${when.weekday} ${when.date} at ${when.time}`,
    where:
      ctx.type.mode === 'phone'
        ? [`${staff} will ring you on ${phone}.`]
        : [
            `${staff} will meet you at ${typeof address === 'string' ? address : 'the address you gave us'}.`,
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
  const { ctx, wording } = input
  const values = { first_name: p.firstName, event: p.event }
  const disclaimer =
    ctx.type.mode === 'on_site'
      ? block(wording, 'visit_disclaimer')
      : block(wording, 'call_disclaimer')
  const change = input.manageUrl ? { label: 'Change or cancel', url: input.manageUrl } : undefined
  const closing = (key: WordingKey) => {
    const text = block(wording, key, values)
    return text ? [[text]] : []
  }
  const reference = (closingKey: WordingKey) => [
    ...closing(closingKey),
    [`Your enquiry reference is ${p.reference}.`],
    [block(wording, 'sign_off')],
  ]

  switch (template) {
    case 'booking_confirmation':
      // Form v2 receipt order: date, time and length, what will happen, then the reference;
      // "Change time" and "Cancel appointment" follow.
      return compose(
        {
          subject: `Booked: your ${p.event} on ${p.whenShort}`,
          paragraphs: [
            [p.hello],
            [block(wording, 'booking_confirmation.intro', values)],
            [p.when, `About ${ctx.type.duration_minutes} minutes`],
            p.where,
            [`Your enquiry reference is ${p.reference}.`],
          ],
          action: input.manageUrl
            ? { label: 'Change time', url: `${input.manageUrl}?do=change` }
            : undefined,
          links: input.manageUrl
            ? [
                { label: 'Cancel appointment', url: `${input.manageUrl}?do=cancel` },
                // Part B: photos, a rough budget, timing, access notes (all optional).
                { label: 'Help us prepare (optional)', url: `${input.manageUrl}?do=prepare` },
              ]
            : undefined,
          after: [
            ...(change ? ringUs(input) : []),
            [`To prepare: ${ctx.type.what_to_prepare}`],
            [disclaimer],
            ...closing('booking_confirmation.closing'),
            [block(wording, 'sign_off')],
          ],
        },
        input,
      )
    case 'booking_reminder':
      return compose(
        {
          subject: `Reminder: your ${p.event} on ${p.whenShort}`,
          paragraphs: [
            [p.hello],
            [block(wording, 'booking_reminder.intro', values)],
            [`When: ${p.when}`],
            p.where,
            [`To prepare: ${ctx.type.what_to_prepare}`],
          ],
          action: change,
          after: [...(change ? ringUs(input) : []), ...reference('booking_reminder.closing')],
        },
        input,
      )
    case 'booking_rescheduled':
      return compose(
        {
          subject: `New time: your ${p.event} on ${p.whenShort}`,
          paragraphs: [
            [p.hello],
            [block(wording, 'booking_rescheduled.intro', values)],
            [`New time: ${p.when}`],
            p.where,
          ],
          action: change,
          after: [...(change ? ringUs(input) : []), ...reference('booking_rescheduled.closing')],
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
            [block(wording, 'booking_cancelled.intro', values)],
            ...(was ? [[`Cancelled: ${was.weekday} ${was.date} at ${was.time} (Irish time)`]] : []),
            [
              input.manageUrl
                ? 'If you would like a new time, you can book one here:'
                : 'If you would like a new time, reply to this email.',
            ],
          ],
          action: input.manageUrl ? { label: 'Book a new time', url: input.manageUrl } : undefined,
          after: reference('booking_cancelled.closing'),
        },
        input,
      )
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The estimate (after a site visit)
// ---------------------------------------------------------------------------------------------

export const ESTIMATE_SUBJECT = 'Your estimate from Q3 Interiors'
export const ESTIMATE_SIGN_OFF = 'Chris Quinn, Q3 Interiors'

export type EstimateEmailInput = {
  /** The customer's full name as given; the greeting uses the first name. */
  customerName: string
  workLookedAt: string
  low: number
  high: number
  /** The caveats paragraph as saved with the estimate. */
  caveats: string
  /** The "Get my quote" page (token link); null leaves the button out. */
  quoteUrl: string | null
  businessPhone: string | null
  privacyUrl?: string | null
  siteUrl?: string | null
}

/**
 * The estimate email. Order: greeting; thanks for the visit; the work we looked at; the range,
 * large; the caveats; "Get my quote"; the sign-off with the business phone. Words per the tone
 * of voice: an estimate is a range, a quote is one price; never "formal quote" or "quotation".
 */
export function renderEstimate(input: EstimateEmailInput): RenderedMessage {
  const first = firstName(input.customerName)
  return compose(
    {
      subject: ESTIMATE_SUBJECT,
      paragraphs: [
        [first ? `Hello ${first},` : 'Hello,'],
        ['Thanks for having us out to look at the work.'],
        ['The work we looked at:', input.workLookedAt.trim()],
      ],
      big: `${formatRange(input.low, input.high)}, VAT included`,
      beforeAction: [[input.caveats.trim()]],
      action: input.quoteUrl ? { label: 'Get my quote', url: input.quoteUrl } : undefined,
      after: [input.businessPhone ? [ESTIMATE_SIGN_OFF, input.businessPhone] : [ESTIMATE_SIGN_OFF]],
    },
    input,
  )
}

export type StaffAlertInput = {
  summary: EnquirySummary
  /** Staff detail page for the enquiry. */
  staffUrl: string
  siteUrl?: string | null
  wording?: Wording
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
  template: 'staff_new_enquiry' | 'staff_callback_request' | 'staff_quote_request',
  input: StaffAlertInput & { estimate?: { low: number; high: number; sentAt: string } | null },
): RenderedMessage {
  const { summary } = input
  const other =
    typeof summary.answers.project_type_other === 'string'
      ? summary.answers.project_type_other
      : null
  const project = other ?? choiceLabel(summary, 'project_type') ?? 'Project'
  const area = typeof summary.answers.location === 'string' ? summary.answers.location : 'not given'
  const timing = choiceLabel(summary, 'timing')
  // Form v2: the call-or-visit choice and the project follow-ups (no contact details).
  const preference = choiceLabel(summary, 'appointment_preference')
  const layout = choiceLabel(summary, 'kitchen_layout')
  const rooms =
    typeof summary.answers.rooms_involved === 'string' ? summary.answers.rooms_involved : null
  const extra = [
    ...(preference ? [`Asked for: ${preference}`] : []),
    ...(layout ? [`Kitchen layout: ${layout}`] : []),
    ...(rooms ? [`Rooms: ${rooms}`] : []),
  ]
  const action = { label: 'Open the enquiry', url: input.staffUrl }
  if (template === 'staff_quote_request') {
    const sent = input.estimate ? formatLocal(Date.parse(input.estimate.sentAt)) : null
    return compose(
      {
        subject: `Quote requested ${summary.reference}: ${project}`,
        paragraphs: [
          ['A customer has asked for their quote.'],
          [
            `Reference: ${summary.reference}`,
            `Project: ${project}`,
            `Area: ${area}`,
            ...(input.estimate && sent
              ? [
                  `Estimate: ${formatRange(input.estimate.low, input.estimate.high)}, sent ${sent.date}`,
                ]
              : []),
          ],
        ],
        action,
      },
      { siteUrl: input.siteUrl },
    )
  }
  if (template === 'staff_new_enquiry') {
    return compose(
      {
        subject: `New enquiry ${summary.reference}: ${project}`,
        paragraphs: [
          [block(input.wording, 'staff_new_enquiry.intro')],
          [
            `Reference: ${summary.reference}`,
            `Project: ${project}`,
            `Area: ${area}`,
            ...extra,
            ...(timing ? [`Timing: ${timing}`] : []),
          ],
        ],
        action,
        after: block(input.wording, 'staff_new_enquiry.note')
          ? [[block(input.wording, 'staff_new_enquiry.note')]]
          : [],
      },
      { siteUrl: input.siteUrl },
    )
  }
  return compose(
    {
      subject: `Call-back requested ${summary.reference}: ${project}`,
      paragraphs: [
        [block(input.wording, 'staff_callback_request.intro')],
        [
          `Reference: ${summary.reference}`,
          `Project: ${project}`,
          `Area: ${area}`,
          ...extra,
          ...(summary.contact_request_reason ? [`Why: ${summary.contact_request_reason}`] : []),
        ],
      ],
      action,
    },
    { siteUrl: input.siteUrl },
  )
}

export type AccountEmailInput = {
  displayName: string
  /** The single-use set-password link (never logged). */
  link: string
  siteUrl?: string | null
  /** The staff console, for "Forgot password" on its sign-in page. */
  staffUrl?: string | null
}

/** Staff account emails: the invitation and the password reset. Same branded frame. */
export function renderAccountEmail(
  template: StaffAccountTemplate,
  input: AccountEmailInput,
): RenderedMessage {
  const hello = `Hello ${firstName(input.displayName)},`
  const signIn = input.staffUrl ? `${input.staffUrl}/#/` : null
  const expired = signIn
    ? `If the link has expired or was already used, choose "Forgot password" on the sign-in page: ${signIn}`
    : 'If the link has expired or was already used, choose "Forgot password" on the sign-in page.'
  if (template === 'staff_invite') {
    return compose(
      {
        subject: 'Your Q3 Interiors staff account',
        paragraphs: [
          [hello],
          [
            'You have been added to the Q3 Interiors staff workspace, where enquiries and appointments are handled.',
          ],
          [
            'Choose a password to finish setting up your account. The link works once, within 24 hours.',
          ],
        ],
        action: { label: 'Choose your password', url: input.link },
        after: [[expired], ['Q3 Interiors']],
      },
      { siteUrl: input.siteUrl },
    )
  }
  return compose(
    {
      subject: 'Reset your Q3 Interiors password',
      paragraphs: [
        [hello],
        ['Someone asked to reset the password for your Q3 Interiors staff account.'],
        ['Choose a new password with the link below. It works once, within 24 hours.'],
      ],
      action: { label: 'Choose a new password', url: input.link },
      after: [
        ['If you did not ask for this, you can ignore this email. Your password stays the same.'],
        [expired],
        ['Q3 Interiors'],
      ],
    },
    { siteUrl: input.siteUrl },
  )
}
