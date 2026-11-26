// The Appointments agenda: Upcoming and Past, grouped by Irish day, the "To wrap up" group, and
// the badge an appointment gets only when something is not normal. Pure, tested without a browser.
import { formatShortDay, irishDayKey } from './format'

export type AgendaBooking = {
  id: string
  enquiry_id: string
  state: string
  starts_at: string
  ends_at: string
  attendance: string | null
  calendar_mismatch: string | null
  enquiries: { outcome?: string | null } | null
}

/** States that are over for good; anything else (including a newer release's) may still happen. */
const ENDED = new Set(['cancelled', 'failed'])

export const AGENDA_FILTERS = [
  ['upcoming', 'Upcoming'],
  ['past', 'Past'],
] as const
export type AgendaFilter = (typeof AGENDA_FILTERS)[number][0]

export function readAgendaFilter(search: string): AgendaFilter {
  return new URLSearchParams(search).get('show') === 'past' ? 'past' : 'upcoming'
}

/**
 * Upcoming: not cancelled or failed and not yet over, soonest first (a state a newer release
 * added stays in view here, with its raw value as the badge). Past: everything else, latest first.
 */
export function splitAgenda<T extends AgendaBooking>(bookings: T[], now: number) {
  const upcoming = bookings
    .filter((b) => !ENDED.has(b.state) && Date.parse(b.ends_at) >= now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  const past = bookings
    .filter((b) => !upcoming.includes(b))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
  return { upcoming, past }
}

/**
 * "To wrap up": confirmed appointments that are over and whose enquiry has no outcome yet, one
 * per enquiry (its latest), latest first.
 */
export function toWrapUp<T extends AgendaBooking>(bookings: T[], now: number): T[] {
  const seen = new Set<string>()
  return bookings
    .filter(
      (b) =>
        b.state === 'confirmed' &&
        Date.parse(b.ends_at) < now &&
        b.enquiries !== null &&
        (b.enquiries.outcome ?? null) === null,
    )
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
    .filter((b) => (seen.has(b.enquiry_id) ? false : (seen.add(b.enquiry_id), true)))
}

/** "Today", "Tomorrow", "Yesterday", else "Fri 27 Nov" (Irish days). */
export function dayHeading(iso: string, now: number): string {
  const day = irishDayKey(iso)
  const today = irishDayKey(now)
  // Noon UTC on the Irish day, so stepping a day never crosses a clock change into the wrong date.
  const shift = (n: number) =>
    irishDayKey(Date.parse(`${today}T12:00:00Z`) + n * 24 * 60 * 60 * 1000)
  if (day === today) return 'Today'
  if (day === shift(1)) return 'Tomorrow'
  if (day === shift(-1)) return 'Yesterday'
  return formatShortDay(iso)
}

/** Consecutive bookings on the same Irish day, in the order given. */
export function groupByDay<T extends AgendaBooking>(
  bookings: T[],
  now: number,
): { key: string; heading: string; bookings: T[] }[] {
  const groups: { key: string; heading: string; bookings: T[] }[] = []
  for (const b of bookings) {
    const key = irishDayKey(b.starts_at)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.bookings.push(b)
    else groups.push({ key, heading: dayHeading(b.starts_at, now), bookings: [b] })
  }
  return groups
}

/**
 * A badge only when something is not normal: cancelled, the calendar write failed or differs,
 * not confirmed yet, a no-show, or a state a newer release added (its raw value). A confirmed
 * appointment has none.
 */
export function appointmentBadge(b: {
  state: string
  attendance: string | null
  calendar_mismatch: string | null
}): { label: string; tone: 'warn' | 'muted' } | null {
  if (b.state === 'cancelled') return { label: 'Cancelled', tone: 'muted' }
  if (b.state === 'failed') return { label: 'Calendar write failed', tone: 'warn' }
  if (b.state === 'reserved' || b.state === 'calendar_pending')
    return { label: 'Unconfirmed', tone: 'warn' }
  if (b.state !== 'confirmed') return { label: b.state, tone: 'muted' }
  if (b.calendar_mismatch) return { label: 'Calendar differs', tone: 'warn' }
  if (b.attendance === 'no_show') return { label: 'No-show', tone: 'muted' }
  return null
}
