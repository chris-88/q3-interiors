import { addDays, BUSINESS_TZ, toLocal } from './time.ts'

/**
 * Working days are Monday to Friday in Europe/Dublin. LIMIT: public holidays are not modelled yet
 * (a bank holiday counts as a working day); add them here when they matter.
 */

/** Monday to Friday for a local date (YYYY-MM-DD). */
export function isWorkingDay(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}

/**
 * The local date (YYYY-MM-DD) `days` working days after the instant: counting starts on the next
 * day, so a request on Friday 27 Nov 2026 plus 3 working days is Wednesday 2 Dec.
 */
export function addWorkingDays(instant: number | string, days: number, tz: string = BUSINESS_TZ) {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant
  let date = toLocal(ms, tz).date
  let left = days
  while (left > 0) {
    date = addDays(date, 1)
    if (isWorkingDay(date)) left -= 1
  }
  return date
}

/** Has the local date passed (today in Dublin is later than it)? */
export function isPastDate(date: string, now: number, tz: string = BUSINESS_TZ): boolean {
  return toLocal(now, tz).date > date
}

/** A quote is sent within this many working days of "Get my quote". */
export const QUOTE_DUE_WORKING_DAYS = 3
