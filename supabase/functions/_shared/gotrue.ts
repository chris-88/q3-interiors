// GoTrue (Supabase Auth) admin calls, made only by the Edge Functions with the stack's service key.
// Nothing here is reachable from a browser.

export interface AuthAdmin {
  /** Creates a confirmed user with an unusable random password; returns the new id. */
  createUser(email: string): Promise<string>
  /** Banned users cannot sign in or refresh a session. */
  setBanned(userId: string, banned: boolean): Promise<void>
  setPassword(userId: string, password: string): Promise<void>
  /**
   * A single-use recovery token hash for the address (GoTrue's generate_link, which sends no
   * email itself). The app emails it as a link to /#/staff/set-password.
   */
  recoveryTokenHash(email: string): Promise<string>
}

export class AuthAdminError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthAdminError'
    this.status = status
  }
}

function randomPassword(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function createAuthAdmin(opts: {
  url: string
  serviceKey: string
  fetch?: typeof fetch
}): AuthAdmin {
  const doFetch = opts.fetch ?? fetch
  const call = async (path: string, method: string, body: unknown) => {
    const res = await doFetch(`${opts.url}/auth/v1${path}`, {
      method,
      headers: {
        apikey: opts.serviceKey,
        Authorization: `Bearer ${opts.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    const text = await res.text()
    if (!res.ok)
      throw new AuthAdminError(`auth said HTTP ${res.status}: ${text.slice(0, 200)}`, res.status)
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  }
  return {
    async createUser(email) {
      const user = await call('/admin/users', 'POST', {
        email,
        email_confirm: true,
        password: randomPassword(),
      })
      const id = (user.id ?? (user.user as { id?: string } | undefined)?.id) as string | undefined
      if (!id) throw new AuthAdminError('auth returned no user id', 500)
      return id
    },
    async setBanned(userId, banned) {
      await call(`/admin/users/${userId}`, 'PUT', { ban_duration: banned ? '876000h' : 'none' })
    },
    async setPassword(userId, password) {
      await call(`/admin/users/${userId}`, 'PUT', { password })
    },
    async recoveryTokenHash(email) {
      const link = await call('/admin/generate_link', 'POST', { type: 'recovery', email })
      const hash =
        (link.hashed_token as string | undefined) ??
        (link.properties as { hashed_token?: string } | undefined)?.hashed_token ??
        undefined
      if (!hash) throw new AuthAdminError('auth returned no token', 500)
      return hash
    },
  }
}
