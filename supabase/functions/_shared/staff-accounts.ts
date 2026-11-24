// Staff account administration: add people, deactivate and reactivate them, change roles, send
// set-password links, and let anyone ask for a reset. Pure logic over injected stores, so it is
// unit-tested in Node; the Deno entry point is supabase/functions/staff-accounts/index.ts.
import { AuthAdminError, type AuthAdmin } from './gotrue.ts'
import type { StaffAccountTemplate } from './types.ts'

export type Role = 'admin' | 'staff'

export type StaffAccount = {
  user_id: string
  email: string
  display_name: string
  role: Role
  active: boolean
}

export interface AccountStore {
  staffMember(userId: string): Promise<StaffAccount | null>
  authUserIdByEmail(email: string): Promise<string | null>
  addStaff(userId: string, email: string, name: string, role: Role): Promise<void>
  /** Throws 'takes bookings' or 'last admin' when the change is not allowed. */
  setActive(userId: string, active: boolean): Promise<void>
  /** Throws 'last admin' when the change would leave no active admin. */
  setRole(userId: string, role: Role): Promise<void>
  queueAccountEmail(
    userId: string,
    template: StaffAccountTemplate,
    requestId: string,
  ): Promise<void>
  activeStaffByEmail(email: string): Promise<string | null>
  rateLimitTake(addrHash: string, limit: number): Promise<boolean>
  kickWorker(): Promise<void>
}

export type AccountsDeps = {
  store: AccountStore
  auth: AuthAdmin
  /** Keyed hash of the caller's address, for the reset limiter. */
  addrHash: string
  newId?: () => string
}

export type AccountsResult = { status: number; body: Record<string, unknown> }

/** Password rule: length only (12 to 72; bcrypt ignores anything past 72 bytes). */
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 72
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'missing'
  const bytes = new TextEncoder().encode(password).length
  if ([...password].length < PASSWORD_MIN) return 'too_short'
  if (bytes > PASSWORD_MAX) return 'too_long'
  return null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const RESET_LIMIT_PER_HOUR = 5

const ok = (body: Record<string, unknown> = { ok: true }): AccountsResult => ({ status: 200, body })
const fail = (error: string, status = 400): AccountsResult => ({ status, body: { error } })

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

function knownGuard(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('takes bookings')) return 'takes_bookings'
  if (message.includes('last admin')) return 'last_admin'
  if (message.includes('staff member not found')) return 'not_found'
  return null
}

/**
 * One request. `callerId` is the signed-in user (null for anonymous calls); only 'forgot' is
 * open to anyone, 'set_password' needs an active staff session, everything else an active admin.
 */
export async function handleAccounts(
  input: Record<string, unknown>,
  callerId: string | null,
  deps: AccountsDeps,
): Promise<AccountsResult> {
  const { store, auth } = deps
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const action = typeof input.action === 'string' ? input.action : ''

  if (action === 'forgot') {
    const email = str(input.email, 254)?.toLowerCase() ?? null
    // The same answer whether or not the address is staff, so the form reveals nothing.
    if (!email || !EMAIL.test(email)) return fail('invalid_email')
    if (!(await store.rateLimitTake(deps.addrHash, RESET_LIMIT_PER_HOUR))) return ok()
    const userId = await store.activeStaffByEmail(email)
    if (userId) {
      await store.queueAccountEmail(userId, 'staff_password_reset', newId())
      await store.kickWorker()
    }
    return ok()
  }

  const caller = callerId ? await store.staffMember(callerId) : null
  if (!caller || !caller.active) return fail('forbidden', 403)

  if (action === 'set_password') {
    const problem = passwordProblem(input.password)
    if (problem) return fail(`password_${problem}`)
    await auth.setPassword(caller.user_id, input.password as string)
    return ok()
  }

  if (caller.role !== 'admin') return fail('forbidden', 403)

  if (action === 'add') {
    const name = str(input.name, 120)
    const email = str(input.email, 254)?.toLowerCase() ?? null
    const role = input.role === 'admin' || input.role === 'staff' ? input.role : null
    if (!name) return fail('invalid_name')
    if (!email || !EMAIL.test(email)) return fail('invalid_email')
    if (!role) return fail('invalid_role')
    // An address that already has a login (for example someone removed from staff by hand) is
    // reused; a person already on the team is refused.
    let userId = await store.authUserIdByEmail(email)
    if (userId && (await store.staffMember(userId))) return fail('already_staff', 409)
    if (!userId) {
      try {
        userId = await auth.createUser(email)
      } catch (error) {
        if (error instanceof AuthAdminError && error.status === 422)
          return fail('already_staff', 409)
        throw error
      }
    }
    await store.addStaff(userId, email, name, role)
    await auth.setBanned(userId, false)
    await store.queueAccountEmail(userId, 'staff_invite', newId())
    await store.kickWorker()
    return ok({ ok: true, userId })
  }

  const targetId = typeof input.userId === 'string' ? input.userId : ''
  const target = targetId ? await store.staffMember(targetId) : null
  if (!target) return fail('not_found', 404)

  if (action === 'set_active') {
    const active = input.active === true
    if (!active && target.user_id === caller.user_id) return fail('self')
    try {
      await store.setActive(target.user_id, active)
    } catch (error) {
      const guard = knownGuard(error)
      if (guard) return fail(guard, 409)
      throw error
    }
    // The database already refuses a deactivated person; the ban also stops sign-in.
    await auth.setBanned(target.user_id, !active)
    return ok()
  }

  if (action === 'set_role') {
    const role = input.role === 'admin' || input.role === 'staff' ? input.role : null
    if (!role) return fail('invalid_role')
    try {
      await store.setRole(target.user_id, role)
    } catch (error) {
      const guard = knownGuard(error)
      if (guard) return fail(guard, 409)
      throw error
    }
    return ok()
  }

  if (action === 'send_reset') {
    if (!target.active) return fail('inactive', 409)
    await store.queueAccountEmail(target.user_id, 'staff_password_reset', newId())
    await store.kickWorker()
    return ok()
  }

  return fail('unknown_action')
}
