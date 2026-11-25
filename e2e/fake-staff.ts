import type { Page, Route } from '@playwright/test'
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
export const PUBLIC_URL = 'http://127.0.0.1:4173'
export const STAFF_URL_LOCAL = 'http://127.0.0.1:4174'

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
  }
  return out
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
