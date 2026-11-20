import type { Interval, Reservation, WeeklyHours } from './slots.ts'

export type AppointmentType = {
  id: string
  label: string
  description: string
  what_to_prepare: string
  mode: 'phone' | 'on_site'
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  requires_site_address: boolean
  requires_phone: boolean
  active: boolean
  sort_order: number
}

export type StaffAvailability = {
  staff_user_id: string
  working_hours: WeeklyHours
  min_notice_minutes: number
  horizon_days: number
  daily_visit_limit: number
  slot_step_minutes: number
}

export type CalendarConnection = {
  staff_user_id: string
  status: 'connected' | 'disconnected'
  google_email: string | null
  calendar_id: string
}

export type BookingState = 'reserved' | 'calendar_pending' | 'confirmed' | 'failed' | 'cancelled'

export type BookingRow = {
  id: string
  enquiry_id: string
  staff_user_id: string
  appointment_type_id: string
  starts_at: string
  ends_at: string
  state: BookingState
  calendar_event_id: string
  idempotency_key: string
  created_at: string
}

export type Answers = Record<string, string | string[]>

export type EnquiryRow = {
  id: string
  reference: string
  answers: Answers
  site_details: Answers | null
  contact_requested_at: string | null
}

export type CalendarJob = {
  id: number
  booking_id: string
  attempts: number
  max_attempts: number
  outcome_unknown: boolean
}

export type Communication = {
  id: string
  enquiry_id: string
  booking_id: string | null
  template: 'booking_confirmation'
  recipient: string
  dedupe_key: string
  attempts: number
  max_attempts: number
}

export type BookingContext = {
  booking: BookingRow
  type: AppointmentType
  enquiry: { id: string; reference: string; answers: Answers; site_details: Answers | null }
  staff: { user_id: string; display_name: string }
  connection: CalendarConnection | null
}

export type ReserveResult =
  | { status: 'reserved' | 'existing' | 'already_booked'; booking_id: string }
  | { status: 'slot_unavailable'; reason: 'taken' | 'notice' | 'daily_limit' }
  | { status: 'ineligible'; reason: string }
  | { status: 'no_staff' }

/** Everything the functions need from Postgres. Implemented with postgres.js in `db.ts`. */
export interface Db {
  resolveToken(token: string): Promise<string | null>
  getEnquiry(id: string): Promise<EnquiryRow | null>
  listTypes(): Promise<AppointmentType[]>
  eligibility(enquiryId: string, typeId: string): Promise<string>
  bookableStaff(): Promise<string | null>
  getAvailability(staffId: string): Promise<StaffAvailability | null>
  getConnection(staffId: string): Promise<CalendarConnection | null>
  getTokenCiphertext(staffId: string): Promise<string | null>
  liveReservations(staffId: string, window: Interval): Promise<Reservation[]>
  latestBooking(enquiryId: string): Promise<BookingRow | null>
  bookingByKey(key: string): Promise<BookingRow | null>
  reserve(enquiryId: string, typeId: string, startIso: string, key: string): Promise<ReserveResult>
  saveSiteDetails(enquiryId: string, answers: Answers): Promise<void>
  requestContact(enquiryId: string, reason: string): Promise<void>
  bookingContext(bookingId: string): Promise<BookingContext | null>
  claimCalendarJobs(limit: number, bookingId?: string): Promise<CalendarJob[]>
  calendarJobStarted(jobId: number): Promise<void>
  completeCalendarJob(jobId: number, link: string | null): Promise<void>
  retryCalendarJob(
    jobId: number,
    error: string,
    outcomeUnknown: boolean,
    delaySeconds: number,
  ): Promise<void>
  failCalendarJob(jobId: number, error: string, outcomeUnknown: boolean): Promise<void>
  claimCommunications(limit: number, bookingId?: string): Promise<Communication[]>
  communicationSent(id: string, providerId: string | null): Promise<void>
  communicationRetry(id: string, error: string, delaySeconds: number, final: boolean): Promise<void>
  markDisconnected(staffId: string, error: string): Promise<void>
  recordCalendarError(staffId: string, error: string): Promise<void>
}
