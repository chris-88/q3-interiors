// Staff cancel and reschedule from the workspace. The caller must be signed in and on the staff
// allowlist; the work goes through the same server paths as customer changes.
import { oauthStore } from '../_shared/db.ts'
import { handleStaff } from '../_shared/staff-booking.ts'
import { config, json, runtime, userFromRequest } from '../_shared/runtime.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const userId = await userFromRequest(req)
  if (!userId || !(await oauthStore.isStaff(userId))) return json({ error: 'forbidden' }, 403)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  try {
    const result = await handleStaff(body, userId, {
      ...runtime(),
      appUrl: config.appUrl,
      now: Date.now,
    })
    return json(result.body, result.status)
  } catch (error) {
    console.error('staff-booking failed:', error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'server_error' }, 500)
  }
})
