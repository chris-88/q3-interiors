import { statusLabel, type EnquiryEvent } from '@/api/enquiries'

const EVENT_TEXT: Record<string, string> = {
  submitted: 'Enquiry received',
  site_details_added: 'Customer added the property address',
  contact_requested: 'Customer asked to be contacted',
  booking_requested: 'Customer booked',
  booking_confirmed: 'Calendar event created; booking confirmed',
  booking_retrying: 'Calendar event not created yet; retrying',
  booking_failed: 'Booking failed',
  email_failed: 'Email not sent',
  booking_cancelled: 'Appointment cancelled',
  booking_rescheduled: 'Appointment moved',
  calendar_updated: 'Google Calendar updated',
  calendar_update_failed: 'Google Calendar not updated',
  attendance_recorded: 'Attendance recorded',
  outcome_recorded: 'Outcome recorded',
  outcome_cleared: 'Outcome cleared',
  details_updated: 'Customer changed their details',
  prepare_updated: 'Customer added to "Help us prepare" (after booking)',
  photo_added: 'Customer added a photo (after booking)',
  photo_removed: 'Customer removed a photo',
  chase_flagged: 'Flagged: had to chase details',
  chase_updated: 'Changed what was missing',
  chase_cleared: 'Chase flag cleared',
}

/** An `email_sent` event's detail is the message template. */
const EMAIL_SENT_TEXT: Record<string, string> = {
  booking_confirmation: 'Confirmation email sent',
  booking_reminder: 'Reminder email sent',
  booking_rescheduled: 'New time email sent',
  booking_cancelled: 'Cancellation email sent',
  staff_new_enquiry: 'Staff alert sent: new enquiry',
  staff_callback_request: 'Staff alert sent: call-back requested',
}

/** The history line for an event: a title, and the detail to show under it (if any). */
export function eventLine(event: EnquiryEvent): { title: string; detail: string | null } {
  const detail = event.reason ?? event.detail ?? null
  if (event.kind === 'email_sent') {
    const known = event.detail ? EMAIL_SENT_TEXT[event.detail] : undefined
    // The template id is only shown when it is one we have no label for.
    return known ? { title: known, detail: event.reason ?? null } : { title: 'Email sent', detail }
  }
  const fixed = EVENT_TEXT[event.kind]
  if (fixed) return { title: fixed, detail }
  if (event.kind === 'status_changed') {
    const to = event.to_status ? statusLabel(event.to_status) : 'unknown'
    const from = event.from_status ? statusLabel(event.from_status) : null
    return {
      title: from ? `Status changed from ${from} to ${to}` : `Status set to ${to}`,
      detail,
    }
  }
  // A kind added by a newer release: a plain line rather than a failed page.
  return { title: 'Update recorded', detail }
}
