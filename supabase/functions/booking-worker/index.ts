// Retry worker: creates pending calendar events and sends queued emails. Kicked every minute by
// pg_cron (private.kick_worker) through pg_net, authenticated by the x-worker-secret header.
import { processCalendarJob } from '../_shared/calendar-job.ts'
import { processCommunication } from '../_shared/email.ts'
import { config, json, runtime } from '../_shared/runtime.ts'

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  const given = req.headers.get('x-worker-secret') ?? ''
  if (!config.workerSecret || !sameSecret(given, config.workerSecret))
    return json({ error: 'forbidden' }, 403)

  const { db, calendar, accessToken, mailer } = runtime()
  const counts = { calendar: {} as Record<string, number>, email: {} as Record<string, number> }
  try {
    if (calendar) {
      for (const job of await db.claimCalendarJobs(10)) {
        const outcome = await processCalendarJob(job, {
          db,
          calendar,
          accessToken,
          appUrl: config.appUrl,
        })
        counts.calendar[outcome] = (counts.calendar[outcome] ?? 0) + 1
      }
    }
    if (mailer) {
      for (const message of await db.claimCommunications(10)) {
        const outcome = await processCommunication(message, { db, mailer })
        counts.email[outcome] = (counts.email[outcome] ?? 0) + 1
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
