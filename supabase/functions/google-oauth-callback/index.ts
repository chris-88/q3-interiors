// Google's redirect target: https://api.chrisquinn.ie/q3-interiors/functions/v1/google-oauth-callback
// It carries no Supabase JWT (Google's browser redirect cannot add one), so the stack's functions
// router lets this one function through without JWT verification (FUNCTIONS_PUBLIC). It is
// authorised instead by the single-use, ten-minute `state` created for a signed-in staff member.
import { encryptSecret, sha256Hex } from '../_shared/crypto.ts'
import { oauthStore } from '../_shared/db.ts'
import { REQUIRED_CALENDAR_SCOPES } from '../_shared/google.ts'
import { config, runtime } from '../_shared/runtime.ts'

function back(result: 'connected' | 'error', reason?: string): Response {
  const params = new URLSearchParams({ calendar: result, ...(reason ? { reason } : {}) })
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${config.staffUrl}/#/settings?${params.toString()}`,
      'Cache-Control': 'no-store',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const code = url.searchParams.get('code')
  const googleError = url.searchParams.get('error')

  const pending = state ? await oauthStore.takeState(await sha256Hex(state)) : null
  if (!pending) return back('error', 'expired')
  if (googleError || !code)
    return back('error', googleError === 'access_denied' ? 'denied' : 'google')

  const { calendar } = runtime()
  if (!calendar || !config.encryptionKey) return back('error', 'not_configured')

  try {
    const tokens = await calendar.exchangeCode(code, pending.verifier, config.redirectUri)
    const granted = tokens.scope.split(/\s+/)
    if (!REQUIRED_CALENDAR_SCOPES.every((s) => granted.includes(s))) {
      // Google lets people untick individual permissions; both calendar ones are needed.
      if (tokens.refreshToken) await calendar.revoke(tokens.refreshToken).catch(() => undefined)
      return back('error', 'scopes')
    }
    if (!tokens.refreshToken) return back('error', 'no_refresh_token')
    await oauthStore.store(
      pending.staffId,
      tokens.email,
      tokens.scope,
      await encryptSecret(tokens.refreshToken, config.encryptionKey),
    )
    return back('connected')
  } catch (error) {
    console.error(
      'google-oauth-callback failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return back('error', 'exchange')
  }
})
