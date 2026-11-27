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
  confirmed_at?: string | null
  cancelled_at?: string | null
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

export type Template =
  | 'booking_confirmation'
  | 'booking_reminder'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'staff_new_enquiry'
  | 'staff_callback_request'
  | 'staff_invite'
  | 'staff_password_reset'
  | 'estimate'
  | 'staff_quote_request'

export type StaffAccountTemplate = 'staff_invite' | 'staff_password_reset'

export type CustomerTemplate = Exclude<
  Template,
  | 'staff_new_enquiry'
  | 'staff_callback_request'
  | 'staff_quote_request'
  | 'estimate'
  | StaffAccountTemplate
>

export type Communication = {
  id: string
  /** Null for staff account emails (invite, password reset). */
  enquiry_id: string | null
  staff_user_id?: string | null
  booking_id: string | null
  /** Estimate emails and quote-request alerts: the estimate they are about. */
  estimate_id?: string | null
  template: Template
  /** For reminders and reschedule notices: the start time the message is about. */
  about_start?: string | null
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

export type SyncJob = {
  id: number
  booking_id: string
  kind: 'update_calendar_event' | 'delete_calendar_event'
  attempts: number
  max_attempts: number
}

export type BookingSettings = {
  change_cutoff_minutes: number
  reminder_lead_minutes: number
  business_phone: string | null
  booking_write_limit_per_hour?: number
  booking_read_limit_per_hour?: number
}

export type EnquirySummary = {
  id: string
  reference: string
  answers: Answers
  contact_request_reason: string | null
  /** The form version the enquiry was answered in (for option labels). */
  schema: {
    steps: { fields: { id: string; options?: { value: string; label: string }[] }[] }[]
  } | null
}

export type PendingEventDeletion = {
  calendar_event_id: string
  staff_user_id: string
  attempts: number
}

export type ChangeResult =
  | { status: 'cancelled' | 'rescheduled'; changed: boolean }
  | { status: 'not_live' }
  | { status: 'slot_unavailable'; reason: 'taken' | 'notice' | 'daily_limit' }

export type ReserveResult =
  | { status: 'reserved' | 'existing' | 'already_booked'; booking_id: string }
  | { status: 'slot_unavailable'; reason: 'taken' | 'notice' | 'daily_limit' }
  | { status: 'ineligible'; reason: string }
  | { status: 'no_staff' }

/** An estimate as the email and the customer's "Get my quote" page need it. */
export type EstimateRow = {
  id: string
  enquiry_id: string
  low_eur: number
  high_eur: number
  work_looked_at: string
  caveats: string
  sent_at: string
  valid_until: string
  quote_requested_at: string | null
}

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
  liveReservations(
    staffId: string,
    window: Interval,
    excludeBookingId?: string,
  ): Promise<Reservation[]>
  latestBooking(enquiryId: string): Promise<BookingRow | null>
  bookingByKey(key: string): Promise<BookingRow | null>
  reserve(enquiryId: string, typeId: string, startIso: string, key: string): Promise<ReserveResult>
  saveSiteDetails(enquiryId: string, answers: Answers): Promise<void>
  /** Phone, call-or-visit and visit address lines after the save (`private.update_enquiry_details`). */
  updateDetails(enquiryId: string, details: Record<string, string>): Promise<void>
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
  // Slice 3
  getSettings(): Promise<BookingSettings>
  bookingById(id: string): Promise<BookingRow | null>
  liveBookingFor(enquiryId: string): Promise<BookingRow | null>
  cancelBooking(
    id: string,
    actor: 'customer' | 'staff',
    reason: string | null,
    actorUserId?: string,
  ): Promise<ChangeResult>
  rescheduleBooking(
    id: string,
    startIso: string,
    actor: 'customer' | 'staff',
    actorUserId?: string,
  ): Promise<ChangeResult>
  claimSyncJobs(limit: number, bookingId?: string): Promise<SyncJob[]>
  completeSyncJob(jobId: number, syncedStartIso: string | null, detail: string): Promise<void>
  retrySyncJob(jobId: number, error: string, delaySeconds: number): Promise<void>
  failSyncJob(jobId: number, error: string): Promise<void>
  bookingsToReconcile(limit: number): Promise<BookingRow[]>
  recordReconcile(bookingId: string, mismatch: string | null): Promise<void>
  scheduleReminder(bookingId: string, plannedAtIso: string): Promise<void>
  communicationSkipped(id: string, reason: string): Promise<void>
  /** A fresh 30-day access token for an enquiry, for links in emails. Never logged. */
  mintAccessToken(enquiryId: string): Promise<string>
  // Slice 4
  /** Take one unit from a rate-limit bucket; false when over the limit. */
  rateLimitTake(
    bucket: 'booking_write' | 'booking_read',
    addrHash: string,
    idemKey: string | null,
    limit: number,
  ): Promise<boolean>
  enquirySummary(enquiryId: string): Promise<EnquirySummary | null>
  claimEventDeletions(limit: number): Promise<PendingEventDeletion[]>
  eventDeletionDone(eventId: string): Promise<void>
  eventDeletionFailed(eventId: string, error: string): Promise<void>
  // Slice 5
  /** Admin rewording of the email text blocks (key -> text); missing keys use the defaults. */
  getWording(): Promise<Record<string, string>>
  // Estimates after a site visit
  estimateById(estimateId: string): Promise<EstimateRow | null>
  /** Records "Get my quote" once (alerting staff); repeats change nothing. */
  requestQuote(
    enquiryId: string,
    estimateId: string,
  ): Promise<'requested' | 'already' | 'not_found'>
  // Form v2 part B: "Help us prepare"
  prepareState(enquiryId: string): Promise<PrepareState>
  savePrepare(
    enquiryId: string,
    patch: Record<string, string | boolean>,
  ): Promise<{ status: 'saved' | 'closed'; reason?: string }>
  reservePhoto(
    enquiryId: string,
    key: string,
    photo: { bytes: number; width: number; height: number; thumb: Uint8Array },
  ): Promise<PhotoReservation>
  photoStored(enquiryId: string, photoId: string): Promise<void>
  removePhoto(
    enquiryId: string,
    photoId: string,
  ): Promise<{ status: 'removed' | 'not_found' | 'closed'; path?: string; reason?: string }>
  claimPhotoDeletions(limit: number): Promise<string[]>
  photoDeletionDone(paths: string[]): Promise<void>
  photoDeletionFailed(path: string, error: string): Promise<void>
}

export type PrepareWindow = {
  open: boolean
  reason: 'no_booking' | 'started' | null
  mode: 'phone' | 'on_site' | null
}

export type PrepareState = {
  window: PrepareWindow
  answers: Record<string, string>
  access_notes: string | null
  marketing_opt_in: boolean
  max_photos: number
  /** Stored photos only; `thumb` is base64 JPEG. */
  photos: { id: string; thumb: string; added_at: string }[]
}

export type PhotoReservation =
  | { status: 'reserved' | 'stored'; id: string; path: string }
  | { status: 'limit' }
  | { status: 'forbidden' }
  | { status: 'closed'; reason: string }
