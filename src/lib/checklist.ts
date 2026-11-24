// The go-live checklist: what stands between today and a paid campaign. Pure, unit-tested.
import { z } from 'zod'

export const checklistDataSchema = z.object({
  business_missing: z.array(z.string()),
  bookable_name: z.string().nullable(),
  calendar_connected: z.boolean(),
  calendar_healthy: z.boolean(),
  calendar_email: z.string().nullable(),
  test_calendar_email: z.string().nullable(),
  retention_months: z.number().nullable(),
  privacy_reviewed: z.boolean(),
  privacy_reviewable: z.boolean(),
  form_version: z.number().nullable(),
  last_booking_at: z.string().nullable(),
  campaign_links: z.coerce.number(),
  ticks: z.record(z.string(), z.object({ at: z.string(), by: z.string().nullable() })),
})

export type ChecklistData = z.infer<typeof checklistDataSchema>

export type ManualKey =
  'types_hours_reviewed' | 'google_app_production' | 'bookings_forwarder' | 'phone_check'

export type ChecklistItem = {
  id: string
  done: boolean
  title: string
  detail: string
  /** Where it is fixed. */
  link?: { to: string; label: string }
  /** Ticked by an admin rather than checked by the system. */
  manual?: ManualKey
  /** Special actions handled on the page. */
  action?: 'privacy_review' | 'mark_test_calendar'
}

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`

export function checklistItems(d: ChecklistData): ChecklistItem[] {
  const tick = (key: ManualKey) => d.ticks[key]
  const ticked = (key: ManualKey) => {
    const t = tick(key)
    return t ? `Ticked${t.by ? ` by ${t.by}` : ''} on ${t.at.slice(0, 10)}.` : ''
  }
  const testAccount = (() => {
    if (!d.calendar_connected)
      return { done: false, detail: 'No calendar is connected for bookings yet.' }
    if (!d.test_calendar_email)
      return {
        done: false,
        detail:
          'Not checked yet. While the test Google account is connected, mark it as the test account; this turns green once a different account takes its place.',
      }
    if (d.test_calendar_email === d.calendar_email)
      return {
        done: false,
        detail: `Bookings still go to the test account (${d.calendar_email ?? ''}).`,
      }
    return {
      done: true,
      detail: `Bookings go to ${d.calendar_email ?? 'a different account'}, not the test account.`,
    }
  })()
  return [
    {
      id: 'business',
      done: d.business_missing.length === 0,
      title: 'Business details are complete',
      detail:
        d.business_missing.length === 0
          ? 'All filled in.'
          : `Still to fill in: ${list(d.business_missing)}.`,
      link: { to: '/staff/settings/business', label: 'Business details' },
    },
    {
      id: 'bookable',
      done: Boolean(d.bookable_name) && d.calendar_connected && d.calendar_healthy,
      title: 'Someone takes bookings, with a working Google Calendar',
      detail: !d.bookable_name
        ? 'Nobody is set to take bookings.'
        : !d.calendar_connected
          ? `${d.bookable_name} takes bookings but has not connected a Google Calendar. Until then customers are offered a call back.`
          : !d.calendar_healthy
            ? `${d.bookable_name}'s calendar reported an error. Reconnect it in Settings while signed in as them.`
            : `${d.bookable_name} takes bookings; the calendar is working.`,
      link: { to: '/staff/settings/people', label: 'People' },
    },
    {
      id: 'test_account',
      done: testAccount.done,
      title: 'Bookings no longer use the test Google account',
      detail: testAccount.detail,
      action: d.calendar_connected && !d.test_calendar_email ? 'mark_test_calendar' : undefined,
    },
    {
      id: 'retention',
      done: d.retention_months !== null,
      title: 'A retention period is set',
      detail:
        d.retention_months !== null
          ? `Enquiries are deleted ${d.retention_months} months after they arrive, unless won.`
          : 'Choose how long enquiries are kept. The privacy notice states it once set.',
      link: { to: '/staff/settings/booking', label: 'Booking rules and data' },
    },
    {
      id: 'privacy',
      done: d.privacy_reviewed,
      title: 'The privacy notice is reviewed',
      detail: d.privacy_reviewed
        ? 'Reviewed: the public notice no longer says “Draft”.'
        : d.privacy_reviewable
          ? 'Read the notice on the website, then mark it reviewed. That removes the “Draft” marker.'
          : 'Fill in the legal name, postal address and privacy contact first; then read the notice and mark it reviewed.',
      link: { to: '/privacy', label: 'Read the notice' },
      action: 'privacy_review',
    },
    {
      id: 'form',
      done: (d.form_version ?? 1) > 1,
      title: 'The enquiry form has Q3’s real options',
      detail:
        (d.form_version ?? 1) > 1
          ? `The form is on version ${d.form_version ?? ''}.`
          : 'The form is still version 1, with placeholder project types, timings and budgets. A new version is published once Q3’s real values are in.',
    },
    {
      id: 'types_hours',
      done: Boolean(tick('types_hours_reviewed')),
      title: 'Appointment types and hours are reviewed',
      detail:
        ticked('types_hours_reviewed') ||
        'Check the lengths, buffers, visits per day and working hours with the person who takes bookings, then tick.',
      link: { to: '/staff/settings/booking', label: 'Booking rules and data' },
      manual: 'types_hours_reviewed',
    },
    {
      id: 'recent_booking',
      done: Boolean(d.last_booking_at),
      title: 'A booking worked end to end in the last 7 days',
      detail: d.last_booking_at
        ? `Last confirmed booking: ${d.last_booking_at.slice(0, 10)}.`
        : 'Make a test enquiry and book it, check the calendar event and the email, then cancel it.',
    },
    {
      id: 'campaign',
      done: d.campaign_links > 0,
      title: 'An active campaign has its link',
      detail:
        d.campaign_links > 0
          ? 'A tagged link has been copied or tested.'
          : 'Create the campaign and copy its link for the ad.',
      link: { to: '/staff/settings/campaigns', label: 'Campaigns' },
    },
    {
      id: 'google_app',
      done: Boolean(tick('google_app_production')),
      title: 'The Google sign-in app is published to Production',
      detail:
        ticked('google_app_production') ||
        'While the Google Cloud app is in Testing mode, Google ends the calendar connection every 7 days and bookings stop until someone reconnects. Publish it to Production in Google Cloud Console, then tick.',
      manual: 'google_app_production',
    },
    {
      id: 'forwarder',
      done: Boolean(tick('bookings_forwarder')),
      title: 'Replies to bookings@ reach the business',
      detail:
        ticked('bookings_forwarder') ||
        'Customers reply to the confirmation emails. Check that mail to bookings@q3interiors.ie is forwarded to someone at Q3 who reads it, then tick.',
      manual: 'bookings_forwarder',
    },
    {
      id: 'phone',
      done: Boolean(tick('phone_check')),
      title: 'Checked on a phone in Instagram and Safari',
      detail:
        ticked('phone_check') ||
        'Open the campaign link from Instagram (its own browser) and in Safari on an iPhone; make an enquiry and book it. Then tick.',
      manual: 'phone_check',
    },
  ]
}
