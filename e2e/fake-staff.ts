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
      if (table === 'rpc/set_bookable_staff') {
        if (caller?.role !== 'admin' || !caller.active)
          return json(route, 403, { code: '42501', message: 'not allowed' })
        world.bookable.id = (req.postDataJSON() as { p_user_id: string }).p_user_id
        return json(route, 200, null)
      }
      return json(route, 200, null)
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
    } else {
      rows = (world.tables[table] ?? []) as Record<string, unknown>[]
    }
    const out = select(rows, url)
    const single = (req.headers().accept ?? '').includes('vnd.pgrst.object')
    return json(route, 200, single ? (out[0] ?? null) : out)
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
