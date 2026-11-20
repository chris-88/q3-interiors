/** An error from Supabase/PostgREST, carrying the Postgres error code when there is one. */
export class ApiError extends Error {
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export function toApiError(error: { message: string; code?: string } | null | undefined): ApiError {
  return new ApiError(error?.message ?? 'Unexpected response', error?.code)
}
