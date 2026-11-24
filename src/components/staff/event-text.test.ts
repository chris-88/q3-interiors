import { describe, expect, it, vi } from 'vitest'
import type { EnquiryEvent } from '@/api/enquiries'
import { eventLine } from './event-text'

// The labels live beside the data hooks; keep the real client (and its env check) out of the test.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const event = (over: Partial<EnquiryEvent>): EnquiryEvent =>
  ({
    id: 1,
    kind: 'email_sent',
    from_status: null,
    to_status: null,
    reason: null,
    detail: null,
    actor_name: null,
    created_at: '2026-11-24T15:00:00Z',
    ...over,
  }) as EnquiryEvent

describe('history labels', () => {
  it.each([
    ['booking_confirmation', 'Confirmation email sent'],
    ['booking_reminder', 'Reminder email sent'],
    ['booking_rescheduled', 'New time email sent'],
    ['booking_cancelled', 'Cancellation email sent'],
    ['staff_new_enquiry', 'Staff alert sent: new enquiry'],
    ['staff_callback_request', 'Staff alert sent: call-back requested'],
  ])('labels a sent %s by what it was, without the template id', (template, title) => {
    expect(eventLine(event({ detail: template }))).toEqual({ title, detail: null })
  })

  it('falls back to a neutral label and shows the template for an unknown message', () => {
    expect(eventLine(event({ detail: 'something_new' }))).toEqual({
      title: 'Email sent',
      detail: 'something_new',
    })
  })

  it('keeps the error under a failed email and the label of other events', () => {
    expect(eventLine(event({ kind: 'email_failed', detail: 'HTTP 422' }))).toEqual({
      title: 'Email not sent',
      detail: 'HTTP 422',
    })
    expect(
      eventLine(event({ kind: 'status_changed', from_status: 'new', to_status: 'contacted' }))
        .title,
    ).toBe('Status changed from New to Contacted')
  })
})
