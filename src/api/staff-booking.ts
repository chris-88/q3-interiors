import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { ApiError, toApiError } from './errors'

export const BOOKING_STATES = [
  'reserved',
  'calendar_pending',
  'confirmed',
  'failed',
  'cancelled',
] as const
export type BookingState = (typeof BOOKING_STATES)[number]
export const BOOKING_STATE_LABELS: Record<BookingState, string> = {
  reserved: 'Reserved',
  calendar_pending: 'Confirming',
  confirmed: 'Confirmed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const answers = z.record(z.string(), z.union([z.string(), z.array(z.string())]))

const bookingSchema = z.object({
  id: z.string(),
  enquiry_id: z.string(),
  state: z.enum(BOOKING_STATES),
  starts_at: z.string(),
  ends_at: z.string(),
  failure_reason: z.string().nullable(),
  calendar_event_id: z.string(),
  calendar_event_link: z.string().nullable(),
  created_at: z.string(),
  attendance: z.enum(['attended', 'no_show']).nullable(),
  cancelled_at: z.string().nullable(),
  cancelled_by: z.enum(['customer', 'staff']).nullable(),
  cancel_reason: z.string().nullable(),
  calendar_mismatch: z.string().nullable(),
  appointment_types: z.object({ label: z.string(), mode: z.enum(['phone', 'on_site']) }),
  enquiries: z.object({ reference: z.string(), answers }).nullable(),
})
export type StaffBooking = z.infer<typeof bookingSchema>

const BOOKING_COLUMNS = `id, enquiry_id, state, starts_at, ends_at, failure_reason, calendar_event_id,
  calendar_event_link, created_at, attendance, cancelled_at, cancelled_by, cancel_reason,
  calendar_mismatch, appointment_types (label, mode), enquiries (reference, answers)`

export function useAppointments() {
  return useQuery({
    queryKey: ['appointments'],
    queryFn: async (): Promise<StaffBooking[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(BOOKING_COLUMNS)
        .order('starts_at', { ascending: true })
        .limit(300)
      if (error) throw toApiError(error)
      return z.array(bookingSchema).parse(data)
    },
  })
}

export function useEnquiryBookings(enquiryId: string) {
  return useQuery({
    queryKey: ['enquiries', enquiryId, 'bookings'],
    queryFn: async (): Promise<StaffBooking[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(BOOKING_COLUMNS)
        .eq('enquiry_id', enquiryId)
        .order('created_at', { ascending: false })
      if (error) throw toApiError(error)
      return z.array(bookingSchema).parse(data)
    },
  })
}

const connectionSchema = z.object({
  staff_user_id: z.string(),
  status: z.enum(['connected', 'disconnected']),
  google_email: z.string().nullable(),
  calendar_id: z.string(),
  connected_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_error: z.string().nullable(),
  last_error_at: z.string().nullable(),
})
export type CalendarConnection = z.infer<typeof connectionSchema>

export function useCalendarConnection(staffUserId: string | undefined) {
  return useQuery({
    queryKey: ['calendar_connection', staffUserId],
    enabled: staffUserId !== undefined,
    queryFn: async (): Promise<CalendarConnection | null> => {
      const { data, error } = await supabase
        .from('calendar_connections')
        .select(
          'staff_user_id, status, google_email, calendar_id, connected_at, last_success_at, last_error, last_error_at',
        )
        .eq('staff_user_id', staffUserId ?? '')
        .maybeSingle()
      if (error) throw toApiError(error)
      return data === null ? null : connectionSchema.parse(data)
    },
  })
}

export type CalendarAction = 'start' | 'test' | 'disconnect'

const actionResult = z.object({
  url: z.string().optional(),
  status: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
})

export function useCalendarAction(staffUserId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: CalendarAction) => {
      const { data, error } = await supabase.functions.invoke('calendar-admin', {
        body: { action },
      })
      if (error) throw new ApiError(error.message)
      const parsed = actionResult.parse(data)
      if (parsed.error === 'not_configured') {
        throw new ApiError('Google sign-in is not set up on the server yet', 'not_configured')
      }
      if (parsed.error || parsed.status === 'error')
        throw new ApiError(parsed.message ?? parsed.error ?? 'Failed')
      return parsed
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['calendar_connection', staffUserId] }),
  })
}

export const WEEKDAYS = [
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday'],
  ['7', 'Sunday'],
] as const

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM')

export const availabilitySchema = z.object({
  staff_user_id: z.string(),
  working_hours: z.record(z.string(), z.array(z.tuple([clock, clock]))),
  min_notice_minutes: z.number().int().min(0).max(20160),
  horizon_days: z.number().int().min(1).max(120),
  daily_visit_limit: z.number().int().min(0).max(20),
  slot_step_minutes: z.union([
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(30),
    z.literal(60),
  ]),
})
export type StaffAvailability = z.infer<typeof availabilitySchema>

export function useStaffAvailability(staffUserId: string | undefined) {
  return useQuery({
    queryKey: ['staff_availability', staffUserId],
    enabled: staffUserId !== undefined,
    queryFn: async (): Promise<StaffAvailability | null> => {
      const { data, error } = await supabase
        .from('staff_availability')
        .select(
          'staff_user_id, working_hours, min_notice_minutes, horizon_days, daily_visit_limit, slot_step_minutes',
        )
        .eq('staff_user_id', staffUserId ?? '')
        .maybeSingle()
      if (error) throw toApiError(error)
      return data === null ? null : availabilitySchema.parse(data)
    },
  })
}

export function useUpdateAvailability() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (value: StaffAvailability) => {
      const { staff_user_id, ...rest } = availabilitySchema.parse(value)
      const { error } = await supabase
        .from('staff_availability')
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq('staff_user_id', staff_user_id)
      if (error) throw toApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff_availability'] }),
  })
}

export const appointmentTypeSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  mode: z.enum(['phone', 'on_site']),
  duration_minutes: z.number().int().min(5).max(480),
  buffer_before_minutes: z.number().int().min(0).max(240),
  buffer_after_minutes: z.number().int().min(0).max(240),
  active: z.boolean(),
  what_to_prepare: z.string(),
})
export type AppointmentTypeSettings = z.infer<typeof appointmentTypeSchema>

export function useAppointmentTypes() {
  return useQuery({
    queryKey: ['appointment_types'],
    queryFn: async (): Promise<AppointmentTypeSettings[]> => {
      const { data, error } = await supabase
        .from('appointment_types')
        .select(
          'id, label, mode, duration_minutes, buffer_before_minutes, buffer_after_minutes, active, what_to_prepare',
        )
        .order('sort_order')
      if (error) throw toApiError(error)
      return z.array(appointmentTypeSchema).parse(data)
    },
  })
}

export function useUpdateAppointmentType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (value: AppointmentTypeSettings) => {
      const { id, mode: _mode, ...rest } = appointmentTypeSchema.parse(value)
      const { error } = await supabase
        .from('appointment_types')
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw toApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointment_types'] }),
  })
}

export type StaffException = {
  id: string
  kind: 'calendar' | 'booking' | 'contact' | 'email'
  text: string
  link: string
}

/** Things that need a person: a disconnected calendar, failed bookings, contact requests, failed emails. */
export function useExceptions(staffUserId: string | undefined) {
  return useQuery({
    queryKey: ['exceptions', staffUserId],
    enabled: staffUserId !== undefined,
    refetchInterval: 60_000,
    queryFn: async (): Promise<StaffException[]> => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const [connection, failed, contacts, emails, mismatches, removals, orphans] =
        await Promise.all([
          supabase
            .from('calendar_connections')
            .select('status, last_error')
            .eq('staff_user_id', staffUserId ?? '')
            .maybeSingle(),
          supabase
            .from('bookings')
            .select('id, enquiry_id, failure_reason, enquiries (reference)')
            .eq('state', 'failed')
            .gte('updated_at', since)
            .order('updated_at', { ascending: false }),
          supabase
            .from('enquiries')
            .select('id, reference, contact_request_reason')
            .not('contact_requested_at', 'is', null)
            .eq('status', 'new')
            .order('contact_requested_at', { ascending: false }),
          supabase
            .from('communications')
            .select('id, enquiry_id, last_error, enquiries (reference)')
            .eq('state', 'failed')
            .gte('updated_at', since),
          supabase
            .from('bookings')
            .select('id, enquiry_id, calendar_mismatch, enquiries (reference)')
            .not('calendar_mismatch', 'is', null)
            .in('state', ['reserved', 'calendar_pending', 'confirmed']),
          supabase
            .from('integration_jobs')
            .select('id, last_error, bookings (enquiry_id, enquiries (reference))')
            .eq('kind', 'delete_calendar_event')
            .eq('state', 'failed')
            .gte('updated_at', since),
          supabase.rpc('pending_event_deletion_count'),
        ])
      for (const r of [connection, failed, contacts, emails, mismatches, removals, orphans]) {
        if (r.error) throw toApiError(r.error)
      }
      const out: StaffException[] = []
      const conn = z
        .object({ status: z.string(), last_error: z.string().nullable() })
        .nullable()
        .parse(connection.data)
      if (!conn || conn.status !== 'connected') {
        out.push({
          id: 'calendar',
          kind: 'calendar',
          text: conn
            ? `Google Calendar is disconnected${conn.last_error ? `: ${conn.last_error}` : ''}. Customers are being asked if we can contact them instead.`
            : 'No Google Calendar is connected. Customers cannot book times and are offered a call-back instead.',
          link: '/staff/settings',
        })
      }
      const ref = z.object({ reference: z.string() }).nullable()
      for (const b of z
        .array(
          z.object({
            id: z.string(),
            enquiry_id: z.string(),
            failure_reason: z.string().nullable(),
            enquiries: ref,
          }),
        )
        .parse(failed.data)) {
        out.push({
          id: `booking-${b.id}`,
          kind: 'booking',
          text: `Booking for ${b.enquiries?.reference ?? 'an enquiry'} failed: ${b.failure_reason ?? 'unknown reason'}`,
          link: `/staff/enquiries/${b.enquiry_id}`,
        })
      }
      for (const e of z
        .array(
          z.object({
            id: z.string(),
            reference: z.string(),
            contact_request_reason: z.string().nullable(),
          }),
        )
        .parse(contacts.data)) {
        out.push({
          id: `contact-${e.id}`,
          kind: 'contact',
          text: `${e.reference} asked to be contacted${e.contact_request_reason ? ` (${e.contact_request_reason})` : ''}`,
          link: `/staff/enquiries/${e.id}`,
        })
      }
      for (const c of z
        .array(
          z.object({
            id: z.string(),
            enquiry_id: z.string(),
            last_error: z.string().nullable(),
            enquiries: ref,
          }),
        )
        .parse(emails.data)) {
        out.push({
          id: `email-${c.id}`,
          kind: 'email',
          text: `Confirmation email for ${c.enquiries?.reference ?? 'an enquiry'} not sent: ${c.last_error ?? 'unknown error'}`,
          link: `/staff/enquiries/${c.enquiry_id}`,
        })
      }
      for (const b of z
        .array(
          z.object({
            id: z.string(),
            enquiry_id: z.string(),
            calendar_mismatch: z.string(),
            enquiries: ref,
          }),
        )
        .parse(mismatches.data)) {
        out.push({
          id: `mismatch-${b.id}`,
          kind: 'calendar',
          text: `${b.enquiries?.reference ?? 'A booking'}: ${b.calendar_mismatch}. The booking itself is unchanged.`,
          link: `/staff/enquiries/${b.enquiry_id}`,
        })
      }
      for (const j of z
        .array(
          z.object({
            id: z.number(),
            last_error: z.string().nullable(),
            bookings: z.object({ enquiry_id: z.string(), enquiries: ref }).nullable(),
          }),
        )
        .parse(removals.data)) {
        out.push({
          id: `removal-${j.id}`,
          kind: 'calendar',
          text: `Could not remove the Google Calendar event for cancelled ${j.bookings?.enquiries?.reference ?? 'booking'}: ${j.last_error ?? 'unknown error'}`,
          link: j.bookings ? `/staff/enquiries/${j.bookings.enquiry_id}` : '/staff/appointments',
        })
      }
      const stuck = z.number().parse(orphans.data)
      if (stuck > 0) {
        out.push({
          id: 'orphans',
          kind: 'calendar',
          text: `${stuck} Google Calendar event${stuck === 1 ? '' : 's'} from deleted enquiries could not be removed yet. Remove ${stuck === 1 ? 'it' : 'them'} by hand if this persists.`,
          link: '/staff/settings',
        })
      }
      return out
    },
  })
}

// Slice 3 ----------------------------------------------------------------------------------------

const slotSchema = z.object({
  start: z.string(),
  end: z.string(),
  date: z.string(),
  time: z.string(),
})
export type StaffSlot = z.infer<typeof slotSchema>

const moveOptionsSchema = z.union([
  z.object({ status: z.literal('ok'), slots: z.array(slotSchema), timezone: z.string() }),
  z.object({ status: z.literal('unavailable'), reason: z.string() }),
])

const changeSchema = z.union([
  z.object({ status: z.enum(['rescheduled', 'cancelled']), changed: z.boolean() }),
  z.object({ status: z.literal('slot_unavailable'), alternatives: z.array(slotSchema) }),
  z.object({ status: z.enum(['not_live', 'unavailable']) }).loose(),
])
export type StaffChangeResult = z.infer<typeof changeSchema>

async function staffCall<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff-booking', { body })
  if (error) throw new ApiError(error.message)
  return schema.parse(data)
}

export function useStaffMoveOptions(bookingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['staff-move-options', bookingId],
    enabled,
    staleTime: 30_000,
    queryFn: () => staffCall({ action: 'move_options', bookingId }, moveOptionsSchema),
  })
}

function useBookingChange<I>(build: (input: I) => Record<string, unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: I) => staffCall(build(input), changeSchema),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['enquiries'] }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
        queryClient.invalidateQueries({ queryKey: ['staff-move-options'] }),
        queryClient.invalidateQueries({ queryKey: ['exceptions'] }),
      ]),
  })
}

export function useStaffReschedule() {
  return useBookingChange((i: { bookingId: string; start: string }) => ({
    action: 'reschedule',
    ...i,
  }))
}

export function useStaffCancel() {
  return useBookingChange((i: { bookingId: string; reason: string }) => ({
    action: 'cancel',
    bookingId: i.bookingId,
    reason: i.reason || undefined,
  }))
}

export function useSetAttendance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (i: { bookingId: string; attendance: 'attended' | 'no_show' }) => {
      const { error } = await supabase.rpc('set_booking_attendance', {
        p_booking_id: i.bookingId,
        p_attendance: i.attendance,
      })
      if (error) throw toApiError(error)
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['enquiries'] }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      ]),
  })
}

export const LOST_REASONS = [
  ['price', 'Price'],
  ['timing', 'Timing'],
  ['chose_another', 'Chose another company'],
  ['project_cancelled', 'Project cancelled or postponed'],
  ['no_response', 'No response'],
  ['other', 'Other'],
] as const
export type LostReason = (typeof LOST_REASONS)[number][0]

export const outcomeSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('won'),
    value: z.number().nonnegative().max(9_999_999).nullable(),
  }),
  z
    .object({
      outcome: z.literal('lost'),
      reason: z.enum(LOST_REASONS.map(([v]) => v) as [LostReason, ...LostReason[]]),
      note: z.string().trim().max(500),
    })
    .refine((v) => v.reason !== 'other' || v.note.length > 0, {
      path: ['note'],
      message: 'Say why.',
    }),
  z.object({ outcome: z.literal('none') }),
])
export type OutcomeInput = z.infer<typeof outcomeSchema>

export function useSetOutcome(enquiryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: OutcomeInput) => {
      const v = outcomeSchema.parse(input)
      const { error } = await supabase.rpc('set_enquiry_outcome', {
        p_enquiry_id: enquiryId,
        p_outcome: v.outcome === 'none' ? null : v.outcome,
        p_value: v.outcome === 'won' ? v.value : null,
        p_reason: v.outcome === 'lost' ? v.reason : null,
        p_note: v.outcome === 'lost' ? v.note || null : null,
      })
      if (error) throw toApiError(error)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['enquiries'] }),
  })
}

export const bookingSettingsSchema = z.object({
  change_cutoff_minutes: z.number().int().min(0).max(10080),
  reminder_lead_minutes: z.number().int().min(30).max(10080),
  retention_months: z.number().int().min(1).max(120).nullable(),
})
export type BookingSettings = z.infer<typeof bookingSettingsSchema>

export function useBookingSettings() {
  return useQuery({
    queryKey: ['booking_settings'],
    queryFn: async (): Promise<BookingSettings | null> => {
      const { data, error } = await supabase
        .from('booking_settings')
        .select('change_cutoff_minutes, reminder_lead_minutes, retention_months')
        .maybeSingle()
      if (error) throw toApiError(error)
      return data === null ? null : bookingSettingsSchema.parse(data)
    },
  })
}

export function useUpdateBookingSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (value: BookingSettings) => {
      const v = bookingSettingsSchema.parse(value)
      const { error } = await supabase
        .from('booking_settings')
        .update({ ...v, updated_at: new Date().toISOString() })
        .eq('id', true)
      if (error) throw toApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking_settings'] }),
  })
}

const funnelRowSchema = z.object({
  campaign: z.string(),
  enquiries: z.coerce.number(),
  booked: z.coerce.number(),
  attended: z.coerce.number(),
  won: z.coerce.number(),
  cancelled: z.coerce.number(),
  no_shows: z.coerce.number(),
  won_value: z.coerce.number(),
})

export function useFunnelReport(from: string, to: string) {
  return useQuery({
    queryKey: ['funnel', from, to],
    enabled: from !== '' && to !== '' && from <= to,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('funnel_report', { p_from: from, p_to: to })
      if (error) throw toApiError(error)
      return z.array(funnelRowSchema).parse(data)
    },
  })
}

// Slice 4 ----------------------------------------------------------------------------------------

/** How many enquiries a retention run would delete with `months` (or the saved setting). */
export function useRetentionPreview(months: number | null) {
  return useQuery({
    queryKey: ['retention_preview', months],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('retention_preview', { p_months: months })
      if (error) throw toApiError(error)
      return z.number().parse(data)
    },
  })
}

/** Delete an enquiry for a data request. `confirm` must be the enquiry's reference. */
/** `onDeleted` runs before the queries refresh (the refresh unmounts the detail page). */
export function useDeleteEnquiry(onDeleted?: (reference: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { enquiryId: string; confirm: string }) => {
      const { data, error } = await supabase.rpc('delete_enquiry', {
        p_enquiry_id: input.enquiryId,
        p_confirm_reference: input.confirm,
      })
      if (error) throw toApiError(error)
      return z.string().parse(data)
    },
    onSuccess: (reference) => {
      onDeleted?.(reference)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['enquiries'] }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
        queryClient.invalidateQueries({ queryKey: ['exceptions'] }),
      ])
    },
  })
}
