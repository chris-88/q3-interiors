// Google Calendar and OAuth over plain fetch. Everything that talks to Google goes through the
// `CalendarApi` interface so tests (and the e2e fake) can substitute it.
//
// Scopes (checked against developers.google.com/workspace/calendar/api/auth on 2026-11-20):
//   calendar.freebusy      "View your availability in your calendars" (freebusy.query)
//   calendar.events.owned  "See, create, change, and delete events on Google calendars you own"
//                          (events.insert / events.get on the connected account's own calendar)
//   openid email           to show which Google account is connected
import type { Interval } from './slots.ts'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
]
export const REQUIRED_CALENDAR_SCOPES = GOOGLE_SCOPES.slice(2)

export type GoogleErrorKind =
  | 'auth' // token revoked/expired or scope missing: the calendar is disconnected
  | 'not_found'
  | 'conflict' // an event with this id already exists (or existed)
  | 'rate_limit'
  | 'transient' // 5xx or network: retry
  | 'timeout' // no answer: the request may or may not have taken effect
  | 'permanent' // a 4xx that a retry will not fix

export class GoogleError extends Error {
  readonly kind: GoogleErrorKind
  readonly status: number | undefined
  constructor(kind: GoogleErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'GoogleError'
    this.kind = kind
    this.status = status
  }
}

export type CalendarEventInput = {
  id: string
  summary: string
  description: string
  location?: string
  start: string
  end: string
  timeZone: string
}

export type CalendarEvent = { id: string; htmlLink: string | null; status: string }

export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  scope: string
  email: string | null
}

export interface CalendarApi {
  freeBusy(accessToken: string, calendarId: string, window: Interval): Promise<Interval[]>
  getEvent(accessToken: string, calendarId: string, eventId: string): Promise<CalendarEvent | null>
  insertEvent(
    accessToken: string,
    calendarId: string,
    event: CalendarEventInput,
  ): Promise<CalendarEvent>
  refreshAccessToken(refreshToken: string): Promise<string>
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenSet>
  revoke(token: string): Promise<void>
}

const CALENDAR = 'https://www.googleapis.com/calendar/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

type Fetch = typeof fetch

export function classifyStatus(status: number, body: string): GoogleErrorKind {
  if (status === 401) return 'auth'
  if (status === 404 || status === 410) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limit'
  if (status === 403) {
    if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(body)) return 'rate_limit'
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|forbidden/i.test(body))
      return 'auth'
    return 'permanent'
  }
  if (status >= 500) return 'transient'
  return 'permanent'
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? ''
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))) as Record<
      string,
      unknown
    >
  } catch {
    return {}
  }
}

export function createGoogleCalendar(opts: {
  clientId: string
  clientSecret: string
  fetch?: Fetch
  timeoutMs?: number
}): CalendarApi {
  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 10_000

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (name === 'TimeoutError' || name === 'AbortError')
        throw new GoogleError('timeout', `Google did not answer within ${timeoutMs} ms`)
      throw new GoogleError('transient', `Network error talking to Google: ${String(error)}`)
    }
  }

  async function json(res: Response, what: string): Promise<Record<string, unknown>> {
    const text = await res.text()
    if (!res.ok)
      throw new GoogleError(
        classifyStatus(res.status, text),
        `${what}: HTTP ${res.status} ${text.slice(0, 200)}`,
        res.status,
      )
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new GoogleError('transient', `${what}: unreadable response`)
    }
  }

  const bearer = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  })

  async function tokenRequest(params: Record<string, string>, what: string) {
    const res = await call(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        ...params,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      // invalid_grant: refresh token revoked or expired (including the 7-day Testing-mode expiry).
      const kind =
        res.status === 400 && /invalid_grant/.test(text) ? 'auth' : classifyStatus(res.status, text)
      throw new GoogleError(kind, `${what}: HTTP ${res.status} ${text.slice(0, 200)}`, res.status)
    }
    return JSON.parse(text) as Record<string, unknown>
  }

  return {
    async freeBusy(accessToken, calendarId, window) {
      const res = await call(`${CALENDAR}/freeBusy`, {
        method: 'POST',
        headers: bearer(accessToken),
        body: JSON.stringify({
          timeMin: new Date(window.start).toISOString(),
          timeMax: new Date(window.end).toISOString(),
          items: [{ id: calendarId }],
        }),
      })
      const body = await json(res, 'freebusy')
      const calendars = (body.calendars ?? {}) as Record<
        string,
        { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }
      >
      const entry = calendars[calendarId] ?? Object.values(calendars)[0]
      if (!entry) throw new GoogleError('transient', 'freebusy: calendar missing from the response')
      if (entry.errors && entry.errors.length > 0) {
        const reasons = entry.errors.map((e) => e.reason).join(', ')
        throw new GoogleError(
          reasons.includes('notFound') ? 'auth' : 'transient',
          `freebusy: ${reasons}`,
        )
      }
      return (entry.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    },

    async getEvent(accessToken, calendarId, eventId) {
      const res = await call(
        `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
        {
          headers: bearer(accessToken),
        },
      )
      if (res.status === 404 || res.status === 410) return null
      const body = await json(res, 'events.get')
      return {
        id: String(body.id),
        htmlLink: (body.htmlLink as string) ?? null,
        status: String(body.status ?? 'confirmed'),
      }
    },

    async insertEvent(accessToken, calendarId, event) {
      const res = await call(
        `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
        {
          method: 'POST',
          headers: bearer(accessToken),
          body: JSON.stringify({
            id: event.id,
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: { dateTime: event.start, timeZone: event.timeZone },
            end: { dateTime: event.end, timeZone: event.timeZone },
            transparency: 'opaque',
          }),
        },
      )
      const body = await json(res, 'events.insert')
      return {
        id: String(body.id),
        htmlLink: (body.htmlLink as string) ?? null,
        status: String(body.status ?? 'confirmed'),
      }
    },

    async refreshAccessToken(refreshToken) {
      const body = await tokenRequest(
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        'token refresh',
      )
      return String(body.access_token)
    },

    async exchangeCode(code, codeVerifier, redirectUri) {
      const body = await tokenRequest(
        {
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        },
        'code exchange',
      )
      const claims = typeof body.id_token === 'string' ? decodeJwtPayload(body.id_token) : {}
      return {
        accessToken: String(body.access_token),
        refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
        scope: String(body.scope ?? ''),
        email: typeof claims.email === 'string' ? claims.email : null,
      }
    },

    async revoke(token) {
      await call(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    },
  }
}
