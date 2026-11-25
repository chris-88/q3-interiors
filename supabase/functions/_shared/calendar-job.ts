import { STAFF_URL } from './site.ts'
import { GoogleError, type CalendarApi, type CalendarEventInput } from './google.ts'
import { decryptSecret } from './crypto.ts'
import { BUSINESS_TZ } from './time.ts'
import type { BookingContext, CalendarJob, Db } from './types.ts'

/** Seconds to wait before attempt n+1 (n = attempts made so far). */
export function backoffSeconds(attempts: number): number {
  const steps = [30, 60, 120, 300, 600, 1800, 3600]
  return steps[Math.min(Math.max(attempts - 1, 0), steps.length - 1)] ?? 3600
}

/** A reconnect is needed: wait longer before trying again. */
const AUTH_RETRY_SECONDS = 15 * 60

export type AccessTokenProvider = (staffId: string) => Promise<string>

/**
 * Access tokens from the stored, encrypted refresh token. An auth failure marks the calendar
 * disconnected (staff see an alert; customers get the contact-me path) and is rethrown.
 */
export function accessTokenProvider(
  db: Db,
  calendar: CalendarApi,
  encryptionKey: string,
): AccessTokenProvider {
  const cache = new Map<string, string>()
  return async (staffId) => {
    const cached = cache.get(staffId)
    if (cached) return cached
    const ciphertext = await db.getTokenCiphertext(staffId)
    if (!ciphertext) {
      await db.markDisconnected(staffId, 'No Google Calendar is connected')
      throw new GoogleError('auth', 'No Google Calendar is connected')
    }
    try {
      const token = await calendar.refreshAccessToken(
        await decryptSecret(ciphertext, encryptionKey),
      )
      cache.set(staffId, token)
      return token
    } catch (error) {
      if (error instanceof GoogleError && error.kind === 'auth') {
        await db.markDisconnected(
          staffId,
          `Google refused the stored authorisation: ${error.message}`,
        )
      }
      throw error
    }
  }
}

export function eventFor(ctx: BookingContext, _appUrl: string): CalendarEventInput {
  const a = ctx.enquiry.answers
  const name = typeof a.name === 'string' ? a.name : 'Customer'
  const phone = typeof a.phone === 'string' ? a.phone : ''
  const address =
    typeof ctx.enquiry.site_details?.site_address === 'string'
      ? ctx.enquiry.site_details.site_address
      : ''
  const notes =
    typeof ctx.enquiry.site_details?.access_notes === 'string'
      ? ctx.enquiry.site_details.access_notes
      : ''
  const lines = [
    `${ctx.type.label} for enquiry ${ctx.enquiry.reference}.`,
    '',
    `Customer: ${name}`,
    phone ? `Phone: ${phone}` : null,
    ctx.type.mode === 'phone'
      ? `Call the customer on ${phone || 'the number in the enquiry'}.`
      : null,
    ctx.type.mode === 'on_site' && address ? `Address: ${address}` : null,
    ctx.type.mode === 'on_site' && notes ? `Access notes: ${notes}` : null,
    '',
    `Full enquiry: ${STAFF_URL}/#/enquiries/${ctx.enquiry.id}`,
  ].filter((line): line is string => line !== null)
  return {
    id: ctx.booking.calendar_event_id,
    summary: `${ctx.type.label}: ${name} (${ctx.enquiry.reference})`,
    description: lines.join('\n'),
    location: ctx.type.mode === 'on_site' && address ? address : undefined,
    start: ctx.booking.starts_at,
    end: ctx.booking.ends_at,
    timeZone: BUSINESS_TZ,
  }
}

export type CalendarJobDeps = {
  db: Db
  calendar: CalendarApi
  accessToken: AccessTokenProvider
  appUrl: string
}

export type CalendarJobOutcome = 'confirmed' | 'retrying' | 'failed' | 'cancelled'

/**
 * Create the booking's calendar event exactly once. The event id is fixed on the booking before
 * the first attempt, so every attempt first asks Google whether the event already exists
 * (reconcile-before-retry): a timeout after Google created it is resolved by that read, never by
 * a second insert. A duplicate-id 409 is resolved the same way.
 */
export async function processCalendarJob(
  job: CalendarJob,
  deps: CalendarJobDeps,
): Promise<CalendarJobOutcome> {
  const { db, calendar } = deps
  const ctx = await db.bookingContext(job.booking_id)
  if (!ctx) {
    await db.failCalendarJob(job.id, 'Booking no longer exists', false)
    return 'failed'
  }
  if (ctx.booking.state === 'confirmed') {
    await db.completeCalendarJob(job.id, null)
    return 'confirmed'
  }
  if (ctx.booking.state === 'cancelled') {
    // Cancelled before its event was made: finishing the job queues a (no-op) delete.
    await db.completeCalendarJob(job.id, null)
    return 'cancelled'
  }
  await db.calendarJobStarted(job.id)
  const calendarId = ctx.connection?.calendar_id ?? 'primary'
  const eventId = ctx.booking.calendar_event_id
  let insertSent = false

  try {
    const token = await deps.accessToken(ctx.staff.user_id)
    const existing = await calendar.getEvent(token, calendarId, eventId)
    if (existing && existing.status !== 'cancelled') {
      await db.completeCalendarJob(job.id, existing.htmlLink)
      return 'confirmed'
    }
    if (existing && existing.status === 'cancelled') {
      await db.failCalendarJob(
        job.id,
        `Calendar event ${eventId} was deleted in Google Calendar`,
        false,
      )
      return 'failed'
    }
    insertSent = true
    try {
      const created = await calendar.insertEvent(token, calendarId, eventFor(ctx, deps.appUrl))
      await db.completeCalendarJob(job.id, created.htmlLink)
      return 'confirmed'
    } catch (error) {
      if (error instanceof GoogleError && error.kind === 'conflict') {
        const again = await calendar.getEvent(token, calendarId, eventId)
        if (again && again.status !== 'cancelled') {
          await db.completeCalendarJob(job.id, again.htmlLink)
          return 'confirmed'
        }
        await db.failCalendarJob(
          job.id,
          `Calendar event id ${eventId} is taken by a deleted event`,
          false,
        )
        return 'failed'
      }
      throw error
    }
  } catch (error) {
    const g = error instanceof GoogleError ? error : new GoogleError('transient', String(error))
    // Only a request that may have reached Google leaves the outcome unknown.
    const unknown = insertSent && (g.kind === 'timeout' || g.kind === 'transient')
    const message = `${g.kind}: ${g.message}`
    if (g.kind === 'transient' || g.kind === 'timeout' || g.kind === 'rate_limit') {
      await db.recordCalendarError(ctx.staff.user_id, message)
    }
    const retryable = g.kind !== 'permanent' && g.kind !== 'not_found'
    if (retryable && job.attempts < job.max_attempts) {
      await db.retryCalendarJob(
        job.id,
        message,
        unknown,
        g.kind === 'auth' ? AUTH_RETRY_SECONDS : backoffSeconds(job.attempts),
      )
      return 'retrying'
    }
    await db.failCalendarJob(job.id, message, unknown)
    return 'failed'
  }
}
