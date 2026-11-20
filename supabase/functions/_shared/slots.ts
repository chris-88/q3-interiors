import { addDays, BUSINESS_TZ, fromLocal, parseClock, toLocal } from './time.ts'

/** Half-open interval [start, end) in epoch milliseconds. */
export type Interval = { start: number; end: number }

export type WeeklyHours = Record<string, [string, string][]>

export type AvailabilityRules = {
  weeklyHours: WeeklyHours
  minNoticeMinutes: number
  horizonDays: number
  dailyVisitLimit: number
  slotStepMinutes: number
}

export type SlotType = {
  mode: 'phone' | 'on_site'
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
}

/** A live booking: its buffered range, its start, and whether it is an on-site visit. */
export type Reservation = { blocked: Interval; start: number; mode: 'phone' | 'on_site' }

export type Slot = {
  start: string
  end: string
  /** Local date (YYYY-MM-DD) and time (HH:MM) in the business time zone. */
  date: string
  time: string
}

export type SlotInput = {
  now: number
  type: SlotType
  rules: AvailabilityRules
  /** Busy periods from the calendar (free/busy already expands recurring and all-day events). */
  busy: Interval[]
  reservations: Reservation[]
  tz?: string
}

const MINUTE = 60_000

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * Candidate appointment starts: inside working hours (the appointment itself; buffers may fall
 * outside them), at least the minimum notice from now, within the horizon (counted in local
 * days, today included), with the buffered range clear of every busy period and live booking,
 * and on-site visits only on days under the daily visit limit.
 */
export function generateSlots({
  now,
  type,
  rules,
  busy,
  reservations,
  tz = BUSINESS_TZ,
}: SlotInput): Slot[] {
  const slots: Slot[] = []
  const earliest = now + rules.minNoticeMinutes * MINUTE
  const duration = type.durationMinutes * MINUTE
  const obstacles = [...busy, ...reservations.map((r) => r.blocked)]
  const today = toLocal(now, tz).date

  for (let day = 0; day < rules.horizonDays; day += 1) {
    const date = addDays(today, day)
    const weekday = toLocal(fromLocal(date, 12 * 60, tz) ?? now, tz).weekday
    const windows = rules.weeklyHours[String(weekday)] ?? []
    if (windows.length === 0) continue

    if (type.mode === 'on_site') {
      const visits = reservations.filter(
        (r) => r.mode === 'on_site' && toLocal(r.start, tz).date === date,
      ).length
      if (visits >= rules.dailyVisitLimit) continue
    }

    for (const [from, to] of windows) {
      const open = parseClock(from)
      const close = parseClock(to)
      if (open === null || close === null || close <= open) continue
      const closeAt = fromLocal(date, close, tz) ?? fromLocal(date, close + 60, tz)
      if (closeAt === null) continue

      for (let m = open; m + type.durationMinutes <= close; m += rules.slotStepMinutes) {
        const start = fromLocal(date, m, tz)
        if (start === null) continue
        const end = start + duration
        if (end > closeAt || start < earliest) continue
        const blocked = {
          start: start - type.bufferBeforeMinutes * MINUTE,
          end: end + type.bufferAfterMinutes * MINUTE,
        }
        if (obstacles.some((o) => overlaps(o, blocked))) continue
        slots.push({
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          date,
          time: clock(toLocal(start, tz).minutes),
        })
      }
    }
  }
  return slots
}

/** The window free/busy must cover to evaluate every slot `generateSlots` could return. */
export function availabilityWindow(
  now: number,
  rules: AvailabilityRules,
  type: SlotType,
): Interval {
  return {
    start: now - type.bufferBeforeMinutes * MINUTE,
    end: now + (rules.horizonDays + 1) * 24 * 60 * MINUTE + type.bufferAfterMinutes * MINUTE,
  }
}
