// Customer scheduling API. Called from the browser with the anon key (which satisfies the
// functions router's JWT check); every action is authorised by the enquiry access token in the
// body. Logs never include request bodies or customer details.
import { handlePublic } from '../_shared/public-booking.ts'
import {
  config,
  json,
  limiterFor,
  photoStore,
  quoteFiles,
  readJson,
  runtime,
} from '../_shared/runtime.ts'

// A photo (2 MiB) and its thumbnail as base64 in JSON, with room to spare; nothing larger is read.
const MAX_BODY_BYTES = 3_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const read = await readJson(req, MAX_BODY_BYTES)
  if (!read.ok)
    return json({ error: read.status === 413 ? 'too_large' : 'bad_request' }, read.status)
  const body = read.body
  try {
    const rt = runtime()
    const result = await handlePublic(body, {
      ...rt,
      appUrl: config.appUrl,
      now: Date.now,
      limit: await limiterFor(req, rt.db),
      photos: photoStore(),
      quoteFiles: quoteFiles(),
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
