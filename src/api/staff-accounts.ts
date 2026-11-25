import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { openEnum, parseOne, parseRows } from '@/lib/tolerant'
import { ApiError, toApiError } from './errors'

/** Same rule as the server (staff-accounts.ts): length only, 12 to 72 characters. */
export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 72

export const passwordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'The two passwords are different.',
  })

export type PasswordInput = z.infer<typeof passwordSchema>

export const newStaffSchema = z.object({
  name: z.string().trim().min(1, 'Enter their name.').max(120, 'Use a shorter name.'),
  email: z.string().trim().pipe(z.email('Enter their email address.')),
  role: z.enum(['staff', 'admin']),
})

export type NewStaffInput = z.infer<typeof newStaffSchema>

const staffRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  email: z.string(),
  role: openEnum(['admin', 'staff']),
  active: z.boolean(),
  created_at: z.string(),
})

export type StaffRow = z.infer<typeof staffRowSchema>

/** Plain-English messages for the function's error codes. */
const MESSAGES: Record<string, string> = {
  forbidden: 'Only an admin can do that.',
  already_staff: 'Someone with that email address is already on the team.',
  invalid_email: 'Enter a valid email address.',
  invalid_name: 'Enter their name.',
  takes_bookings:
    'This person takes the bookings. Choose someone else to take bookings first, then switch them off.',
  last_admin: 'There must always be at least one admin.',
  self: 'You cannot switch off your own account.',
  inactive: 'Switch this person back on first.',
  password_too_short: `Use at least ${PASSWORD_MIN} characters.`,
  password_too_long: `Use at most ${PASSWORD_MAX} characters.`,
  not_configured: 'Accounts are not set up on the server yet.',
}

export function accountErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code && MESSAGES[error.code])
    return MESSAGES[error.code] ?? ''
  return 'That did not work. Please try again in a moment.'
}

async function accountsCall(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('staff-accounts', { body })
  if (error) {
    let code: string | undefined
    if (error instanceof FunctionsHttpError) {
      try {
        code = ((await error.context.json()) as { error?: string }).error
      } catch {
        code = undefined
      }
    }
    throw new ApiError(code ?? error.message, code)
  }
  const parsed = z.record(z.string(), z.unknown()).parse(data)
  if (typeof parsed.error === 'string') throw new ApiError(parsed.error, parsed.error)
  return parsed
}

export function useStaffList() {
  return useQuery({
    queryKey: ['staff-list'],
    queryFn: async (): Promise<StaffRow[]> => {
      const { data, error } = await supabase
        .from('staff')
        .select('user_id, display_name, email, role, active, created_at')
        .order('created_at')
      if (error) throw toApiError(error)
      return parseRows(staffRowSchema, data, 'people')
    },
  })
}

export type AccountAction =
  | { action: 'add'; name: string; email: string; role: 'admin' | 'staff' }
  | { action: 'set_active'; userId: string; active: boolean }
  | { action: 'set_role'; userId: string; role: 'admin' | 'staff' }
  | { action: 'send_reset'; userId: string }

export function useAccountAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AccountAction) => accountsCall(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-list'] }),
  })
}

/** Anyone may ask; the answer is the same whether or not the address is staff. */
export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      await accountsCall({ action: 'forgot', email: email.trim() })
    },
  })
}

export function useSetPassword() {
  return useMutation({
    mutationFn: async (password: string) => {
      await accountsCall({ action: 'set_password', password })
    },
  })
}

const connectionRowSchema = z.object({
  staff_user_id: z.string(),
  status: openEnum(['connected', 'disconnected']),
  google_email: z.string().nullable(),
})

/** Every person's calendar connection health (no tokens). */
export function useCalendarConnections() {
  return useQuery({
    queryKey: ['calendar_connections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calendar_connections')
        .select('staff_user_id, status, google_email')
      if (error) throw toApiError(error)
      return parseRows(connectionRowSchema, data, 'calendar connections')
    },
  })
}

/** Who takes new bookings (one person). */
export function useBookablePerson() {
  return useQuery({
    queryKey: ['bookable-person'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('booking_settings')
        .select('bookable_staff_user_id')
        .maybeSingle()
      if (error) throw toApiError(error)
      return (
        parseOne(
          z.object({ bookable_staff_user_id: z.string().nullable() }).nullable(),
          data,
          'who takes bookings',
        )?.bookable_staff_user_id ?? null
      )
    },
  })
}

export function useSetBookablePerson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('set_bookable_staff', { p_user_id: userId })
      if (error) throw toApiError(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookable-person'] })
      void queryClient.invalidateQueries({ queryKey: ['staff_availability'] })
    },
  })
}
