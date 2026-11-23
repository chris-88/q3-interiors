// Every customer email's wording, in one file. PLACEHOLDER wording until Q3 Interiors
// confirms it: changing what customers read is a change to this file only.
import { formatLocal } from './time.ts'
import type { BookingContext, Template } from './types.ts'

export type MessageInput = {
  ctx: BookingContext
  /** Link back to the customer's booking page (change or cancel); null if unavailable. */
  manageUrl: string | null
  /** Business phone for "ring us", null while it is a placeholder. */
  businessPhone: string | null
  /** For a cancellation, the start that was cancelled. */
  cancelledStart?: string | null
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

export function renderMessage(template: Template, input: MessageInput): RenderedMessage {
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
