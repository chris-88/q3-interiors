// In-memory fakes of Postgres (the `Db` interface) and Google Calendar, for unit tests and the
// Playwright journey. The fake Db mirrors the SQL rules that matter to callers: idempotency keys,
// the overlap exclusion over buffered ranges, one live booking per enquiry, the daily visit
// limit, the job and message state machines, and the email dedupe key.
import {
  GoogleError,
  type CalendarApi,
  type CalendarEvent,
  type CalendarEventInput,
} from '../google.ts'
import type { Interval, Reservation } from '../slots.ts'
import { toLocal } from '../time.ts'
import type {
  AppointmentType,
  Answers,
  BookingRow,
  BookingSettings,
  ChangeResult,
  SyncJob,
  CalendarConnection,
  CalendarJob,
  Communication,
  Db,
  EnquiryRow,
  ReserveResult,
  StaffAvailability,
} from '../types.ts'

const LIVE = new Set(['reserved', 'calendar_pending', 'confirmed'])
const MIN = 60_000

export const STAFF_ID = '00000000-0000-4000-8000-00000000aaaa'

export const defaultTypes = (): AppointmentType[] => [
  {
    id: 'phone_consultation',
    label: 'Phone consultation',
    description: 'A call to talk through your project.',
    what_to_prepare: 'Have a rough idea of the rooms involved.',
    mode: 'phone',
    duration_minutes: 20,
    buffer_before_minutes: 0,
    buffer_after_minutes: 10,
    requires_site_address: false,
    requires_phone: true,
    active: true,
    sort_order: 1,
  },
  {
    id: 'site_visit',
    label: 'Site visit',
    description: 'We visit to see the space and give you an estimated range.',
    what_to_prepare: 'Make sure we can get into the rooms involved.',
    mode: 'on_site',
    duration_minutes: 60,
    buffer_before_minutes: 30,
    buffer_after_minutes: 30,
    requires_site_address: true,
    requires_phone: true,
    active: true,
    sort_order: 2,
  },
]

type Job = CalendarJob & {
  kind: 'create_calendar_event' | 'update_calendar_event' | 'delete_calendar_event'
  state: string
  next_attempt_at: number
  last_error: string | null
}
type Comm = Communication & {
  state: string
  next_attempt_at: number
  provider_message_id: string | null
  last_error: string | null
}

export class FakeDb implements Db {
  now: () => number
  tokens = new Map<string, { enquiryId: string; expiresAt: number }>()
  enquiries = new Map<string, EnquiryRow>()
  types = defaultTypes()
  availabilityRow: StaffAvailability = {
    staff_user_id: STAFF_ID,
    working_hours: Object.fromEntries(
      ['1', '2', '3', '4', '5'].map((d) => [d, [['09:00', '17:00']]]),
    ),
    min_notice_minutes: 24 * 60,
    horizon_days: 21,
    daily_visit_limit: 3,
    slot_step_minutes: 30,
  }
  connection: CalendarConnection | null = {
    staff_user_id: STAFF_ID,
    status: 'connected',
    google_email: 'calendar@example.com',
    calendar_id: 'primary',
  }
  tokenCiphertext: string | null = 'ciphertext'
  settings: BookingSettings = {
    change_cutoff_minutes: 120,
    reminder_lead_minutes: 1440,
    business_phone: null,
  }
  mismatches = new Map<string, string | null>()
  mintedTokens = 0
  bookings: (BookingRow & {
    blocked: Interval
    failure_reason: string | null
    link: string | null
  })[] = []
  jobs: Job[] = []
  comms: Comm[] = []
  events: { enquiryId: string; kind: string; detail?: string }[] = []
  calendarErrors: string[] = []
  private seq = 0

  constructor(now: () => number) {
    this.now = now
  }

  addEnquiry(
    answers: Answers,
    token: string,
    opts: { siteDetails?: Answers; expiresAt?: number } = {},
  ): string {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`
    this.enquiries.set(id, {
      id,
      reference: `Q3-TEST${String(this.seq).padStart(2, '0')}`,
      answers,
      site_details: opts.siteDetails ?? null,
      contact_requested_at: null,
    })
    this.tokens.set(token, {
      enquiryId: id,
      expiresAt: opts.expiresAt ?? this.now() + 30 * 24 * 60 * MIN,
    })
    return id
  }

  async resolveToken(token: string) {
    const t = this.tokens.get(token)
    return t && t.expiresAt > this.now() ? t.enquiryId : null
  }
  async getEnquiry(id: string) {
    return this.enquiries.get(id) ?? null
  }
  async listTypes() {
    return this.types
  }
  async eligibility(enquiryId: string, typeId: string) {
    const t = this.types.find((x) => x.id === typeId && x.active)
    const e = this.enquiries.get(enquiryId)
    if (!t) return 'unknown_type'
    if (!e) return 'unknown_enquiry'
    if (t.requires_phone && !e.answers.phone) return 'phone_required'
    if (t.requires_site_address && !e.site_details?.site_address) return 'site_address_required'
    return 'eligible'
  }
  async bookableStaff() {
    return STAFF_ID
  }
  async getAvailability() {
    return this.availabilityRow
  }
  async getConnection() {
    return this.connection
  }
  async getTokenCiphertext() {
    return this.tokenCiphertext
  }
  async liveReservations(
    _staff: string,
    window: Interval,
    excludeBookingId?: string,
  ): Promise<Reservation[]> {
    return this.bookings
      .filter(
        (b) =>
          b.id !== excludeBookingId &&
          LIVE.has(b.state) &&
          b.blocked.start < window.end &&
          window.start < b.blocked.end,
      )
      .map((b) => ({
        blocked: b.blocked,
        start: Date.parse(b.starts_at),
        mode: this.types.find((t) => t.id === b.appointment_type_id)?.mode ?? 'phone',
      }))
  }
  async latestBooking(enquiryId: string) {
    return [...this.bookings].reverse().find((b) => b.enquiry_id === enquiryId) ?? null
  }
  async bookingByKey(key: string) {
    return this.bookings.find((b) => b.idempotency_key === key) ?? null
  }

  async reserve(
    enquiryId: string,
    typeId: string,
    startIso: string,
    key: string,
  ): Promise<ReserveResult> {
    const existing = this.bookings.find((b) => b.idempotency_key === key)
    if (existing) return { status: 'existing', booking_id: existing.id }
    const eligibility = await this.eligibility(enquiryId, typeId)
    if (eligibility !== 'eligible') return { status: 'ineligible', reason: eligibility }
    const type = this.types.find((t) => t.id === typeId)!
    const start = Date.parse(startIso)
    if (start < this.now() + this.availabilityRow.min_notice_minutes * MIN)
      return { status: 'slot_unavailable', reason: 'notice' }
    const end = start + type.duration_minutes * MIN
    const blocked = {
      start: start - type.buffer_before_minutes * MIN,
      end: end + type.buffer_after_minutes * MIN,
    }
    const live = this.bookings.filter((b) => LIVE.has(b.state))
    if (type.mode === 'on_site') {
      const day = toLocal(start).date
      const count = live.filter(
        (b) =>
          this.types.find((t) => t.id === b.appointment_type_id)?.mode === 'on_site' &&
          toLocal(Date.parse(b.starts_at)).date === day,
      ).length
      if (count >= this.availabilityRow.daily_visit_limit)
        return { status: 'slot_unavailable', reason: 'daily_limit' }
    }
    if (live.some((b) => b.blocked.start < blocked.end && blocked.start < b.blocked.end)) {
      return { status: 'slot_unavailable', reason: 'taken' }
    }
    const mine = live.find((b) => b.enquiry_id === enquiryId)
    if (mine) return { status: 'already_booked', booking_id: mine.id }
    const id = `b${String(++this.seq).padStart(8, '0')}-0000-4000-8000-000000000000`
    this.bookings.push({
      id,
      enquiry_id: enquiryId,
      staff_user_id: STAFF_ID,
      appointment_type_id: typeId,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      state: 'reserved',
      calendar_event_id: `q3${id.replace(/-/g, '')}`.replace(/[^a-v0-9]/g, '0'),
      created_at: new Date(this.now()).toISOString(),
      idempotency_key: key,
      blocked,
      failure_reason: null,
      link: null,
    })
    this.jobs.push({
      id: this.jobs.length + 1,
      kind: 'create_calendar_event',
      booking_id: id,
      attempts: 0,
      max_attempts: 8,
      outcome_unknown: false,
      state: 'queued',
      next_attempt_at: 0,
      last_error: null,
    })
    this.events.push({ enquiryId, kind: 'booking_requested' })
    return { status: 'reserved', booking_id: id }
  }

  async saveSiteDetails(enquiryId: string, answers: Answers) {
    const address = answers.site_address
    if (typeof address !== 'string' || address.trim().length < 8)
      throw Object.assign(new Error('invalid'), { code: '22023' })
    const e = this.enquiries.get(enquiryId)!
    e.site_details = answers
    this.events.push({ enquiryId, kind: 'site_details_added' })
  }
  async requestContact(enquiryId: string, reason: string) {
    this.enquiries.get(enquiryId)!.contact_requested_at = new Date(this.now()).toISOString()
    this.events.push({ enquiryId, kind: 'contact_requested', detail: reason })
    this.queueStaffAlert(enquiryId, 'staff_callback_request')
  }
  async bookingContext(bookingId: string) {
    const b = this.bookings.find((x) => x.id === bookingId)
    if (!b) return null
    const e = this.enquiries.get(b.enquiry_id)!
    return {
      booking: b,
      type: this.types.find((t) => t.id === b.appointment_type_id)!,
      enquiry: {
        id: e.id,
        reference: e.reference,
        answers: e.answers,
        site_details: e.site_details,
      },
      staff: { user_id: STAFF_ID, display_name: 'Pat Quinn' },
      connection: this.connection,
    }
  }

  async claimCalendarJobs(limit: number, bookingId?: string) {
    const due = this.jobs
      .filter(
        (j) =>
          j.kind === 'create_calendar_event' &&
          (!bookingId || j.booking_id === bookingId) &&
          j.state === 'queued' &&
          j.next_attempt_at <= this.now(),
      )
      .slice(0, limit)
    for (const j of due) {
      j.state = 'running'
      j.attempts += 1
    }
    return due.map((j) => ({ ...j }))
  }
  private booking(jobId: number) {
    const job = this.jobs.find((j) => j.id === jobId)!
    return { job, booking: this.bookings.find((b) => b.id === job.booking_id)! }
  }
  async calendarJobStarted(jobId: number) {
    const { booking } = this.booking(jobId)
    if (booking.state === 'reserved') booking.state = 'calendar_pending'
  }
  async completeCalendarJob(jobId: number, link: string | null) {
    const { job, booking } = this.booking(jobId)
    // Mirrors private.complete_calendar_job: only create jobs complete here.
    if (job.kind !== 'create_calendar_event') throw new Error(`job ${jobId} is not a create job`)
    if (job.state === 'succeeded') return
    job.state = 'succeeded'
    if (booking.state === 'cancelled') {
      this.enqueue('delete_calendar_event', booking.id)
      return
    }
    booking.state = 'confirmed'
    booking.confirmed_at = new Date(this.now()).toISOString()
    booking.link = link
    this.events.push({ enquiryId: booking.enquiry_id, kind: 'booking_confirmed' })
    const email = this.enquiries.get(booking.enquiry_id)!.answers.email
    const key = `booking_confirmation:${booking.id}`
    if (typeof email === 'string' && !this.comms.some((c) => c.dedupe_key === key)) {
      this.comms.push({
        id: `c${this.comms.length + 1}`,
        enquiry_id: booking.enquiry_id,
        booking_id: booking.id,
        template: 'booking_confirmation',
        recipient: email,
        dedupe_key: key,
        attempts: 0,
        max_attempts: 6,
        state: 'queued',
        next_attempt_at: 0,
        provider_message_id: null,
        last_error: null,
      })
    }
  }
  async retryCalendarJob(
    jobId: number,
    error: string,
    outcomeUnknown: boolean,
    delaySeconds: number,
  ) {
    const { job, booking } = this.booking(jobId)
    job.state = 'queued'
    job.last_error = error
    job.outcome_unknown ||= outcomeUnknown
    job.next_attempt_at = this.now() + delaySeconds * 1000
    if (booking.state === 'reserved') booking.state = 'calendar_pending'
    this.events.push({ enquiryId: booking.enquiry_id, kind: 'booking_retrying', detail: error })
  }
  async failCalendarJob(jobId: number, error: string, outcomeUnknown: boolean) {
    const { job, booking } = this.booking(jobId)
    job.state = 'failed'
    job.last_error = error
    job.outcome_unknown ||= outcomeUnknown
    if (booking.state === 'reserved' || booking.state === 'calendar_pending') {
      booking.state = 'failed'
      booking.failure_reason = error
    }
    this.events.push({ enquiryId: booking.enquiry_id, kind: 'booking_failed', detail: error })
  }
  async claimCommunications(limit: number, bookingId?: string) {
    const due = this.comms
      .filter(
        (c) =>
          (!bookingId || c.booking_id === bookingId) &&
          c.state === 'queued' &&
          c.next_attempt_at <= this.now(),
      )
      .slice(0, limit)
    for (const c of due) {
      c.state = 'sending'
      c.attempts += 1
    }
    return due.map((c) => ({ ...c }))
  }
  async communicationSent(id: string, providerId: string | null) {
    const c = this.comms.find((x) => x.id === id)!
    if (c.state === 'sent') return
    c.state = 'sent'
    c.provider_message_id = providerId
    this.events.push({ enquiryId: c.enquiry_id, kind: 'email_sent' })
  }
  async communicationRetry(id: string, error: string, delaySeconds: number, final: boolean) {
    const c = this.comms.find((x) => x.id === id)!
    c.state = final ? 'failed' : 'queued'
    c.last_error = error
    c.next_attempt_at = this.now() + delaySeconds * 1000
    if (final) this.events.push({ enquiryId: c.enquiry_id, kind: 'email_failed', detail: error })
  }
  async markDisconnected(_staff: string, error: string) {
    if (this.connection) this.connection = { ...this.connection, status: 'disconnected' }
    this.calendarErrors.push(error)
  }
  async recordCalendarError(_staff: string, error: string) {
    this.calendarErrors.push(error)
  }

  // Slice 3 -----------------------------------------------------------------------------------
  private enqueue(kind: Job['kind'], bookingId: string) {
    const open = this.jobs.find(
      (j) =>
        j.kind === kind &&
        j.booking_id === bookingId &&
        (j.state === 'queued' || j.state === 'running'),
    )
    if (open) {
      if (open.state === 'queued') open.next_attempt_at = 0
      return
    }
    this.jobs.push({
      id: this.jobs.length + 1,
      kind,
      booking_id: bookingId,
      attempts: 0,
      max_attempts: 8,
      outcome_unknown: false,
      state: 'queued',
      next_attempt_at: 0,
      last_error: null,
    })
  }
  private queueMessage(
    booking: { id: string; enquiry_id: string },
    template: Communication['template'],
    key: string,
    aboutStart: string | null,
    at = 0,
  ) {
    const email = this.enquiries.get(booking.enquiry_id)?.answers.email
    if (typeof email !== 'string' || this.comms.some((c) => c.dedupe_key === key)) return
    this.comms.push({
      id: `c${this.comms.length + 1}`,
      enquiry_id: booking.enquiry_id,
      booking_id: booking.id,
      template,
      recipient: email,
      dedupe_key: key,
      about_start: aboutStart,
      attempts: 0,
      max_attempts: 6,
      state: 'queued',
      next_attempt_at: at,
      provider_message_id: null,
      last_error: null,
    })
  }
  private skipReminders(bookingId: string, reason: string) {
    for (const c of this.comms) {
      if (c.booking_id === bookingId && c.template === 'booking_reminder' && c.state === 'queued') {
        c.state = 'skipped'
        c.last_error = reason
      }
    }
  }
  async getSettings() {
    return this.settings
  }
  async bookingById(id: string) {
    return this.bookings.find((b) => b.id === id) ?? null
  }
  async liveBookingFor(enquiryId: string) {
    return this.bookings.find((b) => b.enquiry_id === enquiryId && LIVE.has(b.state)) ?? null
  }
  async cancelBooking(
    id: string,
    actor: 'customer' | 'staff',
    reason: string | null,
  ): Promise<ChangeResult> {
    const b = this.bookings.find((x) => x.id === id)!
    if (b.state === 'cancelled') return { status: 'cancelled', changed: false }
    if (b.state === 'failed') return { status: 'not_live' }
    b.state = 'cancelled'
    b.cancelled_at = new Date(this.now()).toISOString()
    this.enqueue('delete_calendar_event', id)
    this.skipReminders(id, 'Booking cancelled')
    this.queueMessage(b, 'booking_cancelled', `booking_cancelled:${id}`, b.starts_at)
    this.events.push({
      enquiryId: b.enquiry_id,
      kind: 'booking_cancelled',
      detail: `${actor}: ${reason ?? ''}`,
    })
    return { status: 'cancelled', changed: true }
  }
  async rescheduleBooking(
    id: string,
    startIso: string,
    actor: 'customer' | 'staff',
  ): Promise<ChangeResult> {
    const b = this.bookings.find((x) => x.id === id)!
    if (!LIVE.has(b.state)) return { status: 'not_live' }
    const start = Date.parse(startIso)
    if (start === Date.parse(b.starts_at)) return { status: 'rescheduled', changed: false }
    if (start < this.now() + this.availabilityRow.min_notice_minutes * MIN) {
      return { status: 'slot_unavailable', reason: 'notice' }
    }
    const type = this.types.find((t) => t.id === b.appointment_type_id)!
    const end = start + type.duration_minutes * MIN
    const blocked = {
      start: start - type.buffer_before_minutes * MIN,
      end: end + type.buffer_after_minutes * MIN,
    }
    if (
      this.bookings.some(
        (o) =>
          o.id !== id &&
          LIVE.has(o.state) &&
          o.blocked.start < blocked.end &&
          blocked.start < o.blocked.end,
      )
    ) {
      return { status: 'slot_unavailable', reason: 'taken' }
    }
    b.starts_at = new Date(start).toISOString()
    b.ends_at = new Date(end).toISOString()
    b.blocked = blocked
    this.enqueue('update_calendar_event', id)
    this.skipReminders(id, 'Booking moved')
    this.queueMessage(
      b,
      'booking_rescheduled',
      `booking_rescheduled:${id}:${start / 1000}`,
      b.starts_at,
    )
    this.events.push({ enquiryId: b.enquiry_id, kind: 'booking_rescheduled', detail: actor })
    return { status: 'rescheduled', changed: true }
  }
  async claimSyncJobs(limit: number, bookingId?: string): Promise<SyncJob[]> {
    const due = this.jobs
      .filter(
        (j) =>
          j.kind !== 'create_calendar_event' &&
          (!bookingId || j.booking_id === bookingId) &&
          j.state === 'queued' &&
          j.next_attempt_at <= this.now(),
      )
      .slice(0, limit)
    for (const j of due) {
      j.state = 'running'
      j.attempts += 1
    }
    return due.map((j) => ({ ...j }) as SyncJob)
  }
  async completeSyncJob(jobId: number, syncedStartIso: string | null, detail: string) {
    const { job, booking } = this.booking(jobId)
    if (
      job.kind === 'update_calendar_event' &&
      syncedStartIso &&
      Date.parse(syncedStartIso) !== Date.parse(booking.starts_at)
    ) {
      job.state = 'queued'
      job.next_attempt_at = 0
      return
    }
    job.state = 'succeeded'
    if (job.kind === 'update_calendar_event') {
      this.mismatches.set(booking.id, null)
      this.events.push({ enquiryId: booking.enquiry_id, kind: 'calendar_updated', detail })
    }
  }
  async retrySyncJob(jobId: number, error: string, delaySeconds: number) {
    const { job } = this.booking(jobId)
    job.state = 'queued'
    job.last_error = error
    job.next_attempt_at = this.now() + delaySeconds * 1000
  }
  async failSyncJob(jobId: number, error: string) {
    const { job, booking } = this.booking(jobId)
    job.state = 'failed'
    job.last_error = error
    if (job.kind === 'update_calendar_event')
      this.mismatches.set(booking.id, `Could not move the Google Calendar event: ${error}`)
    this.events.push({
      enquiryId: booking.enquiry_id,
      kind: 'calendar_update_failed',
      detail: error,
    })
  }
  async bookingsToReconcile(limit: number) {
    return this.bookings
      .filter(
        (b) =>
          b.state === 'confirmed' &&
          Date.parse(b.ends_at) > this.now() &&
          !this.jobs.some(
            (j) => j.booking_id === b.id && (j.state === 'queued' || j.state === 'running'),
          ),
      )
      .slice(0, limit)
  }
  async recordReconcile(bookingId: string, mismatch: string | null) {
    this.mismatches.set(bookingId, mismatch)
  }
  async scheduleReminder(bookingId: string, plannedAtIso: string) {
    const b = this.bookings.find((x) => x.id === bookingId)!
    if (b.state !== 'confirmed') return
    this.queueMessage(
      b,
      'booking_reminder',
      `booking_reminder:${b.id}:${Date.parse(b.starts_at) / 1000}`,
      b.starts_at,
      Date.parse(plannedAtIso),
    )
  }
  async communicationSkipped(id: string, reason: string) {
    const c = this.comms.find((x) => x.id === id)!
    if (c.state === 'sent') return
    c.state = 'skipped'
    c.last_error = reason
  }
  // Slice 4 -----------------------------------------------------------------------------------
  limiterHits: { bucket: string; hash: string; key: string | null; at: number }[] = []
  pendingDeletions: { calendar_event_id: string; staff_user_id: string; attempts: number }[] = []
  async rateLimitTake(bucket: string, hash: string, key: string | null, limit: number) {
    if (
      key !== null &&
      this.limiterHits.some((h) => h.bucket === bucket && h.hash === hash && h.key === key)
    ) {
      return true
    }
    const recent = this.limiterHits.filter(
      (h) => h.bucket === bucket && h.hash === hash && h.at > this.now() - 3_600_000,
    ).length
    if (recent >= limit) return false
    this.limiterHits.push({ bucket, hash, key, at: this.now() })
    return true
  }
  async enquirySummary(enquiryId: string) {
    const e = this.enquiries.get(enquiryId)
    if (!e) return null
    return {
      id: e.id,
      reference: e.reference,
      answers: e.answers,
      contact_request_reason: null,
      schema: {
        steps: [
          { fields: [{ id: 'project_type', options: [{ value: 'kitchen', label: 'Kitchen' }] }] },
        ],
      },
    }
  }
  async claimEventDeletions(limit: number) {
    const due = this.pendingDeletions.slice(0, limit)
    for (const d of due) d.attempts += 1
    return due.map((d) => ({ ...d }))
  }
  async eventDeletionDone(eventId: string) {
    this.pendingDeletions = this.pendingDeletions.filter((d) => d.calendar_event_id !== eventId)
  }
  async eventDeletionFailed() {}
  queueStaffAlert(enquiryId: string, template: 'staff_new_enquiry' | 'staff_callback_request') {
    const key = `${template}:${enquiryId}:${STAFF_ID}`
    if (this.comms.some((c) => c.dedupe_key === key)) return
    this.comms.push({
      id: `c${this.comms.length + 1}`,
      enquiry_id: enquiryId,
      booking_id: null,
      template,
      recipient: 'staff@q3-test-staff.ie',
      dedupe_key: key,
      attempts: 0,
      max_attempts: 6,
      state: 'queued',
      next_attempt_at: 0,
      provider_message_id: null,
      last_error: null,
    })
  }
  async mintAccessToken(enquiryId: string) {
    const token = `minted-${++this.mintedTokens}-0123456789abcdefghij`
    this.tokens.set(token, { enquiryId, expiresAt: this.now() + 30 * 24 * 60 * MIN })
    return token
  }
}

export type FakeCalendarScript = {
  /** Throw this from freeBusy. */
  freeBusyError?: GoogleError
  /** Throw this from the next insert, after (createAnyway) or without creating the event. */
  insertError?: { error: GoogleError; createAnyway: boolean; times?: number }
  /** Throw this from every move (events.patch). */
  moveError?: GoogleError
  refreshError?: GoogleError
}

/** A fake Google Calendar: free/busy from `busy` plus its own events, idempotent ids (409). */
export class FakeCalendar implements CalendarApi {
  busy: Interval[] = []
  events = new Map<string, CalendarEventInput & { status: string }>()
  insertCalls = 0
  script: FakeCalendarScript = {}

  async freeBusy(_token: string, _calendarId: string, window: Interval) {
    if (this.script.freeBusyError) throw this.script.freeBusyError
    const own = [...this.events.values()]
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({ start: Date.parse(e.start), end: Date.parse(e.end) }))
    return [...this.busy, ...own].filter((b) => b.start < window.end && window.start < b.end)
  }
  async getEvent(
    _token: string,
    _calendarId: string,
    eventId: string,
  ): Promise<CalendarEvent | null> {
    const e = this.events.get(eventId)
    return e ? this.view(eventId, e) : null
  }
  async insertEvent(
    _token: string,
    _calendarId: string,
    event: CalendarEventInput,
  ): Promise<CalendarEvent> {
    this.insertCalls += 1
    const scripted = this.script.insertError
    if (scripted && (scripted.times ?? 1) > 0) {
      scripted.times = (scripted.times ?? 1) - 1
      if (scripted.createAnyway) this.events.set(event.id, { ...event, status: 'confirmed' })
      throw scripted.error
    }
    if (this.events.has(event.id))
      throw new GoogleError('conflict', 'The requested identifier already exists.', 409)
    this.events.set(event.id, { ...event, status: 'confirmed' })
    return this.view(event.id, { ...event, status: 'confirmed' })
  }
  async refreshAccessToken() {
    if (this.script.refreshError) throw this.script.refreshError
    return 'access-token'
  }
  async exchangeCode() {
    return { accessToken: 'a', refreshToken: 'r', scope: '', email: 'calendar@example.com' }
  }
  async revoke() {}
  moveCalls = 0
  deleteCalls = 0
  private view(id: string, e: CalendarEventInput & { status: string }): CalendarEvent {
    return {
      id,
      htmlLink: `https://calendar.example/${id}`,
      status: e.status,
      start: Date.parse(e.start),
      end: Date.parse(e.end),
    }
  }
  async moveEvent(
    _token: string,
    _calendarId: string,
    eventId: string,
    when: { start: string; end: string; timeZone: string },
  ) {
    this.moveCalls += 1
    if (this.script.moveError) throw this.script.moveError
    const e = this.events.get(eventId)
    if (!e) throw new GoogleError('not_found', 'Not Found', 404)
    const moved = { ...e, start: when.start, end: when.end }
    this.events.set(eventId, moved)
    return this.view(eventId, moved)
  }
  /** Like Google: a deleted event stays readable with status "cancelled". */
  async deleteEvent(_token: string, _calendarId: string, eventId: string) {
    this.deleteCalls += 1
    const e = this.events.get(eventId)
    if (e) this.events.set(eventId, { ...e, status: 'cancelled' })
  }
}
