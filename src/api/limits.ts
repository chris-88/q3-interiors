import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { toApiError } from './errors'

/** Same bounds as the database (go-live checklist migration). */
export const LIMIT_BOUNDS = {
  enquiry_limit_per_hour: {
    min: 1,
    max: 100,
    label: 'Enquiries per hour from one connection',
    hint: 'Stops one person or bot sending many enquiries. 5 suits most homes; raise it for an office or event sharing one connection.',
  },
  booking_write_limit_per_hour: {
    min: 5,
    max: 500,
    label: 'Bookings and changes per hour from one connection',
    hint: 'Booking, moving and cancelling count here.',
  },
  booking_read_limit_per_hour: {
    min: 50,
    max: 5000,
    label: 'Booking page loads per hour from one connection',
    hint: 'Looking at times. Keep it generous: customers browse several days.',
  },
} as const

export type LimitKey = keyof typeof LIMIT_BOUNDS
export type Limits = Record<LimitKey, number>

const limitsSchema = z.object({
  enquiry_limit_per_hour: z.number().int(),
  booking_write_limit_per_hour: z.number().int(),
  booking_read_limit_per_hour: z.number().int(),
})

export function limitProblem(key: LimitKey, value: number): string | null {
  const b = LIMIT_BOUNDS[key]
  if (!Number.isInteger(value)) return 'Enter a whole number.'
  if (value < b.min || value > b.max) return `Choose a number from ${b.min} to ${b.max}.`
  return null
}

export function useLimits() {
  return useQuery({
    queryKey: ['limits'],
    queryFn: async (): Promise<Limits> => {
      const { data, error } = await supabase
        .from('booking_settings')
        .select('enquiry_limit_per_hour, booking_write_limit_per_hour, booking_read_limit_per_hour')
        .single()
      if (error) throw toApiError(error)
      return limitsSchema.parse(data)
    },
  })
}

export function useSaveLimits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (value: Limits) => {
      const { data, error } = await supabase
        .from('booking_settings')
        .update({ ...value, updated_at: new Date().toISOString() })
        .eq('id', true)
        .select('id')
      if (error) throw toApiError(error)
      if (!data || data.length === 0) throw toApiError({ message: 'not allowed', code: '42501' })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['limits'] }),
  })
}
