const dateTime = new Intl.DateTimeFormat('en-IE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Dublin',
})

/** A timestamp in Irish time, e.g. "20 Nov 2026, 11:42". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date)
}
