/**
 * The booking-first journey (enquiry form v2): wording per route and the pure helpers the
 * screens share. A route is the appointment mode: 'phone' (a call) or 'on_site' (a site visit),
 * the same values as `appointment_types.mode` and the v2 `appointment_preference` answer.
 */
import { BUSINESS_TZ } from './format'

export type Route = 'phone' | 'on_site'

export const ROUTES: Route[] = ['phone', 'on_site']

export const ROUTE_COPY: Record<
  Route,
  {
    /** The landing choice and the recap. */
    title: string
    blurb: string
    /** "your call", "your site visit". */
    noun: string
    book: string
    phoneLabel: string
    booked: string
  }
> = {
  phone: {
    title: 'Phone call',
    blurb: 'We ring you at a time you pick and talk through your plans.',
    noun: 'call',
    book: 'Book call',
    phoneLabel: 'Number we should ring',
    booked: 'Your call is booked',
  },
  on_site: {
    title: 'Site visit',
    blurb: 'We come out, look at the space and measure up for an estimate.',
    noun: 'site visit',
    book: 'Book site visit',
    phoneLabel: 'Number we can ring on arrival',
    booked: 'Your site visit is booked',
  },
}

export function isRoute(value: unknown): value is Route {
  return value === 'phone' || value === 'on_site'
}

export function otherRoute(route: Route): Route {
  return route === 'phone' ? 'on_site' : 'phone'
}

/** "Phone call · 20 minutes", or just "Phone call" while the length is unknown. */
export function routeTitle(route: Route, minutes: number | null | undefined): string {
  return minutes ? `${ROUTE_COPY[route].title} · ${minutes} minutes` : ROUTE_COPY[route].title
}

type SlotLike = { start: string; date: string }

/**
 * Up to `count` suggestions, one per day for as many different days as there are, earliest
 * first; if there are fewer days than `count`, the rest come from the earliest remaining times.
 * Only offered (bookable) slots go in, so a suggestion is always something that can be booked.
 */
export function suggestSlots<T extends SlotLike>(slots: T[], count = 3): T[] {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start))
  const picked: T[] = []
  const days = new Set<string>()
  for (const slot of sorted) {
    if (picked.length >= count) break
    if (days.has(slot.date)) continue
    days.add(slot.date)
    picked.push(slot)
  }
  for (const slot of sorted) {
    if (picked.length >= count) break
    if (!picked.includes(slot)) picked.push(slot)
  }
  return picked.sort((a, b) => a.start.localeCompare(b.start))
}

const shortDate = new Intl.DateTimeFormat('en-IE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: BUSINESS_TZ,
})
const clock = new Intl.DateTimeFormat('en-IE', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: BUSINESS_TZ,
})

/** "Fri 27 Nov, 10:30" in Irish time. */
export function formatSlotShort(iso: string): string {
  const d = new Date(iso)
  return `${shortDate.format(d).replace(/,/g, '')}, ${clock.format(d)}`
}

/** "Book call · Fri 27 Nov, 10:30", or "Book call" before a time is chosen. */
export function bookLabel(route: Route, slot: { start: string } | null): string {
  return slot
    ? `${ROUTE_COPY[route].book} · ${formatSlotShort(slot.start)}`
    : ROUTE_COPY[route].book
}

/** "Site visit · Kitchen · Dublin 8": the recap on the Details screen. */
export function recapLine(route: Route, project: string | null, location: string | null): string {
  return [ROUTE_COPY[route].title, project, location]
    .filter((p): p is string => Boolean(p))
    .join(' · ')
}
