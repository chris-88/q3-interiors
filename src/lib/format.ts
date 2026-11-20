export const BUSINESS_TZ = 'Europe/Dublin'

const dateTime = new Intl.DateTimeFormat('en-IE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: BUSINESS_TZ,
})

/** A timestamp in Irish time, e.g. "20 Nov 2026, 11:42". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date)
}

const longDate = new Intl.DateTimeFormat('en-IE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: BUSINESS_TZ,
})
const shortDay = new Intl.DateTimeFormat('en-IE', { weekday: 'short', timeZone: BUSINESS_TZ })
const dayMonth = new Intl.DateTimeFormat('en-IE', {
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

/** "Tuesday 2 March" in Irish time. */
export function formatLongDate(iso: string): string {
  return longDate.format(new Date(iso))
}

/** "10:30" in Irish time. */
export function formatClock(iso: string): string {
  return clock.format(new Date(iso))
}

/** ["Tue", "2 Mar"] for a day picker. */
export function formatDayChip(iso: string): [string, string] {
  const d = new Date(iso)
  return [shortDay.format(d), dayMonth.format(d)]
}
