// Time zone arithmetic with the platform's Intl data only (no library), shared by the Edge
// Functions and the unit tests. Instants are epoch milliseconds (UTC); local times are a
// calendar date string plus minutes since local midnight in the business time zone.

export const BUSINESS_TZ = 'Europe/Dublin'

export type LocalDateTime = {
  /** YYYY-MM-DD */
  date: string
  /** Minutes since local midnight. */
  minutes: number
  /** ISO weekday, 1 = Monday .. 7 = Sunday. */
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

function parts(instant: number, tz: string) {
  const out: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(new Date(instant))) out[p.type] = p.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? ''] ?? 0,
  }
}

/** Offset of `tz` from UTC at `instant`, in minutes (Dublin: 0 in winter, 60 in summer). */
export function offsetMinutes(instant: number, tz: string): number {
  const p = parts(instant, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function toLocal(instant: number, tz: string = BUSINESS_TZ): LocalDateTime {
  const p = parts(instant, tz)
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    minutes: p.hour * 60 + p.minute,
    weekday: p.weekday,
  }
}

/**
 * The instant at which the local wall clock in `tz` reads `date` + `minutes`. Returns null for a
 * wall time that does not exist (the spring-forward gap). For a wall time that happens twice
 * (the autumn fall-back hour) it returns one of the two valid instants.
 */
export function fromLocal(date: string, minutes: number, tz: string = BUSINESS_TZ): number | null {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return null
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  let instant = guess - offsetMinutes(guess, tz) * 60_000
  const second = guess - offsetMinutes(instant, tz) * 60_000
  if (second !== instant) instant = second
  const check = toLocal(instant, tz)
  const dayShift = Math.floor(minutes / 1440)
  const expectedDate = addDays(date, dayShift)
  if (check.date !== expectedDate || check.minutes !== ((minutes % 1440) + 1440) % 1440) return null
  return instant
}

/** Calendar arithmetic on a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** "09:30" -> 570. Accepts "24:00" as end of day. */
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const h = Number(match[1])
  const min = Number(match[2])
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null
  return h * 60 + min
}

export function formatLocal(instant: number, tz: string = BUSINESS_TZ) {
  const date = new Date(instant)
  return {
    weekday: new Intl.DateTimeFormat('en-IE', { timeZone: tz, weekday: 'long' }).format(date),
    date: new Intl.DateTimeFormat('en-IE', {
      timeZone: tz,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat('en-IE', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date),
  }
}
