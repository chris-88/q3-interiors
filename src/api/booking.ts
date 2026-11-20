import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { ApiError } from './errors'

/**
 * Customer scheduling, through the `public-booking` Edge Function. Every call carries the
 * enquiry access token; the function resolves it to one enquiry and acts only on that.
 */

const slotSchema = z.object({
  start: z.string(),
  end: z.string(),
  date: z.string(),
  time: z.string(),
})
export type Slot = z.infer<typeof slotSchema>

const bookingSchema = z.object({
  id: z.string(),
  state: z.enum(['reserved', 'calendar_pending', 'confirmed', 'failed', 'cancelled']),
  type: z.object({
    id: z.string(),
    label: z.string(),
    mode: z.enum(['phone', 'on_site']),
    durationMinutes: z.number(),
  }),
  start: z.string(),
  end: z.string(),
  timezone: z.string(),
  staffFirstName: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  whatToPrepare: z.string(),
})
export type CustomerBooking = z.infer<typeof bookingSchema>

const contextSchema = z.object({
  reference: z.string(),
  firstName: z.string().nullable(),
  siteAddress: z.string().nullable(),
  contactRequested: z.boolean(),
  calendarAvailable: z.boolean(),
  types: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      mode: z.enum(['phone', 'on_site']),
      durationMinutes: z.number(),
      requiresSiteAddress: z.boolean(),
      eligibility: z.string(),
    }),
  ),
  booking: bookingSchema.nullable(),
})
export type BookingContext = z.infer<typeof contextSchema>
export type AppointmentTypeOption = BookingContext['types'][number]

const unavailableSchema = z.object({
  status: z.literal('unavailable'),
  reason: z.enum(['calendar_unavailable', 'calendar_error', 'no_staff']),
})

const availabilitySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), slots: z.array(slotSchema), timezone: z.string() }),
  unavailableSchema,
])
export type AvailabilityResult = z.infer<typeof availabilitySchema>

const bookResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('booked'), booking: bookingSchema.nullable() }),
  z.object({ status: z.literal('already_booked'), booking: bookingSchema.nullable() }),
  z.object({ status: z.literal('slot_unavailable'), alternatives: z.array(slotSchema) }),
  z.object({ status: z.literal('ineligible'), reason: z.string() }),
  unavailableSchema,
])
export type BookResult = z.infer<typeof bookResultSchema>

export class InvalidLinkError extends Error {
  constructor() {
    super('This booking link is not valid or has expired')
    this.name = 'InvalidLinkError'
  }
}

async function call<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('public-booking', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = (error.context as Response).status
      if (status === 401) throw new InvalidLinkError()
      throw new ApiError(`public-booking returned ${status}`, String(status))
    }
    throw new ApiError(error.message)
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new ApiError('Unexpected response from public-booking')
  return parsed.data
}

export function useBookingContext(token: string) {
  return useQuery({
    queryKey: ['booking', token, 'context'],
    queryFn: () => call({ action: 'context', token }, contextSchema),
    retry: (count, error) => !(error instanceof InvalidLinkError) && count < 2,
  })
}

export function useAvailability(token: string, typeId: string | null) {
  return useQuery({
    queryKey: ['booking', token, 'availability', typeId],
    enabled: typeId !== null,
    staleTime: 30_000,
    queryFn: () => call({ action: 'availability', token, typeId }, availabilitySchema),
  })
}

export function useSaveSiteDetails(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (answers: Record<string, string>) =>
      call({ action: 'site_details', token, answers }, z.object({ status: z.literal('saved') })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', token, 'context'] }),
  })
}

export function useBook(token: string) {
  return useMutation({
    mutationFn: (input: { typeId: string; start: string; idempotencyKey: string }) =>
      call({ action: 'book', token, ...input }, bookResultSchema),
    retry: false,
  })
}

/** Polls while the booking is being confirmed with the calendar. */
export function useBookingStatus(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ['booking', token, 'status'],
    enabled,
    refetchInterval: (query) => {
      const state = query.state.data?.booking?.state
      if (state !== 'reserved' && state !== 'calendar_pending') return false
      // Fast at first, then every 20 seconds: the retry worker runs every minute.
      return query.state.dataUpdateCount < 10 ? 3_000 : 20_000
    },
    queryFn: () =>
      call({ action: 'status', token }, z.object({ booking: bookingSchema.nullable() })),
  })
}

export function useRequestContact(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) =>
      call(
        { action: 'request_contact', token, reason },
        z.object({ status: z.literal('requested') }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', token, 'context'] }),
  })
}
