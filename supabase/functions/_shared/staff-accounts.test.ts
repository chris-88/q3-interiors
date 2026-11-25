import { describe, expect, it } from 'vitest'
import { AuthAdminError, type AuthAdmin } from './gotrue.ts'
import { processCommunication, setPasswordUrl } from './email.ts'
import { renderAccountEmail } from './messages.ts'
import {
  handleAccounts,
  passwordProblem,
  type AccountStore,
  type Role,
  type StaffAccount,
} from './staff-accounts.ts'
import type { Communication, Db } from './types.ts'

function setup() {
  const staff = new Map<string, StaffAccount>()
  const authUsers = new Map<string, string>() // email -> id
  const queued: { userId: string; template: string }[] = []
  const banned = new Set<string>()
  const passwords = new Map<string, string>()
  let bookable = 'admin-1'
  let limit = 5
  const add = (user_id: string, email: string, role: Role, active = true) => {
    staff.set(user_id, { user_id, email, display_name: `Name ${user_id}`, role, active })
    authUsers.set(email, user_id)
  }
  add('admin-1', 'chris@example.invalid', 'admin')
  add('staff-1', 'dad@example.invalid', 'staff')
  const store: AccountStore = {
    staffMember: async (id) => staff.get(id) ?? null,
    authUserIdByEmail: async (email) => authUsers.get(email) ?? null,
    addStaff: async (id, email, name, role) => {
      staff.set(id, { user_id: id, email, display_name: name, role, active: true })
    },
    setActive: async (id, active) => {
      const s = staff.get(id)
      if (!s) throw new Error('staff member not found')
      if (!active && bookable === id) throw new Error('takes bookings')
      const admins = [...staff.values()].filter((x) => x.role === 'admin' && x.active)
      if (!active && s.role === 'admin' && admins.length <= 1) throw new Error('last admin')
      s.active = active
    },
    setRole: async (id, role) => {
      const s = staff.get(id)
      if (!s) throw new Error('staff member not found')
      const admins = [...staff.values()].filter((x) => x.role === 'admin' && x.active)
      if (s.role === 'admin' && role !== 'admin' && admins.length <= 1)
        throw new Error('last admin')
      s.role = role
    },
    queueAccountEmail: async (userId, template) => {
      if (staff.get(userId)?.active) queued.push({ userId, template })
    },
    activeStaffByEmail: async (email) => {
      const s = [...staff.values()].find((x) => x.email === email && x.active)
      return s?.user_id ?? null
    },
    rateLimitTake: async () => (limit -= 1) >= 0,
    kickWorker: async () => {},
  }
  let nextId = 0
  const auth: AuthAdmin = {
    createUser: async (email) => {
      if (authUsers.has(email)) throw new AuthAdminError('exists', 422)
      const id = `new-${(nextId += 1)}`
      authUsers.set(email, id)
      return id
    },
    setBanned: async (id, b) => {
      if (b) banned.add(id)
      else banned.delete(id)
    },
    setPassword: async (id, p) => {
      passwords.set(id, p)
    },
    recoveryTokenHash: async () => 'hash-abc',
  }
  const deps = { store, auth, addrHash: 'h', newId: () => `req-${Math.random()}` }
  return {
    staff,
    queued,
    banned,
    passwords,
    deps,
    setBookable: (id: string) => (bookable = id),
    setLimit: (n: number) => (limit = n),
  }
}

describe('staff accounts: who may do what', () => {
  it('refuses everything but "forgot" to anonymous callers and deactivated people', async () => {
    const s = setup()
    for (const action of ['add', 'set_active', 'set_role', 'send_reset', 'set_password']) {
      expect((await handleAccounts({ action }, null, s.deps)).status).toBe(403)
    }
    s.staff.get('staff-1')!.active = false
    expect(
      (
        await handleAccounts(
          { action: 'set_password', password: 'x'.repeat(12) },
          'staff-1',
          s.deps,
        )
      ).status,
    ).toBe(403)
  })

  it('lets staff set only their own password, and nothing admin', async () => {
    const s = setup()
    const add = await handleAccounts(
      { action: 'add', name: 'X', email: 'x@example.invalid', role: 'staff' },
      'staff-1',
      s.deps,
    )
    expect(add).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(
      (
        await handleAccounts(
          { action: 'set_password', password: 'correct horse battery' },
          'staff-1',
          s.deps,
        )
      ).status,
    ).toBe(200)
    expect(s.passwords.get('staff-1')).toBe('correct horse battery')
  })

  it('enforces the password length on the server', async () => {
    const s = setup()
    expect(
      (await handleAccounts({ action: 'set_password', password: 'elevenchars' }, 'staff-1', s.deps))
        .body,
    ).toEqual({ error: 'password_too_short' })
    expect(passwordProblem('twelve chars')).toBeNull()
    expect(passwordProblem('ä'.repeat(40))).toBe('too_long') // 80 bytes
    expect(passwordProblem(undefined)).toBe('missing')
  })
})

describe('staff accounts: admin actions', () => {
  it('adds a person, unbanned, and queues one invitation', async () => {
    const s = setup()
    const res = await handleAccounts(
      { action: 'add', name: '  Pat Quinn ', email: 'Pat@Example.invalid', role: 'staff' },
      'admin-1',
      s.deps,
    )
    expect(res.status).toBe(200)
    const id = res.body.userId as string
    expect(s.staff.get(id)).toMatchObject({
      email: 'pat@example.invalid',
      display_name: 'Pat Quinn',
      role: 'staff',
      active: true,
    })
    expect(s.queued).toEqual([{ userId: id, template: 'staff_invite' }])
  })

  it('validates input and refuses someone already on the team', async () => {
    const s = setup()
    const add = (body: Record<string, unknown>) =>
      handleAccounts({ action: 'add', ...body }, 'admin-1', s.deps)
    expect((await add({ name: '', email: 'a@example.invalid', role: 'staff' })).body).toEqual({
      error: 'invalid_name',
    })
    expect((await add({ name: 'A', email: 'nope', role: 'staff' })).body).toEqual({
      error: 'invalid_email',
    })
    expect((await add({ name: 'A', email: 'a@example.invalid', role: 'owner' })).body).toEqual({
      error: 'invalid_role',
    })
    expect((await add({ name: 'A', email: 'DAD@example.invalid', role: 'staff' })).body).toEqual({
      error: 'already_staff',
    })
  })

  it('deactivates (and bans) and reactivates, with the guards', async () => {
    const s = setup()
    const set = (userId: string, active: boolean) =>
      handleAccounts({ action: 'set_active', userId, active }, 'admin-1', s.deps)
    expect((await set('admin-1', false)).body).toEqual({ error: 'self' })
    s.setBookable('staff-1')
    expect((await set('staff-1', false)).body).toEqual({ error: 'takes_bookings' })
    s.setBookable('admin-1')
    expect((await set('staff-1', false)).status).toBe(200)
    expect(s.staff.get('staff-1')!.active).toBe(false)
    expect(s.banned.has('staff-1')).toBe(true)
    expect((await set('staff-1', true)).status).toBe(200)
    expect(s.banned.has('staff-1')).toBe(false)
    expect((await set('nobody', false)).status).toBe(404)
  })

  it('never removes the last admin', async () => {
    const s = setup()
    s.staff.set('admin-2', {
      user_id: 'admin-2',
      email: 'a2@example.invalid',
      display_name: 'A2',
      role: 'admin',
      active: true,
    })
    expect(
      (
        await handleAccounts(
          { action: 'set_role', userId: 'admin-1', role: 'staff' },
          'admin-2',
          s.deps,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await handleAccounts(
          { action: 'set_role', userId: 'admin-2', role: 'staff' },
          'admin-2',
          s.deps,
        )
      ).body,
    ).toEqual({ error: 'last_admin' })
  })

  it('sends a reset only to an active person', async () => {
    const s = setup()
    expect(
      (await handleAccounts({ action: 'send_reset', userId: 'staff-1' }, 'admin-1', s.deps)).status,
    ).toBe(200)
    s.staff.get('staff-1')!.active = false
    expect(
      (await handleAccounts({ action: 'send_reset', userId: 'staff-1' }, 'admin-1', s.deps)).body,
    ).toEqual({ error: 'inactive' })
    expect(s.queued).toEqual([{ userId: 'staff-1', template: 'staff_password_reset' }])
  })
})

describe('forgot password', () => {
  it('answers the same for staff and strangers, and only mails active staff', async () => {
    const s = setup()
    const forgot = (email: string) => handleAccounts({ action: 'forgot', email }, null, s.deps)
    expect(await forgot('DAD@example.invalid')).toEqual({ status: 200, body: { ok: true } })
    expect(await forgot('stranger@example.invalid')).toEqual({ status: 200, body: { ok: true } })
    s.staff.get('admin-1')!.active = false
    expect(await forgot('chris@example.invalid')).toEqual({ status: 200, body: { ok: true } })
    expect(s.queued).toEqual([{ userId: 'staff-1', template: 'staff_password_reset' }])
    expect((await forgot('not an email')).status).toBe(400)
  })

  it('stops sending when the address is over the limit, without saying so', async () => {
    const s = setup()
    s.setLimit(0)
    expect(
      await handleAccounts({ action: 'forgot', email: 'dad@example.invalid' }, null, s.deps),
    ).toEqual({ status: 200, body: { ok: true } })
    expect(s.queued).toHaveLength(0)
  })
})

describe('account emails', () => {
  it('link to the HashRouter set-password page with a token hash, never a fragment redirect', () => {
    const url = setPasswordUrl('https://q3.example', 'abc', 'staff_invite')
    expect(url).toBe('https://q3.example/#/set-password?token_hash=abc&type=recovery&welcome=1')
    expect(setPasswordUrl('https://q3.example', 'abc', 'staff_password_reset')).not.toContain(
      'welcome',
    )
  })

  it('render the invitation with a button, the plain text and an escaped name', () => {
    const m = renderAccountEmail('staff_invite', {
      displayName: '<b>Pat</b> Quinn',
      link: 'https://q3.example/#/staff/set-password?token_hash=abc&type=recovery',
      siteUrl: 'https://q3.example',
    })
    expect(m.subject).toBe('Your Q3 Interiors staff account')
    expect(m.text).toContain(
      'Choose your password: https://q3.example/#/staff/set-password?token_hash=abc',
    )
    expect(m.html).toContain('&lt;b&gt;Pat&lt;/b&gt;')
    expect(m.html).toContain('>Choose your password</a>')
    expect(m.html).toContain('token_hash=abc&amp;type=recovery')
  })

  it('are generated at send time and skipped for someone no longer active', async () => {
    const sent: { to: string; html?: string }[] = []
    const skipped: string[] = []
    const db = {
      communicationSkipped: async (id: string) => void skipped.push(id),
      communicationSent: async () => {},
      communicationRetry: async () => {},
    } as unknown as Db
    const comm: Communication = {
      id: 'c1',
      enquiry_id: null,
      staff_user_id: 'u1',
      booking_id: null,
      template: 'staff_invite',
      recipient: 'pat@q3interiors.ie',
      dedupe_key: 'k',
      attempts: 1,
      max_attempts: 6,
    }
    const mailer = { send: async (m: { to: string; html?: string }) => (sent.push(m), 'id') }
    const accounts = {
      displayName: async () => 'Pat Quinn',
      recoveryTokenHash: async () => 'fresh-hash',
    }
    expect(
      await processCommunication(comm, { db, mailer, appUrl: 'https://q3.example', accounts }),
    ).toBe('sent')
    expect(sent[0]?.html).toContain('token_hash=fresh-hash')
    const gone = { ...accounts, displayName: async () => null }
    expect(
      await processCommunication(
        { ...comm, id: 'c2' },
        { db, mailer, appUrl: 'x', accounts: gone },
      ),
    ).toBe('skipped')
    expect(skipped).toEqual(['c2'])
  })
})
