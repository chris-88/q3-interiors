// Wiring for the Edge Functions (Deno only). Reads configuration from the functions container's
// environment, set by the stack's docker-compose.q3-interiors.yml from pass.
import { accessTokenProvider } from './calendar-job.ts'
import { createDb } from './db.ts'
import { createResendMailer, type Mailer } from './email.ts'
import { createGoogleCalendar, type CalendarApi } from './google.ts'
import type { Db } from './types.ts'

const env = (name: string) => Deno.env.get(name)?.trim() || null

export const config = {
  appUrl: env('Q3_APP_URL') ?? 'https://q3.chrisquinn.ie',
  redirectUri:
    env('Q3_GOOGLE_REDIRECT_URI') ??
    'https://api.chrisquinn.ie/q3-interiors/functions/v1/google-oauth-callback',
  googleClientId: env('GOOGLE_CLIENT_ID'),
  googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
  encryptionKey: env('Q3_TOKEN_ENCRYPTION_KEY'),
  workerSecret: env('Q3_WORKER_SECRET'),
  resendKey: env('Q3_RESEND_API_KEY'),
  emailFrom: env('Q3_EMAIL_FROM') ?? 'Q3 Interiors (test) <q3-interiors-test@baz.chrisquinn.ie>',
  supabaseUrl: env('SUPABASE_URL') ?? 'http://api-gw:8000',
  anonKey: env('SUPABASE_ANON_KEY'),
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
