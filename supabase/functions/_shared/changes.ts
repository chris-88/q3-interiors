// Slice 3 server logic shared by public-booking (customers), staff-booking (staff) and the
// booking-worker: cancel, reschedule, calendar sync jobs, reminders and reconcile.
import { backoffSeconds, processCalendarJob, type AccessTokenProvider } from './calendar-job.ts'
import { processCommunication, type Mailer } from './email.ts'
import { GoogleError, type CalendarApi } from './google.ts'
import { planReminder, withoutOwnTime } from './rules.ts'
import { availabilityWindow, generateSlots, type Slot } from './slots.ts'
import { BUSINESS_TZ, formatLocal } from './time.ts'
import type { AppointmentType, BookingRow, Db, SyncJob } from './types.ts'

export type ChangeDeps = {
  db: Db
  calendar: CalendarApi | null
  accessToken: AccessTokenProvider
  mailer: Mailer | null
  appUrl: string
  now: () => number
}

const LIVE = new Set(['reserved', 'calendar_pending', 'confirmed'])
export const isLive = (b: { state: string }) => LIVE.has(b.state)

/** Queue the one reminder for a confirmed booking's current start, if the rules allow one. */
export async function scheduleReminder(db: Db, bookingId: string, bookedAt: number, now: number) {
  const booking = await db.bookingById(bookingId)
  if (!booking || booking.state !== 'confirmed') return
  const settings = await db.getSettings()
  const planned = planReminder({
    start: Date.parse(booking.starts_at),
    bookedAt,
    now,
    leadMinutes: settings.reminder_lead_minutes,
  })
  if (planned !== null) await db.scheduleReminder(bookingId, new Date(planned).toISOString())
}

/**
 * Move or remove the booking's Google event. Idempotent: every attempt reads the event first.
 * The database time is the truth; a failure after retries lands in needs-attention.
 */
export async function processSyncJob(
  job: SyncJob,
  deps: Pick<ChangeDeps, 'db' | 'calendar' | 'accessToken'>,
): Promise<'done' | 'retrying' | 'failed'> {
  const { db, calendar } = deps
  const ctx = await db.bookingContext(job.booking_id)
  if (!ctx || !calendar) {
    await db.failSyncJob(
      job.id,
      ctx ? 'Google Calendar is not configured' : 'Booking no longer exists',
    )
    return 'failed'
  }
  const calendarId = ctx.connection?.calendar_id ?? 'primary'
  const eventId = ctx.booking.calendar_event_id
  try {
    const token = await deps.accessToken(ctx.staff.user_id)
    const event = await calendar.getEvent(token, calendarId, eventId)
    if (job.kind === 'delete_calendar_event') {
      if (event && event.status !== 'cancelled')
        await calendar.deleteEvent(token, calendarId, eventId)
      await db.completeSyncJob(job.id, null, 'Event removed')
      return 'done'
    }
    // Update. The booking may have been cancelled since; then there is nothing to move.
    if (ctx.booking.state === 'cancelled') {
      await db.completeSyncJob(job.id, null, 'Booking cancelled; nothing to move')
      return 'done'
    }
    if (!event) {
      if (ctx.booking.state !== 'confirmed') {
        // Not created yet: the create job will write the current time; check again shortly.
        await db.retrySyncJob(job.id, 'Event not created yet', 60)
        return 'retrying'
      }
      await db.failSyncJob(job.id, 'Event is missing from Google Calendar')
      return 'failed'
    }
    if (event.status === 'cancelled') {
      await db.failSyncJob(job.id, 'Event was deleted in Google Calendar')
      return 'failed'
    }
    const start = Date.parse(ctx.booking.starts_at)
    const end = Date.parse(ctx.booking.ends_at)
    if (event.start !== start || event.end !== end) {
      await calendar.moveEvent(token, calendarId, eventId, {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        timeZone: BUSINESS_TZ,
      })
    }
    const when = formatLocal(start)
    await db.completeSyncJob(
      job.id,
      new Date(start).toISOString(),
      `Google Calendar event at ${when.weekday} ${when.date} ${when.time}`,
    )
    return 'done'
  } catch (error) {
    const g = error instanceof GoogleError ? error : new GoogleError('transient', String(error))
    const retryable = g.kind !== 'permanent' && g.kind !== 'not_found'
    if (retryable && job.attempts < job.max_attempts) {
      await db.retrySyncJob(
        job.id,
        `${g.kind}: ${g.message}`,
        g.kind === 'auth' ? 900 : backoffSeconds(job.attempts),
      )
      return 'retrying'
    }
    await db.failSyncJob(job.id, `${g.kind}: ${g.message}`)
    return 'failed'
  }
}

/**
 * Flag only: compare upcoming confirmed bookings with Google and record a mismatch for staff.
 * Never changes the booking itself.
 */
export async function reconcile(
  deps: Pick<ChangeDeps, 'db' | 'calendar' | 'accessToken'>,
  limit = 10,
) {
  const { db, calendar } = deps
  if (!calendar) return { checked: 0, flagged: 0 }
  let checked = 0
  let flagged = 0
  for (const booking of await db.bookingsToReconcile(limit)) {
    const ctx = await db.bookingContext(booking.id)
    if (!ctx) continue
    try {
      const token = await deps.accessToken(ctx.staff.user_id)
      const event = await calendar.getEvent(
        token,
        ctx.connection?.calendar_id ?? 'primary',
        booking.calendar_event_id,
      )
      let mismatch: string | null = null
      if (!event || event.status === 'cancelled') mismatch = 'Event deleted in Google Calendar'
      else if (
        event.start !== Date.parse(booking.starts_at) ||
        event.end !== Date.parse(booking.ends_at)
      ) {
        const moved = event.start ? formatLocal(event.start) : null
        mismatch = `Event moved in Google Calendar${moved ? ` to ${moved.weekday} ${moved.date} ${moved.time}` : ''}`
      }
      await db.recordReconcile(booking.id, mismatch)
      checked += 1
      if (mismatch) flagged += 1
    } catch {
      // Unreachable now; the next run tries again. Connection problems are flagged elsewhere.
    }
  }
  return { checked, flagged }
}

/** Run whatever is due for one booking now: calendar jobs, then its messages. */
export async function runDueFor(deps: ChangeDeps, bookingId: string) {
  const { db } = deps
  if (deps.calendar) {
    const [create] = await db.claimCalendarJobs(1, bookingId)
    if (create) {
      const outcome = await processCalendarJob(create, {
        db,
        calendar: deps.calendar,
        accessToken: deps.accessToken,
        appUrl: deps.appUrl,
      })
      if (outcome === 'confirmed') {
        const booking = await db.bookingById(bookingId)
        await scheduleReminder(
          db,
          bookingId,
          booking ? Date.parse(booking.created_at) : deps.now(),
          deps.now(),
        )
      }
    }
    for (const job of await db.claimSyncJobs(2, bookingId)) await processSyncJob(job, deps)
  }
  if (deps.mailer) {
    for (const message of await db.claimCommunications(3, bookingId)) {
      await processCommunication(message, {
        db,
        mailer: deps.mailer,
        appUrl: deps.appUrl,
        now: deps.now,
      })
    }
  }
}

export type MoveAvailability =
  | { status: 'ok'; slots: Slot[]; timezone: string }
  | { status: 'unavailable'; reason: 'calendar_unavailable' | 'calendar_error' | 'no_staff' }

/** Free slots for moving `booking`: its own time and buffers do not block it. */
export async function availabilityForMove(
  deps: Pick<ChangeDeps, 'db' | 'calendar' | 'accessToken' | 'now'>,
  booking: BookingRow,
): Promise<MoveAvailability> {
  const { db } = deps
  const type = (await db.listTypes()).find(
    (t) => t.id === booking.appointment_type_id,
  ) as AppointmentType
  const rules = await db.getAvailability(booking.staff_user_id)
  const connection = await db.getConnection(booking.staff_user_id)
  if (!rules || !type) return { status: 'unavailable', reason: 'no_staff' }
  if (!deps.calendar || !connection || connection.status !== 'connected') {
    return { status: 'unavailable', reason: 'calendar_unavailable' }
  }
  const now = deps.now()
  const st = {
    mode: type.mode,
    durationMinutes: type.duration_minutes,
    bufferBeforeMinutes: type.buffer_before_minutes,
    bufferAfterMinutes: type.buffer_after_minutes,
  }
  const ruleSet = {
    weeklyHours: rules.working_hours,
    minNoticeMinutes: rules.min_notice_minutes,
    horizonDays: rules.horizon_days,
    dailyVisitLimit: rules.daily_visit_limit,
    slotStepMinutes: rules.slot_step_minutes,
  }
  const window = availabilityWindow(now, ruleSet, st)
  let busy
  try {
    busy = await deps.calendar.freeBusy(
      await deps.accessToken(booking.staff_user_id),
      connection.calendar_id,
      window,
    )
  } catch (error) {
    const g = error instanceof GoogleError ? error : new GoogleError('transient', String(error))
    return {
      status: 'unavailable',
      reason: g.kind === 'auth' ? 'calendar_unavailable' : 'calendar_error',
    }
  }
  const own = { start: Date.parse(booking.starts_at), end: Date.parse(booking.ends_at) }
  const reservations = await db.liveReservations(booking.staff_user_id, window, booking.id)
  const slots = generateSlots({
    now,
    type: st,
    rules: ruleSet,
    busy: withoutOwnTime(busy, own),
    reservations,
  }).filter((s) => Date.parse(s.start) !== own.start)
  return { status: 'ok', slots, timezone: BUSINESS_TZ }
}

export type RescheduleOutcome =
  | { status: 'rescheduled'; changed: boolean }
  | { status: 'not_live' }
  | { status: 'unavailable'; reason: string }
  | { status: 'slot_unavailable'; alternatives: Slot[] }

/** Move a live booking to `startIso` (checked against fresh availability), then sync. */
export async function reschedule(
  deps: ChangeDeps,
  booking: BookingRow,
  startIso: string,
  actor: 'customer' | 'staff',
  actorUserId?: string,
): Promise<RescheduleOutcome> {
  const { db } = deps
  if (!isLive(booking)) return { status: 'not_live' }
  const start = new Date(startIso).toISOString()
  if (Date.parse(start) === Date.parse(booking.starts_at))
    return { status: 'rescheduled', changed: false }
  const near = (slots: Slot[]) => {
    const after = slots.filter((s) => s.start >= start)
    return (after.length ? after : slots).slice(0, 6)
  }
  const before = await availabilityForMove(deps, booking)
  if (before.status !== 'ok') return before
  if (!before.slots.some((s) => s.start === start))
    return { status: 'slot_unavailable', alternatives: near(before.slots) }

  const result = await db.rescheduleBooking(booking.id, start, actor, actorUserId)
  if (result.status === 'slot_unavailable') {
    // Lost a race: the old time is kept; offer what is free now.
    const fresh = await availabilityForMove(deps, booking)
    return {
      status: 'slot_unavailable',
      alternatives: fresh.status === 'ok' ? near(fresh.slots) : [],
    }
  }
  if (result.status !== 'rescheduled') return { status: 'not_live' }
  if (result.changed) {
    await scheduleReminder(db, booking.id, deps.now(), deps.now())
    await runDueFor(deps, booking.id)
  }
  return { status: 'rescheduled', changed: result.changed }
}

export async function cancel(
  deps: ChangeDeps,
  booking: BookingRow,
  actor: 'customer' | 'staff',
  reason: string | null,
  actorUserId?: string,
): Promise<{ status: 'cancelled'; changed: boolean } | { status: 'not_live' }> {
  const result = await deps.db.cancelBooking(booking.id, actor, reason, actorUserId)
  if (result.status !== 'cancelled') return { status: 'not_live' }
  if (result.changed) await runDueFor(deps, booking.id)
  return { status: 'cancelled', changed: result.changed }
}
