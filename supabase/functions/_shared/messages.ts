// Every customer email's wording, in one file. PLACEHOLDER wording until Q3 Interiors
// confirms it: changing what customers read is a change to this file only.
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
}

export type RenderedMessage = { subject: string; text: string }

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName
}

function parts(input: MessageInput) {
  const { ctx } = input
  const answers = ctx.enquiry.answers
  const customer = typeof answers.name === 'string' ? (answers.name.split(/\s+/)[0] ?? '') : ''
  const phone = typeof answers.phone === 'string' ? answers.phone : ''
  const address = ctx.enquiry.site_details?.site_address
  const staff = firstName(ctx.staff.display_name)
  const when = formatLocal(Date.parse(ctx.booking.starts_at))
  return {
    hello: customer ? `Hello ${customer},` : 'Hello,',
    type: ctx.type.label,
    typeLower: ctx.type.label.toLowerCase(),
    when: `${when.weekday} ${when.date} at ${when.time} (Irish time)`,
    whenShort: `${when.weekday} ${when.date} at ${when.time}`,
    where:
      ctx.type.mode === 'phone'
        ? `${staff} will ring you on ${phone}.`
        : `${staff} will visit you at:\n${typeof address === 'string' ? address : 'the address you gave us'}`,
    reference: ctx.enquiry.reference,
  }
}

function changeLines(input: MessageInput): string[] {
  const lines = input.manageUrl ? [`Change or cancel: ${input.manageUrl}`] : []
  if (input.businessPhone) lines.push(`Or ring us on ${input.businessPhone}.`)
  else lines.push('Or reply to this email.')
  return lines
}

const signOff = ['', 'Q3 Interiors']

export function renderMessage(template: CustomerTemplate, input: MessageInput): RenderedMessage {
  const rendered = renderCustomer(template, input)
  return input.privacyUrl
    ? { ...rendered, text: `${rendered.text}\n\nHow we use your details: ${input.privacyUrl}` }
    : rendered
}

function renderCustomer(template: CustomerTemplate, input: MessageInput): RenderedMessage {
  const p = parts(input)
  const { ctx } = input
  const disclaimer =
    ctx.type.mode === 'on_site'
      ? 'This visit is for us to assess and price the work. It does not commit you to a quote, and it is not a start date.'
      : 'This call is to talk your project through. It does not commit you to anything.'

  switch (template) {
    case 'booking_confirmation':
      return {
        subject: `Booked: ${p.type}, ${p.whenShort}`,
        text: [
          p.hello,
          '',
          `Your ${p.typeLower} with Q3 Interiors is booked.`,
          '',
          `When: ${p.when}`,
          `Length: about ${ctx.type.duration_minutes} minutes`,
          p.where,
          '',
          `To prepare: ${ctx.type.what_to_prepare}`,
          '',
          disclaimer,
          '',
          ...changeLines(input),
          '',
          `Your reference is ${p.reference}.`,
          ...signOff,
        ].join('\n'),
      }
    case 'booking_reminder':
      return {
        subject: `Reminder: ${p.type}, ${p.whenShort}`,
        text: [
          p.hello,
          '',
          `A reminder of your ${p.typeLower} with Q3 Interiors.`,
          '',
          `When: ${p.when}`,
          p.where,
          '',
          `To prepare: ${ctx.type.what_to_prepare}`,
          '',
          ...changeLines(input),
          '',
          `Your reference is ${p.reference}.`,
          ...signOff,
        ].join('\n'),
      }
    case 'booking_rescheduled':
      return {
        subject: `New time: ${p.type}, ${p.whenShort}`,
        text: [
          p.hello,
          '',
          `Your ${p.typeLower} with Q3 Interiors has moved to a new time.`,
          '',
          `New time: ${p.when}`,
          p.where,
          '',
          ...changeLines(input),
          '',
          `Your reference is ${p.reference}.`,
          ...signOff,
        ].join('\n'),
      }
    case 'booking_cancelled': {
      const was = input.cancelledStart ? formatLocal(Date.parse(input.cancelledStart)) : null
      return {
        subject: `Cancelled: ${p.type}${was ? `, ${was.weekday} ${was.date} at ${was.time}` : ''}`,
        text: [
          p.hello,
          '',
          `Your ${p.typeLower} with Q3 Interiors${was ? ` on ${was.weekday} ${was.date} at ${was.time}` : ''} is cancelled.`,
          '',
          input.manageUrl
            ? `If you would like a new time, you can book one here: ${input.manageUrl}`
            : 'If you would like a new time, reply to this email.',
          '',
          `Your reference is ${p.reference}.`,
          ...signOff,
        ].join('\n'),
      }
    }
  }
}

export type StaffAlertInput = {
  summary: EnquirySummary
  /** Staff detail page for the enquiry. */
  staffUrl: string
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
  if (template === 'staff_new_enquiry') {
    return {
      subject: `New enquiry ${summary.reference}: ${project}`,
      text: [
        `A new enquiry has come in.`,
        '',
        `Reference: ${summary.reference}`,
        `Project: ${project}`,
        `Area: ${area}`,
        timing ? `Timing: ${timing}` : null,
        '',
        `Open it: ${input.staffUrl}`,
        '',
        'The customer may book a time straight away; if they do not, they are waiting to hear from us.',
      ]
        .filter((l): l is string => l !== null)
        .join('\n'),
    }
  }
  return {
    subject: `Call-back requested ${summary.reference}: ${project}`,
    text: [
      'A customer has asked us to contact them instead of booking online.',
      '',
      `Reference: ${summary.reference}`,
      `Project: ${project}`,
      `Area: ${area}`,
      summary.contact_request_reason ? `Why: ${summary.contact_request_reason}` : null,
      '',
      `Open it: ${input.staffUrl}`,
    ]
      .filter((l): l is string => l !== null)
      .join('\n'),
  }
}
