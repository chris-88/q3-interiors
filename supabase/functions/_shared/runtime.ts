// Wiring for the Edge Functions (Deno only). Reads configuration from the functions container's
// environment, set by the stack's docker-compose.q3-interiors.yml from pass.
import { accessTokenProvider } from './calendar-job.ts'
import { SITE_URL, STAFF_URL } from './site.ts'
import { createDb } from './db.ts'
import { createResendMailer, type Mailer } from './email.ts'
import { createGoogleCalendar, type CalendarApi } from './google.ts'
import { addressHash, clientAddress, type Limiter } from './limits.ts'
import { createAuthAdmin, type AuthAdmin } from './gotrue.ts'
import { createPhotoStore, type PhotoStore } from './storage.ts'
import type { Db } from './types.ts'

const env = (name: string) => Deno.env.get(name)?.trim() || null

export const config = {
  // One value for every absolute URL (see site.ts); Q3_APP_URL in the stack env is no longer read.
  appUrl: SITE_URL,
  // The staff console: staff alerts, account emails, the Google Calendar return.
  staffUrl: STAFF_URL,
  redirectUri:
    env('Q3_GOOGLE_REDIRECT_URI') ??
    'https://api.chrisquinn.ie/q3-interiors/functions/v1/google-oauth-callback',
  googleClientId: env('GOOGLE_CLIENT_ID'),
  googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
  encryptionKey: env('Q3_TOKEN_ENCRYPTION_KEY'),
  workerSecret: env('Q3_WORKER_SECRET'),
  resendKey: env('Q3_RESEND_API_KEY'),
  emailFrom: env('Q3_EMAIL_FROM') ?? 'Q3 Interiors <bookings@q3interiors.ie>',
  supabaseUrl: env('SUPABASE_URL') ?? 'http://api-gw:8000',
  anonKey: env('SUPABASE_ANON_KEY'),
  // Only for GoTrue admin calls (staff accounts); never leaves the functions container.
  serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
}

export type Runtime = {
  db: Db
  calendar: CalendarApi | null
  accessToken: ReturnType<typeof accessTokenProvider>
  mailer: Mailer | null
}

/** Google is optional at runtime: without credentials booking is unavailable, contact-me works. */
export function runtime(): Runtime {
  const db = createDb()
  const calendar =
    config.googleClientId && config.googleClientSecret && config.encryptionKey
      ? createGoogleCalendar({
          clientId: config.googleClientId,
          clientSecret: config.googleClientSecret,
        })
      : null
  const accessToken = calendar
    ? accessTokenProvider(db, calendar, config.encryptionKey ?? '')
    : async () => {
        throw new Error('Google is not configured')
      }
  const mailer = config.resendKey
    ? createResendMailer({ apiKey: config.resendKey, from: config.emailFrom })
    : null
  return { db, calendar, accessToken, mailer }
}

/** GoTrue admin, or null when the service key is not configured. */
export function authAdmin(): AuthAdmin | null {
  return config.serviceKey
    ? createAuthAdmin({ url: config.supabaseUrl, serviceKey: config.serviceKey })
    : null
}

/** The private photo bucket (service key, internal gateway), or null without the key. */
export function photoStore(): PhotoStore | null {
  return config.serviceKey
    ? createPhotoStore({ url: config.supabaseUrl, serviceKey: config.serviceKey })
    : null
}

/**
 * The request body as JSON, refusing anything over `maxBytes` before it is all read. The gateway
 * and Cloudflare let at least 24 MB through (measured 2026-11-27), so the limit lives here.
 */
export async function readJson(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return { ok: false, status: 413 }
  const reader = req.body?.getReader()
  if (!reader) return { ok: false, status: 400 }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false, status: 413 }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.length
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { ok: false, status: 400 }
  }
}

/** Keyed hash of the caller's address (the same secret as the other limiters). */
export async function callerHash(req: Request): Promise<string> {
  return addressHash(clientAddress(req.headers), config.workerSecret ?? '')
}

/** The per-address limiter for one request (addresses are hashed, never stored). */
export async function limiterFor(req: Request, db: Db): Promise<Limiter> {
  const secret = config.workerSecret ?? ''
  const hash = await addressHash(clientAddress(req.headers), secret)
  return async (bucket, idemKey) => {
    const settings = await db.getSettings()
    const limit =
      bucket === 'booking_write'
        ? (settings.booking_write_limit_per_hour ?? 20)
        : (settings.booking_read_limit_per_hour ?? 300)
    return db.rateLimitTake(bucket, hash, idemKey, limit)
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The signed-in user behind a request's bearer token, checked with GoTrue. */
export async function userFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization')
  if (!auth || !config.anonKey) return null
  const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: config.anonKey },
  })
  if (!res.ok) return null
  const user = (await res.json()) as { id?: string }
  return user.id ?? null
}
