// Staff calendar connection: start the Google authorisation, check health, disconnect.
// The caller must be signed in and on the staff allowlist.
import { decryptSecret, pkceChallenge, randomToken, sha256Hex } from '../_shared/crypto.ts'
import { oauthStore } from '../_shared/db.ts'
import { AUTH_URL, GOOGLE_SCOPES } from '../_shared/google.ts'
import { config, json, runtime, userFromRequest } from '../_shared/runtime.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const userId = await userFromRequest(req)
  if (!userId || !(await oauthStore.isStaff(userId))) return json({ error: 'forbidden' }, 403)

  let action = ''
  try {
    action = String(((await req.json()) as { action?: unknown }).action ?? '')
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const { db, calendar, accessToken } = runtime()
  if (!calendar || !config.googleClientId) return json({ error: 'not_configured' }, 200)

  try {
    if (action === 'start') {
      const state = randomToken(32)
      const verifier = randomToken(48)
      await oauthStore.createState(await sha256Hex(state), userId, verifier)
      const url = new URL(AUTH_URL)
      url.search = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        // Always ask, so Google always returns a refresh token (needed after a reconnect).
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: 'S256',
      }).toString()
      return json({ url: url.toString() })
    }

    if (action === 'test') {
      const connection = await db.getConnection(userId)
      if (!connection || connection.status !== 'connected') return json({ status: 'disconnected' })
      const now = Date.now()
      await calendar.freeBusy(await accessToken(userId), connection.calendar_id, {
        start: now,
        end: now + 86_400_000,
      })
      return json({ status: 'ok' })
    }

    if (action === 'disconnect') {
      const ciphertext = await db.getTokenCiphertext(userId)
      if (ciphertext && config.encryptionKey) {
        try {
          await calendar.revoke(await decryptSecret(ciphertext, config.encryptionKey))
        } catch {
          // Revocation is best effort; the token is deleted either way.
        }
      }
      await oauthStore.remove(userId)
      return json({ status: 'disconnected' })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error('calendar-admin failed:', message)
    return json({ status: 'error', message: message.slice(0, 200) }, 200)
  }
})
