// Staff accounts: admins add, deactivate, reactivate and re-role people and send set-password
// links; any signed-in staff member sets their own password; anyone may ask for a reset (the
// answer never says whether the address is staff). GoTrue admin work uses the service key, which
// stays in this container.
import { accountStore } from '../_shared/db.ts'
import { handleAccounts } from '../_shared/staff-accounts.ts'
import { authAdmin, callerHash, json, userFromRequest } from '../_shared/runtime.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let input: Record<string, unknown>
  try {
    const parsed = (await req.json()) as unknown
    if (!parsed || typeof parsed !== 'object') return json({ error: 'bad_request' }, 400)
    input = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const auth = authAdmin()
  if (!auth) return json({ error: 'not_configured' }, 503)

  try {
    // Anonymous calls carry only the anon key; userFromRequest then finds no user.
    const callerId = input.action === 'forgot' ? null : await userFromRequest(req)
    const result = await handleAccounts(input, callerId, {
      store: accountStore,
      auth,
      addrHash: await callerHash(req),
    })
    return json(result.body, result.status)
  } catch (error) {
    console.error(
      'staff-accounts failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return json({ error: 'server_error' }, 500)
  }
})
