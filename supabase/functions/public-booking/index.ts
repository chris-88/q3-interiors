// Customer scheduling API. Called from the browser with the anon key (which satisfies the
// functions router's JWT check); every action is authorised by the enquiry access token in the
// body. Logs never include request bodies or customer details.
import { handlePublic } from '../_shared/public-booking.ts'
import { config, json, limiterFor, runtime } from '../_shared/runtime.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  try {
    const rt = runtime()
    const result = await handlePublic(body, {
      ...rt,
      appUrl: config.appUrl,
      now: Date.now,
      limit: await limiterFor(req, rt.db),
    })
    return json(result.body, result.status)
  } catch (error) {
    console.error(
      'public-booking failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return json({ error: 'server_error' }, 500)
  }
})
