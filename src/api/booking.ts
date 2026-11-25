import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseRows } from '@/lib/tolerant'
import { ApiError, RateLimitedError } from './errors'

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
  canChange: z.boolean(),
  businessPhone: z.string().nullable(),
})
export type CustomerBooking = z.infer<typeof bookingSchema>

const typeOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  mode: z.enum(['phone', 'on_site']),
  durationMinutes: z.number(),
  requiresSiteAddress: z.boolean(),
  eligibility: z.string(),
})

const contextSchema = z.object({
  reference: z.string(),
  firstName: z.string().nullable(),
  // Defaults keep this page working against a function deployed before form v2.
  phone: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  preference: z.enum(['phone', 'on_site']).nullable().default(null),
  siteStreet: z.string().nullable().default(null),
  siteUnit: z.string().nullable().default(null),
  siteAddress: z.string().nullable(),
  contactRequested: z.boolean(),
  calendarAvailable: z.boolean(),
  // Row by row: a type with a mode this page does not know is left out, not fatal.
  types: z
    .array(z.unknown())
    .transform((rows) => parseRows(typeOptionSchema, rows, 'appointment types')),
  booking: bookingSchema.nullable(),
})
export type BookingContext = z.infer<typeof contextSchema>
export type AppointmentTypeOption = BookingContext['types'][number]

const unavailableSchema = z.object({
  status: z.literal('unavailable'),
  // Any reason: a newer function may add one; the page treats them all alike.
  reason: z.string(),
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

/** A refusal from public-booking: the HTTP status and the function's error code. */
export class BookingApiError extends ApiError {
  readonly reason: string | null
  constructor(status: number, reason: string | null) {
    super(`public-booking returned ${status}`, String(status))
    this.name = 'BookingApiError'
    this.reason = reason
  }
}

export async function call<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('public-booking', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response
      const status = response.status
      if (status === 401) throw new InvalidLinkError()
      if (status === 429) throw new RateLimitedError()
      let reason: string | null = null
      try {
        const parsed = z.object({ error: z.string() }).safeParse(await response.json())
        if (parsed.success) reason = parsed.data.error
      } catch {
        // not JSON
      }
      throw new BookingApiError(status, reason)
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

export type DetailsPatch = {
  phone?: string
  appointment_preference?: 'phone' | 'on_site'
  site_street?: string
  site_unit?: string
}

/** The server refused the details as invalid: the field needs attention, not a retry. */
export class InvalidDetailsError extends Error {
  constructor() {
    super('The details were not accepted')
    this.name = 'InvalidDetailsError'
  }
}

/** The time screen's editable line, and a change between call and visit, before booking. */
export async function updateDetails(token: string, details: DetailsPatch): Promise<void> {
  try {
    await call(
      { action: 'update_details', token, details },
      z.object({ status: z.literal('saved') }),
    )
  } catch (error) {
    if (error instanceof ApiError && error.code === '400') throw new InvalidDetailsError()
    throw error
  }
}

/**
 * The time screen's one action: save any changed details (number, address, call or visit), then
 * book. The booking idempotency key makes a double tap or a retry land on the same booking.
 */
export function useCommitBooking(token: string) {
  return useMutation({
    mutationFn: async (input: {
      details: DetailsPatch | null
      typeId: string
      start: string
      idempotencyKey: string
    }) => {
      if (input.details) {
        try {
          await updateDetails(token, input.details)
        } catch (error) {
          // 409: a booking already exists (a retry after a lost reply). The book call below
          // returns it through the same idempotency key.
          if (!(error instanceof ApiError && error.code === '409')) throw error
        }
      }
      return call(
        {
          action: 'book',
          token,
          typeId: input.typeId,
          start: input.start,
          idempotencyKey: input.idempotencyKey,
        },
        bookResultSchema,
      )
    },
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

const changeBase = { booking: bookingSchema.nullable().optional() }
const tooLate = z.object({ status: z.literal('too_late'), businessPhone: z.string().nullable() })
const notLive = z.object({ status: z.literal('not_live'), ...changeBase })

const moveOptionsSchema = z.union([availabilitySchema, tooLate, notLive])
export type MoveOptions = z.infer<typeof moveOptionsSchema>

const rescheduleSchema = z.union([
  z.object({ status: z.literal('rescheduled'), changed: z.boolean(), ...changeBase }),
  z.object({
    status: z.literal('slot_unavailable'),
    alternatives: z.array(slotSchema),
    ...changeBase,
  }),
  z.object({ status: z.literal('unavailable'), reason: z.string(), ...changeBase }),
  tooLate,
  notLive,
])
export type RescheduleResult = z.infer<typeof rescheduleSchema>

const cancelSchema = z.union([
  z.object({ status: z.literal('cancelled'), changed: z.boolean(), ...changeBase }),
  tooLate,
  notLive,
])
export type CancelResult = z.infer<typeof cancelSchema>

/** Free times to move the customer's live booking to (its own time is not offered). */
export function useMoveOptions(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ['booking', token, 'move_options'],
    enabled,
    staleTime: 30_000,
    queryFn: () => call({ action: 'move_options', token }, moveOptionsSchema),
  })
}

export function useReschedule(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (start: string) => call({ action: 'reschedule', token, start }, rescheduleSchema),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking', token] }),
  })
}

/**
 * `onDone` runs before the booking queries refresh: the refresh unmounts the component that
 * started the cancel, so per-call callbacks would never fire.
 */
export function useCancelBooking(token: string, onDone?: (result: CancelResult) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason: string) =>
      call({ action: 'cancel', token, reason: reason || undefined }, cancelSchema),
    retry: false,
    onSuccess: (result) => {
      onDone?.(result)
      return queryClient.invalidateQueries({ queryKey: ['booking', token] })
    },
  })
}
