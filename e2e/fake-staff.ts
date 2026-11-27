import type { Page, Route } from '@playwright/test'
import { estimateRange, isValidPercent } from '../supabase/functions/_shared/estimate.ts'
import { WORDING } from '../supabase/functions/_shared/messages.ts'
import type { AuthAdmin } from '../supabase/functions/_shared/gotrue.ts'
import {
  handleAccounts,
  type AccountStore,
  type StaffAccount,
} from '../supabase/functions/_shared/staff-accounts.ts'

/**
 * A stand-in for Supabase Auth, the REST tables the staff screens read, and the real
 * staff-accounts logic (running in Node over in-memory stores). Nothing reaches the real stack.
 */
export type FakeStaff = StaffAccount & { created_at: string }

/** The two local builds under test (see playwright.config.ts). */
const PORT = Number(process.env.E2E_PORT ?? 4173)
export const PUBLIC_URL = `http://127.0.0.1:${PORT}`
export const STAFF_URL_LOCAL = `http://127.0.0.1:${PORT + 1}`

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
/** An unsigned token in JWT shape: the browser only reads its claims. */
const fakeJwt = (sub: string) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`
const subOf = (auth: string | undefined) => {
  const token = auth?.replace(/^Bearer /, '') ?? ''
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
      sub?: string
    }
    return payload.sub ?? null
  } catch {
    return null
  }
}

export type StaffWorld = {
  staff: Map<string, FakeStaff>
  passwords: Map<string, string>
  queued: { userId: string; template: string }[]
  /** Valid set-password token hashes -> user id (single use). */
  tokens: Map<string, string>
  bookable: { id: string | null }
  rpcCalls: { name: string; body: unknown }[]
  tables: Record<string, unknown[]>
  business: Record<string, unknown>
  /** Rows returned by the funnel_report RPC. */
  funnel: Record<string, unknown>[]
  testCalendar: { email: string | null }
  /** Objects in the private `ads` bucket: path -> body and type. */
  adFiles: Map<string, { body: Buffer | string; type: string }>
  /** Objects in the private `quotes` bucket: path -> PDF bytes. */
  quoteFiles?: Map<string, Buffer>
  /** Objects in the private `enquiry-photos` bucket: path -> JPEG bytes. */
  photoFiles: Map<string, Buffer>
  /** What pilot_report returns. */
  pilot: unknown
  /** What pilot_report_by_content returns, by campaign. */
  pilotByContent: Record<string, unknown>
  /** What staff-booking's move_options returns. */
  moveOptions: unknown
  /** What staff-booking's visit_options returns (after a call: book the site visit). */
  visitOptions?: unknown
  /** What staff-booking's call_options returns (before a call: book a call for them). */
  callOptions?: unknown
  /** staff-booking request bodies, in order. */
  staffBookingCalls?: Record<string, unknown>[]
}

export function staffWorld(): StaffWorld {
  const staff = new Map<string, FakeStaff>()
  const add = (s: Omit<FakeStaff, 'created_at'>) =>
    staff.set(s.user_id, { ...s, created_at: new Date(2026, 10, staff.size + 1).toISOString() })
  add({
    user_id: 'u-admin',
    email: 'admin@example.com',
    display_name: 'Chris Admin',
    role: 'admin',
    active: true,
  })
  add({
    user_id: 'u-staff',
    email: 'staff@example.com',
    display_name: 'Sam Staff',
    role: 'staff',
    active: true,
  })
  return {
    staff,
    passwords: new Map([
      ['u-admin', 'correct horse battery staple'],
      ['u-staff', 'another long password'],
    ]),
    queued: [],
    tokens: new Map(),
    bookable: { id: 'u-admin' },
    rpcCalls: [],
    tables: {},
    funnel: [],
    testCalendar: { email: null },
    adFiles: new Map(),
    photoFiles: new Map(),
    pilotByContent: {},
    moveOptions: { status: 'unavailable', reason: 'calendar' },
    pilot: {
      counted_from: new Date().toISOString(),
      rows: [],
      headline: { instagram_sessions: 0, instagram_suitable_attended: 0 },
    },
    business: {
      trading_name: 'Q3 Interiors',
      legal_name: null,
      postal_address: null,
      contact_phone: null,
      contact_email: null,
      service_area: null,
      privacy_contact: null,
      privacy_reviewed_at: null,
      updated_at: new Date().toISOString(),
    },
  }
}

function session(user: FakeStaff) {
  return {
    access_token: fakeJwt(user.user_id),
    refresh_token: `refresh-${user.user_id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: user.user_id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: {},
      user_metadata: {},
      created_at: user.created_at,
    },
  }
}

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      ...headers,
    },
    body: body === undefined ? '' : JSON.stringify(body),
  })

/** Filters PostgREST-style `col=eq.value` query parameters over rows. */
function select(rows: Record<string, unknown>[], url: URL) {
  let out = rows
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    if (value.startsWith('eq.')) out = out.filter((r) => String(r[key]) === value.slice(3))
    if (value === 'is.null') out = out.filter((r) => r[key] === null || r[key] === undefined)
    if (value === 'not.is.null') out = out.filter((r) => r[key] !== null && r[key] !== undefined)
    if (value.startsWith('in.(')) {
      const set = value.slice(4, -1).split(',')
      out = out.filter((r) => set.includes(String(r[key])))
    }
  }
  return out
}

/**
 * The list's embedded bookings for one enquiry, rebuilt from the bookings table after a staff
 * change (move, cancel, attendance), as PostgREST would return them.
 */
function syncEnquiryBookings(world: StaffWorld, enquiryId: string) {
  const enquiry = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
    (e) => e.id === enquiryId,
  )
  if (!enquiry) return
  enquiry.bookings = ((world.tables.bookings ?? []) as Record<string, unknown>[])
    .filter((b) => b.enquiry_id === enquiryId)
    .map((b) => ({
      starts_at: b.starts_at,
      confirmed_at: b.confirmed_at ?? null,
      state: b.state,
      attendance: b.attendance ?? null,
      appointment_types: { mode: (b.appointment_types as { mode: string }).mode },
    }))
}

function pushEvent(row: Record<string, unknown>, event: Record<string, unknown>) {
  const events = (row.enquiry_events ?? []) as Record<string, unknown>[]
  row.enquiry_events = [
    {
      id: events.length + 300,
      detail: null,
      from_status: null,
      to_status: null,
      reason: null,
      actor_name: null,
      created_at: new Date().toISOString(),
      ...event,
    },
    ...events,
  ]
}

export async function installFakeStaff(page: Page, world: StaffWorld = staffWorld()) {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, (route) =>
    route.abort('blockedbyclient'),
  )

  const store: AccountStore = {
    staffMember: async (id) => world.staff.get(id) ?? null,
    authUserIdByEmail: async (email) =>
      [...world.staff.values()].find((s) => s.email === email)?.user_id ?? null,
    addStaff: async (id, email, name, role) => {
      world.staff.set(id, {
        user_id: id,
        email,
        display_name: name,
        role,
        active: true,
        created_at: new Date().toISOString(),
      })
    },
    setActive: async (id, active) => {
      if (!active && world.bookable.id === id) throw new Error('takes bookings')
      const s = world.staff.get(id)
      if (s) s.active = active
    },
    setRole: async (id, role) => {
      const s = world.staff.get(id)
      if (s) s.role = role
    },
    queueAccountEmail: async (userId, template) => {
      world.queued.push({ userId, template })
      world.tokens.set(`hash-${userId}`, userId)
    },
    activeStaffByEmail: async (email) =>
      [...world.staff.values()].find((s) => s.email === email && s.active)?.user_id ?? null,
    rateLimitTake: async () => true,
    kickWorker: async () => {},
  }
  let n = 0
  const auth: AuthAdmin = {
    createUser: async () => `u-new-${(n += 1)}`,
    setBanned: async () => {},
    setPassword: async (id, password) => void world.passwords.set(id, password),
    recoveryTokenHash: async () => 'unused',
  }

  await page.route('**/auth/v1/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, 204, undefined)
    const url = new URL(req.url())
    if (url.pathname.endsWith('/token')) {
      const body = req.postDataJSON() as { email?: string; password?: string }
      const user = [...world.staff.values()].find((s) => s.email === body.email)
      if (!user || world.passwords.get(user.user_id) !== body.password)
        return json(route, 400, {
          code: 'invalid_credentials',
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
          msg: 'Invalid login credentials',
        })
      return json(route, 200, session(user))
    }
    if (url.pathname.endsWith('/verify')) {
      const body = req.postDataJSON() as { token_hash?: string }
      const userId = body.token_hash ? world.tokens.get(body.token_hash) : undefined
      const user = userId ? world.staff.get(userId) : undefined
      if (!user)
        return json(route, 403, {
          code: 'otp_expired',
          msg: 'Email link is invalid or has expired',
        })
      world.tokens.delete(body.token_hash ?? '')
      return json(route, 200, session(user))
    }
    if (url.pathname.endsWith('/user')) {
      const user = world.staff.get(subOf(req.headers().authorization) ?? '')
      return user ? json(route, 200, session(user).user) : json(route, 401, { msg: 'no user' })
    }
    if (url.pathname.endsWith('/logout')) return json(route, 204, undefined)
    return json(route, 404, { msg: 'not faked' })
  })

  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, 204, undefined)
    const url = new URL(req.url())
    const table = url.pathname.split('/rest/v1/')[1] ?? ''
    const caller = world.staff.get(subOf(req.headers().authorization) ?? '')
    if (table.startsWith('rpc/')) {
      world.rpcCalls.push({ name: table.slice(4), body: req.postDataJSON() })
      if (table === 'rpc/public_business_details') {
        const { privacy_reviewed_at, updated_at: _u, ...rest } = world.business
        return json(route, 200, {
          ...rest,
          privacy_reviewed: privacy_reviewed_at !== null,
          retention_months: null,
        })
      }
      if (table === 'rpc/funnel_report') return json(route, 200, world.funnel)
      if (table === 'rpc/pilot_report_by_content') {
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const campaign = (req.postDataJSON() as { p_campaign: string }).p_campaign
        return json(route, 200, world.pilotByContent[campaign] ?? { campaign, cap: 25, rows: [] })
      }
      if (table === 'rpc/pilot_report') {
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        return json(route, 200, world.pilot)
      }
      if (table === 'rpc/record_enquiry_outcome') {
        // The server's rules, in short (see 20261128100000_enquiry_outcomes.sql).
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const b = req.postDataJSON() as {
          p_enquiry_id: string
          p_stage: string
          p_amount: number | null
          p_on: string | null
          p_reason: string | null
          p_note: string | null
        }
        const row = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => e.id === b.p_enquiry_id,
        )
        if (!row) return json(route, 404, { code: 'P0002', message: 'enquiry not found' })
        const bad = () => json(route, 400, { code: '22023', message: 'invalid' })
        const before = row.outcome as string | null
        let detail = ''
        if (b.p_stage === 'none') {
          Object.assign(row, {
            outcome: null,
            outcome_value: null,
            outcome_reason: null,
            outcome_note: null,
            quote_amount: null,
            quote_date: null,
            won_date: null,
          })
        } else if (b.p_stage === 'quoted' || b.p_stage === 'won') {
          if (!b.p_amount || b.p_amount <= 0 || !b.p_on) return bad()
          const money = `€${b.p_amount.toLocaleString('en-IE', { minimumFractionDigits: 2 })}`
          if (b.p_stage === 'quoted')
            Object.assign(row, {
              outcome: 'quoted',
              quote_amount: b.p_amount,
              quote_date: b.p_on,
              outcome_value: null,
              won_date: null,
              outcome_reason: null,
              outcome_note: b.p_note,
            })
          else
            Object.assign(row, {
              outcome: 'won',
              outcome_value: b.p_amount,
              won_date: b.p_on,
              outcome_reason: null,
              outcome_note: b.p_note,
            })
          detail = `${b.p_stage === 'quoted' ? 'Quoted' : 'Won'} ${money} on ${b.p_on}`
        } else if (b.p_stage === 'lost') {
          if (!b.p_reason || (b.p_reason === 'other' && !b.p_note)) return bad()
          Object.assign(row, {
            outcome: 'lost',
            outcome_reason: b.p_reason,
            outcome_note: b.p_note,
            outcome_value: null,
            won_date: null,
          })
          detail = `Lost: ${b.p_reason.replace(/_/g, ' ')}`
        } else return bad()
        if (before && detail) detail += ` (was ${before})`
        const events = (row.enquiry_events ?? []) as Record<string, unknown>[]
        row.enquiry_events = [
          {
            id: events.length + 200,
            kind: b.p_stage === 'none' ? 'outcome_cleared' : 'outcome_recorded',
            detail: detail || null,
            from_status: null,
            to_status: null,
            reason: null,
            actor_name: caller.display_name,
            created_at: new Date().toISOString(),
          },
          ...events,
        ]
        return json(route, 200, null)
      }
      if (table === 'rpc/add_estimate_work_item' || table === 'rpc/archive_estimate_work_item') {
        // The server's rules (see 20261129120000_estimate_work_items.sql).
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const rows = (world.tables.estimate_work_items ??= []) as Record<string, unknown>[]
        if (table === 'rpc/archive_estimate_work_item') {
          const { p_id } = req.postDataJSON() as { p_id: string }
          const row = rows.find((r) => r.id === p_id)
          if (!row) return json(route, 404, { code: 'P0002', message: 'item not found' })
          row.archived_at ??= new Date().toISOString()
          return json(route, 200, null)
        }
        const b = req.postDataJSON() as { p_project_type: string | null; p_label: string }
        const label = (b.p_label ?? '').trim().replace(/\s+/g, ' ')
        if (label.length < 2 || label.length > 60)
          return json(route, 400, { code: '22023', message: 'label' })
        const type = b.p_project_type || null
        const same = rows.find(
          (r) =>
            (r.project_type ?? null) === type &&
            String(r.label).toLowerCase() === label.toLowerCase(),
        )
        if (same) {
          same.archived_at = null
          return json(route, 200, same.id)
        }
        const id = `wi-${rows.length + 1}`
        rows.push({ id, label, project_type: type, archived_at: null, position: rows.length + 1 })
        return json(route, 200, id)
      }
      if (table === 'rpc/record_call_held_early' || table === 'rpc/send_visit_link') {
        // The server's rules (see 20261129140000_after_call.sql).
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const b = req.postDataJSON() as { p_enquiry_id: string }
        const row = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => e.id === b.p_enquiry_id,
        )
        if (!row) return json(route, 404, { code: 'P0002', message: 'enquiry not found' })
        const at = new Date().toISOString()
        const ahead = ((world.tables.bookings ?? []) as Record<string, unknown>[]).filter(
          (x) =>
            x.enquiry_id === row.id &&
            ['reserved', 'calendar_pending', 'confirmed'].includes(String(x.state)) &&
            Date.parse(String(x.starts_at)) > Date.now(),
        )
        const mode = (x: Record<string, unknown>) => (x.appointment_types as { mode: string }).mode
        if (ahead.some((x) => mode(x) === 'on_site'))
          return json(route, 400, { code: '22023', message: 'site visit booked' })
        if (table === 'rpc/send_visit_link') {
          if (!(row.answers as Record<string, unknown>).email)
            return json(route, 400, { code: '22023', message: 'no email address' })
          row.visit_link_sent_at = at
          pushEvent(row, { kind: 'visit_link_sent', actor_name: caller.display_name })
          return json(route, 200, null)
        }
        for (const x of ahead.filter((x) => mode(x) === 'phone'))
          Object.assign(x, {
            state: 'cancelled',
            cancelled_at: at,
            cancelled_by: 'staff',
            cancel_reason: 'Spoke before the call',
          })
        syncEnquiryBookings(world, String(row.id))
        row.call_held_at = at
        pushEvent(row, { kind: 'call_held_early', actor_name: caller.display_name })
        return json(route, 200, { cancelled: ahead.length })
      }
      if (table === 'rpc/send_quote') {
        // The server's rules (see 20261129160000_quotes.sql), simplified.
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const b = req.postDataJSON() as {
          p_enquiry_id: string
          p_price: number
          p_included: string[]
          p_excluded?: string[]
          p_note?: string | null
          p_estimate_id?: string | null
        }
        const row = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => e.id === b.p_enquiry_id,
        )
        if (!row) return json(route, 404, { code: 'P0002', message: 'enquiry not found' })
        if (b.p_price < 100 || b.p_included.length === 0)
          return json(route, 400, { code: '22023', message: 'invalid' })
        const quotes = (row.quotes as Record<string, unknown>[] | undefined) ?? []
        const prev = [...quotes].sort((x, y) => Number(y.version) - Number(x.version))[0]
        const sent = new Date().toISOString()
        const id = `00000000-0000-4000-8000-${String(world.rpcCalls.length).padStart(12, 'b')}`
        row.quotes = [
          ...quotes,
          {
            id,
            estimate_id: b.p_estimate_id ?? null,
            number: prev?.number ?? 'Q3-Q-0001',
            version: prev ? Number(prev.version) + 1 : 1,
            price_eur: b.p_price,
            included: b.p_included,
            excluded: b.p_excluded ?? [],
            note: b.p_note ?? null,
            deposit_percent: 10,
            deposit_eur: Math.round(b.p_price / 10),
            valid_until: '2026-12-18',
            terms: 'This quote is one price for the work listed. It’s good until Fri 18 Dec 2026.',
            sent_at: sent,
            created_by_name: caller.display_name,
            pdf_path: null,
            change_requested_at: null,
            change_request_text: null,
          },
        ]
        row.outcome = 'quoted'
        row.quote_amount = b.p_price
        row.quote_date = sent.slice(0, 10)
        pushEvent(row, { kind: 'quote_sent', actor_name: caller.display_name })
        return json(route, 200, id)
      }
      if (table === 'rpc/send_estimate') {
        // The server's rules (see 20261129100000_estimates.sql), with the shared range rule.
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const b = req.postDataJSON() as {
          p_booking_id: string
          p_price: number
          p_percent: number
          p_work: string
          p_items?: string[]
          p_enquiry_id?: string
        }
        const found = ((world.tables.bookings ?? []) as Record<string, unknown>[]).find(
          (x) => x.id === b.p_booking_id,
        )
        // No booking: an enquiry whose call was held early ("We already spoke").
        const heldEarly = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => !b.p_booking_id && e.id === b.p_enquiry_id && e.call_held_at,
        )
        const booking: Record<string, unknown> | undefined =
          found ??
          (heldEarly
            ? {
                id: null,
                enquiry_id: heldEarly.id,
                appointment_types: { mode: 'phone' },
                attendance: 'attended',
              }
            : undefined)
        if (!booking) return json(route, 404, { code: 'P0002', message: 'appointment not found' })
        const after =
          (booking.appointment_types as { mode: string }).mode === 'on_site' ? 'visit' : 'call'
        if (after === 'call' && booking.attendance !== 'attended')
          return json(route, 400, { code: '22023', message: 'call not held' })
        const work = (b.p_work ?? '').trim()
        const items = (b.p_items ?? []).map((i) => i.trim())
        if (
          (items.length === 0 && !work) ||
          work.length > 600 ||
          items.some((i) => i.length < 2 || i.length > 60) ||
          !isValidPercent(b.p_percent)
        )
          return json(route, 400, { code: '22023', message: 'invalid' })
        let range
        try {
          range = estimateRange(b.p_price, b.p_percent)
        } catch {
          return json(route, 400, { code: '22023', message: 'price' })
        }
        const row = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => e.id === booking.enquiry_id,
        )
        if (!row) return json(route, 404, { code: 'P0002', message: 'enquiry not found' })
        const sent = new Date().toISOString()
        const id = `00000000-0000-4000-8000-${String(world.rpcCalls.length).padStart(12, '0')}`
        row.estimates = [
          ...((row.estimates as unknown[] | undefined) ?? []),
          {
            id,
            booking_id: booking.id,
            price_eur: b.p_price,
            plus_minus_percent: b.p_percent,
            low_eur: range.low,
            high_eur: range.high,
            work_items: items,
            work_looked_at: work || null,
            caveats:
              after === 'call'
                ? WORDING.estimate_call_caveats.default
                : WORDING.estimate_caveats.default,
            after,
            sent_at: sent,
            valid_until: new Date(Date.parse(sent) + 10 * 86_400_000).toISOString(),
            quote_requested_at: null,
            created_by_name: caller.display_name,
          },
        ]
        pushEvent(row, { kind: 'estimate_sent', detail: null, actor_name: caller.display_name })
        return json(route, 200, id)
      }
      if (table === 'rpc/add_enquiry_note') {
        // The server's rules (see 20261128160000_enquiry_notes.sql).
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const b = req.postDataJSON() as { p_enquiry_id: string; p_note: string | null }
        const note = (b.p_note ?? '').trim()
        if (!note || note.length > 1000) return json(route, 400, { code: '22023', message: 'note' })
        const row = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => e.id === b.p_enquiry_id,
        )
        if (!row) return json(route, 404, { code: 'P0002', message: 'enquiry not found' })
        pushEvent(row, { kind: 'note_added', detail: note, actor_name: caller.display_name })
        return json(route, 200, null)
      }
      if (table === 'rpc/set_enquiry_status') {
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const b = req.postDataJSON() as {
          p_enquiry_id: string
          p_status: string
          p_reason: string | null
        }
        const row = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => e.id === b.p_enquiry_id,
        )
        if (!row) return json(route, 404, { code: 'P0002', message: 'enquiry not found' })
        if (row.status !== b.p_status) {
          pushEvent(row, {
            kind: 'status_changed',
            from_status: row.status,
            to_status: b.p_status,
            reason: b.p_reason,
            actor_name: caller.display_name,
          })
          row.status = b.p_status
          row.status_reason = b.p_status === 'unsuitable' ? b.p_reason : null
        }
        return json(route, 200, null)
      }
      if (table === 'rpc/set_booking_attendance') {
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const b = req.postDataJSON() as { p_booking_id: string; p_attendance: string }
        const booking = ((world.tables.bookings ?? []) as Record<string, unknown>[]).find(
          (x) => x.id === b.p_booking_id,
        )
        if (!booking) return json(route, 404, { code: 'P0002', message: 'booking not found' })
        booking.attendance = b.p_attendance
        syncEnquiryBookings(world, String(booking.enquiry_id))
        return json(route, 200, null)
      }
      if (table === 'rpc/set_chase_details') {
        // The server's rules (see 20261127140000_pilot_measures.sql).
        if (!caller?.active) return json(route, 403, { code: '42501', message: 'not allowed' })
        const body = req.postDataJSON() as {
          p_enquiry_id: string
          p_flagged: boolean
          p_note: string
        }
        const row = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
          (e) => e.id === body.p_enquiry_id,
        )
        if (!row) return json(route, 404, { code: 'P0002', message: 'enquiry not found' })
        const note = (body.p_note ?? '').trim()
        if (body.p_flagged && (note.length < 3 || note.length > 500))
          return json(route, 400, { code: '22023', message: 'say what was missing' })
        const events = (row.enquiry_events ?? []) as Record<string, unknown>[]
        const kind = !body.p_flagged
          ? 'chase_cleared'
          : row.chase_flagged_at
            ? 'chase_updated'
            : 'chase_flagged'
        Object.assign(
          row,
          body.p_flagged
            ? {
                chase_flagged_at: row.chase_flagged_at ?? new Date().toISOString(),
                chase_note: note,
                chase_flagged_by_name: caller.display_name,
              }
            : { chase_flagged_at: null, chase_note: null, chase_flagged_by_name: null },
        )
        row.enquiry_events = [
          {
            id: events.length + 100,
            kind,
            detail: body.p_flagged ? note : null,
            from_status: null,
            to_status: null,
            reason: null,
            actor_name: caller.display_name,
            created_at: new Date().toISOString(),
          },
          ...events,
        ]
        return json(route, 200, null)
      }
      // The ad review RPCs, with the server's rules (see 20261126120000_ad_review.sql).
      type FakeVersion = {
        id: string
        version: number
        approved_at?: string | null
        approved_by_name?: string | null
      }
      type FakeRequest = {
        id: string
        version_id: string
        state: string
        created_by: string | null
        body: string
      }
      type FakeAd = {
        id: string
        status: string
        ad_versions: FakeVersion[]
        ad_requests?: FakeRequest[]
      }
      const adsTable = (world.tables.ads ?? []) as FakeAd[]
      const current = (ad: FakeAd) => [...ad.ad_versions].sort((x, y) => y.version - x.version)[0]
      const refuse = (message: string, code = '22023') => json(route, 400, { code, message })
      if (
        [
          'rpc/request_ad_change',
          'rpc/withdraw_ad_request',
          'rpc/approve_ad',
          'rpc/archive_ad',
        ].includes(table)
      ) {
        if (!caller?.active) return refuse('not allowed', '42501')
        const body = req.postDataJSON() as Record<string, unknown>
        if (table === 'rpc/request_ad_change') {
          const ad = adsTable.find((a) => a.id === body.p_ad_id)
          if (!ad) return refuse('ad not found', 'P0002')
          if (ad.status === 'archived') return refuse('ad archived')
          const text = String(body.p_body ?? '').trim()
          if (text.length < 3 || text.length > 1000) return refuse('request length')
          const v = current(ad)
          ad.ad_requests = [
            ...(ad.ad_requests ?? []),
            {
              id: `req-${(ad.ad_requests ?? []).length + 1}`,
              version_id: v?.id ?? '',
              size: String(body.p_size ?? 'both'),
              body: text,
              state: 'open',
              done_in_version: null,
              created_by: caller.user_id,
              created_by_name: caller.display_name,
              created_at: new Date().toISOString(),
            } as FakeRequest,
          ]
          ad.status = 'changes_requested'
          return json(route, 200, 'ok')
        }
        if (table === 'rpc/withdraw_ad_request') {
          for (const ad of adsTable) {
            const r = (ad.ad_requests ?? []).find((x) => x.id === body.p_request_id)
            if (!r) continue
            if (r.created_by !== caller.user_id) return refuse('not allowed', '42501')
            if (r.state !== 'open') return refuse('request not open')
            r.state = 'withdrawn'
            const v = current(ad)
            if (
              !(ad.ad_requests ?? []).some((x) => x.version_id === v?.id && x.state === 'open') &&
              ad.status === 'changes_requested'
            )
              ad.status = 'new'
            return json(route, 200, null)
          }
          return refuse('request not found', 'P0002')
        }
        if (caller.role !== 'admin') return refuse('not allowed', '42501')
        const ad = adsTable.find((a) => a.id === body.p_ad_id)
        if (!ad) return refuse('ad not found', 'P0002')
        const v = current(ad)
        if (table === 'rpc/approve_ad') {
          if (ad.status === 'archived') return refuse('ad archived')
          if (v?.version !== body.p_version) return refuse('not the current version')
          if (
            !body.p_despite_open &&
            (ad.ad_requests ?? []).some((x) => x.version_id === v?.id && x.state === 'open')
          )
            return refuse('open requests')
          if (v)
            Object.assign(v, {
              approved_at: new Date().toISOString(),
              approved_by_name: caller.display_name,
            })
          ad.status = 'approved'
          return json(route, 200, null)
        }
        ad.status = body.p_archived === false ? (v?.approved_at ? 'approved' : 'new') : 'archived'
        return json(route, 200, null)
      }
      if (table === 'rpc/go_live_checklist') {
        if (caller?.role !== 'admin')
          return json(route, 403, { code: '42501', message: 'not allowed' })
        const biz = world.business as Record<string, string | null>
        const labels: [string, string][] = [
          ['legal_name', 'legal name'],
          ['postal_address', 'postal address'],
          ['contact_phone', 'contact phone'],
          ['contact_email', 'contact email'],
          ['service_area', 'service area'],
          ['privacy_contact', 'privacy contact'],
        ]
        const conn = (
          (world.tables.calendar_connections ?? []) as {
            staff_user_id: string
            status: string
            google_email: string
          }[]
        ).find((c) => c.staff_user_id === world.bookable.id)
        return json(route, 200, {
          business_missing: labels.filter(([k]) => !biz[k]).map(([, l]) => l),
          bookable_name: world.staff.get(world.bookable.id ?? '')?.display_name ?? null,
          calendar_connected: conn?.status === 'connected',
          calendar_healthy: conn?.status === 'connected',
          calendar_email: conn?.google_email ?? null,
          test_calendar_email: world.testCalendar.email,
          retention_months: null,
          privacy_reviewed: biz.privacy_reviewed_at !== null,
          privacy_reviewable: Boolean(biz.legal_name && biz.postal_address && biz.privacy_contact),
          form_version: 1,
          last_booking_at: null,
          campaign_links: 0,
          ticks: Object.fromEntries(
            (
              (world.tables.setup_ticks ?? []) as {
                key: string
                created_at: string
                ticked_by_name: string
              }[]
            ).map((t) => [t.key, { at: t.created_at, by: t.ticked_by_name }]),
          ),
        })
      }
      if (table === 'rpc/mark_test_calendar') {
        const clear = (req.postDataJSON() as { p_clear?: boolean }).p_clear
        const conn = (
          (world.tables.calendar_connections ?? []) as {
            staff_user_id: string
            google_email: string
          }[]
        ).find((c) => c.staff_user_id === world.bookable.id)
        world.testCalendar.email = clear ? null : (conn?.google_email ?? null)
        return json(route, 200, world.testCalendar.email)
      }
      if (table === 'rpc/mark_campaign_link_used') {
        const id = (req.postDataJSON() as { p_campaign_id: string }).p_campaign_id
        for (const c of (world.tables.campaigns ?? []) as Record<string, unknown>[])
          if (c.id === id) c.link_used_at ??= new Date().toISOString()
        return json(route, 200, null)
      }
      if (table === 'rpc/campaign_costs') {
        if (caller?.role !== 'admin')
          return json(route, 403, { code: '42501', message: 'not allowed' })
        const spend = (world.tables.campaign_spend ?? []) as {
          campaign_id: string
          amount_cents: number
        }[]
        return json(
          route,
          200,
          ((world.tables.campaigns ?? []) as { id: string; slug: string; name: string }[]).map(
            (c) => {
              const mine = spend.filter((x) => x.campaign_id === c.id)
              return {
                campaign: c.slug,
                name: c.name,
                spend_cents: mine.reduce((a, x) => a + x.amount_cents, 0),
                spend_entries: mine.length,
              }
            },
          ),
        )
      }
      if (table === 'rpc/set_bookable_staff') {
        if (caller?.role !== 'admin' || !caller.active)
          return json(route, 403, { code: '42501', message: 'not allowed' })
        world.bookable.id = (req.postDataJSON() as { p_user_id: string }).p_user_id
        return json(route, 200, null)
      }
      return json(route, 200, null)
    }
    const admin = Boolean(caller?.active && caller.role === 'admin')
    const ADMIN_TABLES = [
      'campaigns',
      'campaign_creatives',
      'campaign_spend',
      'message_blocks',
      'setup_ticks',
    ]
    if (req.method() === 'POST' && ADMIN_TABLES.includes(table)) {
      if (!admin)
        return json(route, 403, {
          code: '42501',
          message: 'new row violates row-level security policy',
        })
      const body = req.postDataJSON() as Record<string, unknown>
      const row: Record<string, unknown> = {
        id: `${table}-${(world.tables[table] ?? []).length + 1}`,
        created_at: new Date().toISOString(),
        archived_at: null,
        ...(table === 'campaigns' ? { link_used_at: null } : {}),
        ...body,
      }
      world.tables[table] = [...(world.tables[table] ?? []), row]
      return json(route, 201, [row])
    }
    if (req.method() === 'DELETE' && ADMIN_TABLES.includes(table)) {
      const doomed = select((world.tables[table] ?? []) as Record<string, unknown>[], url)
      if (admin)
        world.tables[table] = (world.tables[table] ?? []).filter(
          (r) => !doomed.includes(r as Record<string, unknown>),
        )
      return json(route, 200, [])
    }
    if (req.method() === 'PATCH' && ADMIN_TABLES.includes(table)) {
      if (!admin) return json(route, 200, [])
      const hits = select((world.tables[table] ?? []) as Record<string, unknown>[], url)
      for (const r of hits) Object.assign(r, req.postDataJSON() as Record<string, unknown>)
      return json(route, 200, hits)
    }
    if (req.method() === 'PATCH') {
      const patch = req.postDataJSON() as Record<string, unknown>
      const admin = caller?.active && caller.role === 'admin'
      if (table === 'business_details' && admin) {
        Object.assign(world.business, patch)
        return json(route, 200, [{ updated_at: world.business.updated_at }])
      }
      // What RLS does with a refused update: no error, no rows.
      return json(route, 200, [])
    }
    let rows: Record<string, unknown>[] = []
    if (table === 'business_details') {
      rows = caller?.active ? [world.business] : []
    } else if (table === 'staff') {
      const all = [...world.staff.values()]
      // RLS: active staff see everyone, anyone else only their own row.
      rows = caller?.active ? all : all.filter((s) => s.user_id === caller?.user_id)
    } else if (table === 'booking_settings') {
      rows = [{ bookable_staff_user_id: world.bookable.id }]
    } else if (table === 'campaigns') {
      // The embedded creatives, as PostgREST returns them for campaign_creatives(...).
      rows = ((world.tables.campaigns ?? []) as Record<string, unknown>[]).map((c) => ({
        ...c,
        campaign_creatives: (
          (world.tables.campaign_creatives ?? []) as Record<string, unknown>[]
        ).filter((x) => x.campaign_id === c.id),
      }))
    } else if (table === 'campaign_spend' && !admin) {
      rows = []
    } else {
      rows = (world.tables[table] ?? []) as Record<string, unknown>[]
    }
    const out = select(rows, url)
    if (req.method() === 'HEAD') {
      return route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'content-range',
          'content-range': out.length ? `0-${out.length - 1}/${out.length}` : '*/0',
        },
        body: '',
      })
    }
    const single = (req.headers().accept ?? '').includes('vnd.pgrst.object')
    return json(route, 200, single ? (out[0] ?? null) : out)
  })

  // Private storage: only an active staff session may read ad files.
  await page.route('**/storage/v1/object/ads/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, 204, undefined)
    const caller = world.staff.get(subOf(req.headers().authorization) ?? '')
    const objectPath = decodeURIComponent(
      new URL(req.url()).pathname.split('/storage/v1/object/ads/')[1] ?? '',
    )
    const file = world.adFiles.get(objectPath)
    if (!caller?.active || !file)
      return json(route, 400, {
        statusCode: '404',
        error: 'not_found',
        message: 'Object not found',
      })
    return route.fulfill({
      status: 200,
      contentType: file.type,
      headers: { 'access-control-allow-origin': '*' },
      body: file.body,
    })
  })

  // Private quote PDFs: only an active staff session may read one.
  await page.route('**/storage/v1/object/quotes/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, 204, undefined)
    const caller = world.staff.get(subOf(req.headers().authorization) ?? '')
    const objectPath = decodeURIComponent(
      new URL(req.url()).pathname.split('/storage/v1/object/quotes/')[1] ?? '',
    )
    const file = world.quoteFiles?.get(objectPath)
    if (!caller?.active || !file)
      return json(route, 400, {
        statusCode: '404',
        error: 'not_found',
        message: 'Object not found',
      })
    return route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      headers: { 'access-control-allow-origin': '*' },
      body: file,
    })
  })

  // Private photo storage: only an active staff session may read a customer's photo.
  await page.route('**/storage/v1/object/enquiry-photos/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, 204, undefined)
    const caller = world.staff.get(subOf(req.headers().authorization) ?? '')
    const objectPath = decodeURIComponent(
      new URL(req.url()).pathname.split('/storage/v1/object/enquiry-photos/')[1] ?? '',
    )
    const file = world.photoFiles.get(objectPath)
    if (!caller?.active || !file)
      return json(route, 400, {
        statusCode: '404',
        error: 'not_found',
        message: 'Object not found',
      })
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: file,
    })
  })

  // staff-booking (move and cancel any booking), with the outcomes the real function returns.
  await page.route('**/functions/v1/staff-booking', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, 204, undefined)
    const caller = world.staff.get(subOf(req.headers().authorization) ?? '')
    if (!caller?.active) return json(route, 401, { error: 'not staff' })
    const input = req.postDataJSON() as {
      action: string
      bookingId: string
      start?: string
      reason?: string
      enquiryId?: string
      siteStreet?: string
    }
    world.staffBookingCalls = [...(world.staffBookingCalls ?? []), input]
    if (input.action === 'visit_options') return json(route, 200, world.visitOptions)
    if (input.action === 'call_options' || input.action === 'book_call') {
      // Like the real function: one appointment still to come at a time, then the reserve.
      const e = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
        (x) => x.id === input.enquiryId,
      )
      if (!e) return json(route, 404, { error: 'not_found' })
      const toCome = ((world.tables.bookings ?? []) as Record<string, unknown>[]).some(
        (b) =>
          b.enquiry_id === e.id &&
          ['reserved', 'calendar_pending', 'confirmed'].includes(String(b.state)) &&
          Date.parse(String(b.starts_at)) > Date.now(),
      )
      if (toCome) return json(route, 200, { status: 'already_booked' })
      if (input.action === 'call_options') return json(route, 200, world.callOptions)
      if (!input.start) return json(route, 400, { error: 'bad_request' })
      const id = `b-call-${(world.tables.bookings ?? []).length + 1}`
      world.tables.bookings = [
        ...(world.tables.bookings ?? []),
        {
          id,
          enquiry_id: e.id,
          state: 'confirmed',
          starts_at: input.start,
          ends_at: new Date(Date.parse(input.start) + 20 * 60_000).toISOString(),
          confirmed_at: new Date().toISOString(),
          failure_reason: null,
          calendar_event_id: `q3${id}`,
          calendar_event_link: null,
          created_at: new Date().toISOString(),
          attendance: null,
          cancelled_at: null,
          cancelled_by: null,
          cancel_reason: null,
          calendar_mismatch: null,
          appointment_types: { label: 'Phone consultation', mode: 'phone' },
          enquiries: {
            reference: e.reference,
            answers: e.answers,
            outcome: null,
            site_details: e.site_details,
          },
        },
      ]
      syncEnquiryBookings(world, String(e.id))
      pushEvent(e, { kind: 'call_booked_by_staff', actor_name: caller.display_name })
      return json(route, 200, { status: 'booked', bookingId: id })
    }
    if (input.action === 'book_visit' && input.start) {
      // Like the real function: the address typed goes into the site details, then the visit.
      const e = ((world.tables.enquiries ?? []) as Record<string, unknown>[]).find(
        (x) => x.id === input.enquiryId,
      )
      if (!e) return json(route, 404, { error: 'not_found' })
      if (input.siteStreet)
        e.site_details = {
          site_address: `${input.siteStreet}, ${String((e.answers as Record<string, unknown>).location)}`,
        }
      if (!(e.site_details as Record<string, unknown> | null)?.site_address)
        return json(route, 200, { status: 'ineligible', reason: 'site_address_required' })
      const id = `b-staff-${(world.tables.bookings ?? []).length + 1}`
      world.tables.bookings = [
        ...(world.tables.bookings ?? []),
        {
          id,
          enquiry_id: e.id,
          state: 'confirmed',
          starts_at: input.start,
          ends_at: new Date(Date.parse(input.start) + 60 * 60_000).toISOString(),
          confirmed_at: new Date().toISOString(),
          failure_reason: null,
          calendar_event_id: `q3${id}`,
          calendar_event_link: null,
          created_at: new Date().toISOString(),
          attendance: null,
          cancelled_at: null,
          cancelled_by: null,
          cancel_reason: null,
          calendar_mismatch: null,
          appointment_types: { label: 'On-site estimate visit', mode: 'on_site' },
          enquiries: {
            reference: e.reference,
            answers: e.answers,
            outcome: null,
            site_details: e.site_details,
          },
        },
      ]
      syncEnquiryBookings(world, String(e.id))
      pushEvent(e, { kind: 'visit_booked_by_staff', actor_name: caller.display_name })
      return json(route, 200, { status: 'booked', bookingId: id })
    }
    const booking = ((world.tables.bookings ?? []) as Record<string, unknown>[]).find(
      (b) => b.id === input.bookingId,
    )
    if (!booking) return json(route, 404, { error: 'not found' })
    if (input.action === 'move_options') return json(route, 200, world.moveOptions)
    if (input.action === 'reschedule' && input.start) {
      const length = Date.parse(String(booking.ends_at)) - Date.parse(String(booking.starts_at))
      booking.starts_at = input.start
      booking.ends_at = new Date(Date.parse(input.start) + length).toISOString()
      syncEnquiryBookings(world, String(booking.enquiry_id))
      return json(route, 200, { status: 'rescheduled', changed: true })
    }
    if (input.action === 'cancel') {
      Object.assign(booking, {
        state: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: 'staff',
        cancel_reason: input.reason ?? null,
      })
      syncEnquiryBookings(world, String(booking.enquiry_id))
      return json(route, 200, { status: 'cancelled', changed: true })
    }
    return json(route, 400, { error: 'unknown action' })
  })

  await page.route('**/functions/v1/staff-accounts', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return json(route, 204, undefined)
    const input = req.postDataJSON() as Record<string, unknown>
    const caller = input.action === 'forgot' ? null : subOf(req.headers().authorization)
    const result = await handleAccounts(input, caller, { store, auth, addrHash: 'h' })
    return json(route, result.status, result.body)
  })

  return world
}

export async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

// The enquiry page (2026-11-30): one primary action in a bar, the others in a sheet, sections folded.
/** The sheet of other actions, opened from the bar's "More actions" (or "Actions") button. */
export async function openActions(page: Page) {
  await page
    .getByRole('region', { name: 'Actions' })
    .getByRole('button', { name: /^(More actions|Actions)$/ })
    .click()
  return page.getByRole('dialog')
}
/** Open the sheet and choose an action by its title; returns the sheet showing its panel. */
export async function chooseAction(page: Page, name: string | RegExp) {
  const sheet = await openActions(page)
  await sheet.getByRole('button', { name }).click()
  return sheet
}
/** The bar's primary action. */
export const primaryAction = (page: Page) =>
  page.getByRole('region', { name: 'Actions' }).locator('a, button').first()
/** Open a folded section ("Their answers", "Appointments", "Estimate", "Quote", ...). */
export async function openFold(page: Page, name: string) {
  const fold = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: name }) })
    .first()
  if (!(await fold.evaluate((d) => (d as HTMLDetailsElement).open)))
    await fold.locator('summary').first().click()
}
/** The read-only "now" card. */
export const nowCard = (page: Page) => page.getByRole('region', { name: 'Now', exact: true })
/** Open every folded section on the enquiry page (older checks read them all). */
export async function openFolds(page: Page) {
  await page.locator('details[id^="fold-"]').first().waitFor()
  await page.evaluate(() =>
    document.querySelectorAll<HTMLDetailsElement>('details[id^="fold-"]').forEach((d) => {
      d.open = true
    }),
  )
}
