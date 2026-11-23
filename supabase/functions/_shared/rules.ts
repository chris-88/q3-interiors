// Small business rules for slice 3, pure and unit-tested.

const MINUTE = 60_000

/** Customers may change or cancel online until `cutoffMinutes` before the start. */
export function customerCanChange(start: number, now: number, cutoffMinutes: number): boolean {
  return now < start - cutoffMinutes * MINUTE
}

/**
 * When to send the one reminder for an appointment, or null for none.
 * - `bookedAt` is when this start time was agreed (the booking, or the latest reschedule).
 * - No reminder if that happened inside the lead time (the customer has just chosen it).
 * - No reminder once the appointment has started.
 * - A reminder whose moment has passed (e.g. the worker was down) is sent straight away.
 */
export function planReminder(input: {
  start: number
  bookedAt: number
  now: number
  leadMinutes: number
}): number | null {
  const planned = input.start - input.leadMinutes * MINUTE
  if (input.bookedAt > planned) return null
  if (input.start <= input.now) return null
  return Math.max(planned, input.now)
}

/** Remove one appointment's own time from busy periods (so it does not block its own move). */
export function withoutOwnTime(
  busy: { start: number; end: number }[],
  own: { start: number; end: number },
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  for (const b of busy) {
    if (b.end <= own.start || b.start >= own.end) {
      out.push(b)
      continue
    }
    if (b.start < own.start) out.push({ start: b.start, end: own.start })
    if (b.end > own.end) out.push({ start: own.end, end: b.end })
  }
  return out
}
