// After the introductory call: "We already spoke", the site visit booking link, and the site
// visit staff book for the customer (through staff-booking, the same reserve path as customers).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseOne } from '@/lib/tolerant'
import { ApiError, toApiError } from './errors'

function useInvalidateEnquiry(enquiryId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['enquiries'] }),
      queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      queryClient.invalidateQueries({ queryKey: ['visit-options', enquiryId] }),
      queryClient.invalidateQueries({ queryKey: ['call-options', enquiryId] }),
    ])
}

/** "We already spoke": the call held today; a call still to come is cancelled, no email. */
export function useCallHeldEarly(enquiryId: string) {
  const invalidate = useInvalidateEnquiry(enquiryId)
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('record_call_held_early', { p_enquiry_id: enquiryId })
      if (error) throw toApiError(error)
    },
    onSettled: invalidate,
  })
}

/** Email the customer a link to pick their own site visit time. */
export function useSendVisitLink(enquiryId: string) {
  const invalidate = useInvalidateEnquiry(enquiryId)
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('send_visit_link', { p_enquiry_id: enquiryId })
      if (error) throw toApiError(error)
    },
    onSettled: invalidate,
  })
}

const slotSchema = z.object({
  start: z.string(),
  end: z.string(),
  date: z.string(),
  time: z.string(),
})
export type VisitSlot = z.infer<typeof slotSchema>

const visitOptionsSchema = z.union([
  z.object({
    status: z.literal('ok'),
    slots: z.array(slotSchema),
    timezone: z.string(),
    typeLabel: z.string().default('Site visit'),
    eligibility: z.string(),
    siteAddress: z.string().nullable().default(null),
  }),
  z.object({ status: z.literal('unavailable'), reason: z.string() }).loose(),
])
export type VisitOptions = z.infer<typeof visitOptionsSchema>

const bookVisitSchema = z.union([
  z.object({ status: z.literal('booked'), bookingId: z.string() }),
  z.object({ status: z.literal('slot_unavailable'), alternatives: z.array(slotSchema) }),
  z
    .object({
      status: z.enum(['ineligible', 'invalid_address', 'unavailable', 'already_booked']),
      reason: z.string().optional(),
    })
    .loose(),
])
export type BookVisitResult = z.infer<typeof bookVisitSchema>

async function staffBooking<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff-booking', { body })
  if (error) throw new ApiError(error.message)
  return parseOne(schema, data, 'the reply from the server')
}

/** The free site visit times the customer would see, and whether the enquiry can have one. */
export function useVisitOptions(enquiryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['visit-options', enquiryId],
    enabled,
    staleTime: 30_000,
    queryFn: () => staffBooking({ action: 'visit_options', enquiryId }, visitOptionsSchema),
  })
}

export function useBookVisit(enquiryId: string) {
  const invalidate = useInvalidateEnquiry(enquiryId)
  return useMutation({
    mutationFn: (input: {
      start: string
      idempotencyKey: string
      siteStreet?: string
      siteUnit?: string
    }) => staffBooking({ action: 'book_visit', enquiryId, ...input }, bookVisitSchema),
    onSettled: invalidate,
  })
}

const callTimesSchema = z.object({
  status: z.literal('ok'),
  slots: z.array(slotSchema),
  timezone: z.string(),
  typeLabel: z.string().default('Phone call'),
  eligibility: z.string(),
})
export type CallTimes = z.infer<typeof callTimesSchema>
const callOptionsSchema = z.union([
  callTimesSchema,
  // An appointment still to come, the calendar unreadable, or a status a newer release adds.
  z.object({ status: z.string() }).loose(),
])
export type CallOptions = z.infer<typeof callOptionsSchema>

/** The free times, when the reply has them. */
export function callTimes(options: CallOptions): CallTimes | null {
  const parsed = callTimesSchema.safeParse(options)
  return parsed.success ? parsed.data : null
}

/** The free call times the customer would see, and whether the enquiry can have one. */
export function useCallOptions(enquiryId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['call-options', enquiryId],
    enabled,
    staleTime: 30_000,
    queryFn: () => staffBooking({ action: 'call_options', enquiryId }, callOptionsSchema),
  })
}

/** Book a call for the customer: the same reserve path, their usual confirmation email. */
export function useBookCall(enquiryId: string) {
  const invalidate = useInvalidateEnquiry(enquiryId)
  return useMutation({
    mutationFn: (input: { start: string; idempotencyKey: string }) =>
      staffBooking({ action: 'book_call', enquiryId, ...input }, bookVisitSchema),
    onSettled: invalidate,
  })
}
