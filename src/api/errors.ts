/** An error from Supabase/PostgREST, carrying the Postgres error code when there is one. */
export class ApiError extends Error {
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** The server refused because this address sent too much in the last hour. */
export class RateLimitedError extends Error {
  constructor() {
    super('Too many requests from this address')
    this.name = 'RateLimitedError'
  }
}

export function toApiError(error: { message: string; code?: string } | null | undefined): ApiError {
  return new ApiError(error?.message ?? 'Unexpected response', error?.code)
}
