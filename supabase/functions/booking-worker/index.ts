// Retry worker, kicked every minute by pg_cron (private.kick_worker) through pg_net and
// authenticated by the x-worker-secret header. Each run: create pending calendar events, move or
// remove events after changes, send due emails (confirmations, reminders, notices), and check a
// few upcoming bookings against Google (flag only).
import { processCalendarJob } from '../_shared/calendar-job.ts'
import { processSyncJob, reconcile, scheduleReminder } from '../_shared/changes.ts'
import { processCommunication } from '../_shared/email.ts'
import { config, json, runtime } from '../_shared/runtime.ts'

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const tally = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1
}

Deno.serve(async (req) => {
  const given = req.headers.get('x-worker-secret') ?? ''
  if (!config.workerSecret || !sameSecret(given, config.workerSecret)) {
    return json({ error: 'forbidden' }, 403)
  }

  const { db, calendar, accessToken, mailer } = runtime()
  const counts = {
    calendar: {} as Record<string, number>,
    sync: {} as Record<string, number>,
    email: {} as Record<string, number>,
    reconcile: { checked: 0, flagged: 0 },
    removed: {} as Record<string, number>,
  }
  try {
    if (calendar) {
      for (const job of await db.claimCalendarJobs(10)) {
        const outcome = await processCalendarJob(job, {
          db,
          calendar,
          accessToken,
          appUrl: config.appUrl,
        })
        tally(counts.calendar, outcome)
        if (outcome === 'confirmed') {
          const booking = await db.bookingById(job.booking_id)
          if (booking)
            await scheduleReminder(db, booking.id, Date.parse(booking.created_at), Date.now())
        }
      }
      for (const job of await db.claimSyncJobs(10)) {
        tally(counts.sync, await processSyncJob(job, { db, calendar, accessToken }))
      }
    }
    if (mailer) {
      for (const message of await db.claimCommunications(10)) {
        tally(
          counts.email,
          await processCommunication(message, { db, mailer, appUrl: config.appUrl }),
        )
      }
    }
    if (calendar) counts.reconcile = await reconcile({ db, calendar, accessToken }, 10)
    if (calendar) {
      // Events left behind by deleted enquiries (data requests and retention).
      for (const pending of await db.claimEventDeletions(10)) {
        try {
          const connection = await db.getConnection(pending.staff_user_id)
          const calendarId = connection?.calendar_id ?? 'primary'
          const token = await accessToken(pending.staff_user_id)
          const event = await calendar.getEvent(token, calendarId, pending.calendar_event_id)
          if (event && event.status !== 'cancelled') {
            await calendar.deleteEvent(token, calendarId, pending.calendar_event_id)
          }
          await db.eventDeletionDone(pending.calendar_event_id)
          tally(counts.removed, 'done')
        } catch (error) {
          await db.eventDeletionFailed(
            pending.calendar_event_id,
            error instanceof Error ? error.message : String(error),
          )
          tally(counts.removed, 'retrying')
        }
      }
    }
    return json({ ok: true, counts })
  } catch (error) {
    console.error(
      'booking-worker failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return json({ ok: false }, 500)
  }
})
