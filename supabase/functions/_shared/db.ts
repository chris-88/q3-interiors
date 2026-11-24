// Postgres access for the Edge Functions (Deno only; not part of the Node typecheck).
// Connects directly with SUPABASE_DB_URL, which the stack provides to the functions container,
// so the functions can call the `private` schema that PostgREST does not expose.
import postgres from 'postgres'
import type { Interval, Reservation } from './slots.ts'
import type {
  AppointmentType,
  Answers,
  BookingContext,
  BookingRow,
  BookingSettings,
  EnquirySummary,
  PendingEventDeletion,
  ChangeResult,
  SyncJob,
  CalendarConnection,
  CalendarJob,
  Communication,
  Db,
  EnquiryRow,
  ReserveResult,
  StaffAvailability,
} from './types.ts'
import type { AccountStore, StaffAccount } from './staff-accounts.ts'

let shared: ReturnType<typeof postgres> | null = null

export function sql() {
  if (!shared) {
    const url = Deno.env.get('SUPABASE_DB_URL')
    if (!url) throw new Error('SUPABASE_DB_URL is not set')
    shared = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 })
  }
  return shared
}

const iso = (t: Date | string) => new Date(t).toISOString()

export function createDb(): Db {
  const q = sql()
  return {
    async resolveToken(token) {
      const [row] = await q`select public.resolve_enquiry_token(${token}) as id`
      return (row?.id as string | null) ?? null
    },
    async getEnquiry(id) {
      const [row] =
        await q`select id, reference, answers, site_details, contact_requested_at from public.enquiries where id = ${id}`
      if (!row) return null
      return {
        id: row.id,
        reference: row.reference,
        answers: row.answers as Answers,
        site_details: (row.site_details as Answers | null) ?? null,
        contact_requested_at: row.contact_requested_at ? iso(row.contact_requested_at) : null,
      } satisfies EnquiryRow
    },
    async listTypes() {
      return (await q`select id, label, description, what_to_prepare, mode, duration_minutes, buffer_before_minutes,
        buffer_after_minutes, requires_site_address, requires_phone, active, sort_order
        from public.appointment_types order by sort_order, id`) as unknown as AppointmentType[]
    },
    async eligibility(enquiryId, typeId) {
      const [row] = await q`select public.enquiry_booking_eligibility(${enquiryId}, ${typeId}) as e`
      return String(row?.e)
    },
    async bookableStaff() {
      const [row] = await q`select public.bookable_staff() as id`
      return (row?.id as string | null) ?? null
    },
    async getAvailability(staffId) {
      const [row] =
        await q`select staff_user_id, working_hours, min_notice_minutes, horizon_days, daily_visit_limit,
        slot_step_minutes from public.staff_availability where staff_user_id = ${staffId}`
      return (row as unknown as StaffAvailability) ?? null
    },
    async getConnection(staffId) {
      const [row] = await q`select staff_user_id, status, google_email, calendar_id
        from public.calendar_connections where staff_user_id = ${staffId}`
      return (row as unknown as CalendarConnection) ?? null
    },
    async getTokenCiphertext(staffId) {
      const [row] =
        await q`select refresh_token_ciphertext from private.calendar_tokens where staff_user_id = ${staffId}`
      return (row?.refresh_token_ciphertext as string | undefined) ?? null
    },
    async liveReservations(staffId, window: Interval, excludeBookingId): Promise<Reservation[]> {
      const rows = await q`
        select extract(epoch from lower(b.blocked)) * 1000 as bs, extract(epoch from upper(b.blocked)) * 1000 as be,
               extract(epoch from b.starts_at) * 1000 as st, t.mode
        from public.bookings b join public.appointment_types t on t.id = b.appointment_type_id
        where b.staff_user_id = ${staffId}
          and b.state in ('reserved', 'calendar_pending', 'confirmed')
          and b.id <> coalesce(${excludeBookingId ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          and b.blocked && tstzrange(${iso(new Date(window.start))}::timestamptz, ${iso(new Date(window.end))}::timestamptz)`
      return rows.map((r) => ({
        blocked: { start: Number(r.bs), end: Number(r.be) },
        start: Number(r.st),
        mode: r.mode as 'phone' | 'on_site',
      }))
    },
    async latestBooking(enquiryId) {
      const [row] =
        await q`select to_jsonb(b) as b from public.bookings b where enquiry_id = ${enquiryId}
        order by created_at desc limit 1`
      return (row?.b as BookingRow | undefined) ?? null
    },
    async bookingByKey(key) {
      const [row] =
        await q`select to_jsonb(b) as b from public.bookings b where idempotency_key = ${key}`
      return (row?.b as BookingRow | undefined) ?? null
    },
    async reserve(enquiryId, typeId, startIso, key) {
      const [row] =
        await q`select private.reserve_booking(${enquiryId}, ${typeId}, ${startIso}::timestamptz, ${key}) as r`
      return row?.r as ReserveResult
    },
    async saveSiteDetails(enquiryId, answers) {
      await q`select private.save_site_details(${enquiryId}, ${q.json(answers)})`
    },
    async requestContact(enquiryId, reason) {
      await q`select private.request_contact(${enquiryId}, ${reason})`
    },
    async bookingContext(bookingId) {
      const [row] = await q`select private.booking_context(${bookingId}) as c`
      return (row?.c as BookingContext | null) ?? null
    },
    async claimCalendarJobs(limit, bookingId) {
      return (
        await q`select id, booking_id, attempts, max_attempts, outcome_unknown
        from private.claim_calendar_jobs(${limit}, ${bookingId ?? null})`
      ).map((r) => ({
        ...(r as unknown as CalendarJob),
        id: Number(r.id),
      }))
    },
    async calendarJobStarted(jobId) {
      await q`select private.calendar_job_started(${jobId})`
    },
    async completeCalendarJob(jobId, link) {
      await q`select private.complete_calendar_job(${jobId}, ${link})`
    },
    async retryCalendarJob(jobId, error, outcomeUnknown, delaySeconds) {
      await q`select private.retry_calendar_job(${jobId}, ${error}, ${outcomeUnknown}, ${delaySeconds})`
    },
    async failCalendarJob(jobId, error, outcomeUnknown) {
      await q`select private.fail_calendar_job(${jobId}, ${error}, ${outcomeUnknown})`
    },
    async claimCommunications(limit, bookingId) {
      return (await q`select id, enquiry_id, staff_user_id, booking_id, template, recipient, dedupe_key, attempts, max_attempts,
        to_jsonb(about_start) #>> '{}' as about_start
        from private.claim_communications(${limit}, ${bookingId ?? null})`) as unknown as Communication[]
    },
    async communicationSent(id, providerId) {
      await q`select private.communication_sent(${id}, ${providerId})`
    },
    async communicationRetry(id, error, delaySeconds, final) {
      await q`select private.communication_retry(${id}, ${error}, ${delaySeconds}, ${final})`
    },
    async markDisconnected(staffId, error) {
      await q`select private.mark_calendar_disconnected(${staffId}, ${error})`
    },
    async recordCalendarError(staffId, error) {
      await q`select private.record_calendar_error(${staffId}, ${error})`
    },
    async getSettings() {
      const [row] = await q`select change_cutoff_minutes, reminder_lead_minutes, business_phone,
        booking_write_limit_per_hour, booking_read_limit_per_hour
        from public.booking_settings limit 1`
      return (
        (row as unknown as BookingSettings) ?? {
          change_cutoff_minutes: 120,
          reminder_lead_minutes: 1440,
          business_phone: null,
        }
      )
    },
    async bookingById(id) {
      const [row] = await q`select to_jsonb(b) as b from public.bookings b where id = ${id}`
      return (row?.b as BookingRow | undefined) ?? null
    },
    async liveBookingFor(enquiryId) {
      const [row] =
        await q`select to_jsonb(b) as b from public.bookings b where enquiry_id = ${enquiryId}
        and state in ('reserved', 'calendar_pending', 'confirmed') limit 1`
      return (row?.b as BookingRow | undefined) ?? null
    },
    async cancelBooking(id, actor, reason, actorUserId) {
      const [row] =
        await q`select private.cancel_booking(${id}, ${actor}, ${reason}, ${actorUserId ?? null}) as r`
      return row?.r as ChangeResult
    },
    async rescheduleBooking(id, startIso, actor, actorUserId) {
      const [row] =
        await q`select private.reschedule_booking(${id}, ${startIso}::timestamptz, ${actor}, ${actorUserId ?? null}) as r`
      return row?.r as ChangeResult
    },
    async claimSyncJobs(limit, bookingId) {
      return (
        await q`select id, booking_id, kind, attempts, max_attempts
        from private.claim_sync_jobs(${limit}, ${bookingId ?? null})`
      ).map((r) => ({
        ...(r as unknown as SyncJob),
        id: Number(r.id),
      }))
    },
    async completeSyncJob(jobId, syncedStartIso, detail) {
      await q`select private.complete_sync_job(${jobId}, ${syncedStartIso}::timestamptz, ${detail})`
    },
    async retrySyncJob(jobId, error, delaySeconds) {
      await q`select private.retry_sync_job(${jobId}, ${error}, ${delaySeconds})`
    },
    async failSyncJob(jobId, error) {
      await q`select private.fail_sync_job(${jobId}, ${error})`
    },
    async bookingsToReconcile(limit) {
      return (await q`select to_jsonb(b) as b from private.bookings_to_reconcile(${limit}) b`).map(
        (r) => r.b as BookingRow,
      )
    },
    async recordReconcile(bookingId, mismatch) {
      await q`select private.record_reconcile(${bookingId}, ${mismatch})`
    },
    async scheduleReminder(bookingId, plannedAtIso) {
      await q`select private.schedule_reminder(${bookingId}, ${plannedAtIso}::timestamptz)`
    },
    async communicationSkipped(id, reason) {
      await q`select private.communication_skipped(${id}, ${reason})`
    },
    async rateLimitTake(bucket, addrHash, idemKey, limit) {
      const [row] =
        await q`select private.rate_limit_take(${bucket}, ${addrHash}, ${idemKey}, ${limit}) as ok`
      return Boolean(row?.ok)
    },
    async enquirySummary(enquiryId) {
      const [row] = await q`select e.id, e.reference, e.answers, e.contact_request_reason, f.schema
        from public.enquiries e
        left join public.form_versions f on f.form_id = e.form_id and f.version = e.form_version
        where e.id = ${enquiryId}`
      return (row as unknown as EnquirySummary) ?? null
    },
    async claimEventDeletions(limit) {
      return (await q`select calendar_event_id, staff_user_id, attempts
        from private.claim_event_deletions(${limit})`) as unknown as PendingEventDeletion[]
    },
    async eventDeletionDone(eventId) {
      await q`select private.event_deletion_done(${eventId})`
    },
    async eventDeletionFailed(eventId, error) {
      await q`select private.event_deletion_failed(${eventId}, ${error})`
    },
    async mintAccessToken(enquiryId) {
      const [row] = await q`select private.mint_enquiry_token(${enquiryId}) ->> 'access_token' as t`
      return String(row?.t)
    },
  }
}

/** Staff-side calendar connection writes (OAuth). */
export const oauthStore = {
  async createState(stateHash: string, staffId: string, verifier: string) {
    const q = sql()
    await q`delete from private.oauth_states where expires_at < now()`
    await q`insert into private.oauth_states (state_hash, staff_user_id, code_verifier, expires_at)
      values (${stateHash}, ${staffId}, ${verifier}, now() + interval '10 minutes')`
  },
  /** Single use: the state row is deleted as it is read. */
  async takeState(stateHash: string): Promise<{ staffId: string; verifier: string } | null> {
    const [row] =
      await sql()`delete from private.oauth_states where state_hash = ${stateHash} and expires_at > now()
      returning staff_user_id, code_verifier`
    return row
      ? { staffId: row.staff_user_id as string, verifier: row.code_verifier as string }
      : null
  },
  async store(staffId: string, email: string | null, scopes: string, ciphertext: string) {
    await sql()`select private.store_calendar_connection(${staffId}, ${email}, ${scopes}, ${ciphertext})`
  },
  async remove(staffId: string) {
    await sql()`select private.remove_calendar_connection(${staffId})`
  },
  /** Active staff only: a deactivated person is refused at their next request. */
  async isStaff(userId: string): Promise<boolean> {
    const [row] = await sql()`select 1 as ok from public.staff where user_id = ${userId} and active`
    return Boolean(row)
  },
}

/** Staff account administration (the staff-accounts function and the worker). */
export const accountStore: AccountStore = {
  async staffMember(userId) {
    const [row] = await sql()`select user_id, email, display_name, role, active
      from public.staff where user_id = ${userId}`
    return (row as unknown as StaffAccount | undefined) ?? null
  },
  async authUserIdByEmail(email) {
    const [row] = await sql()`select id from auth.users where lower(email) = ${email.toLowerCase()}`
    return (row?.id as string | undefined) ?? null
  },
  async addStaff(userId, email, name, role) {
    await sql()`select private.add_staff(${userId}, ${email}, ${name}, ${role})`
  },
  async setActive(userId, active) {
    await sql()`select private.set_staff_active(${userId}, ${active})`
  },
  async setRole(userId, role) {
    await sql()`select private.set_staff_role(${userId}, ${role})`
  },
  async queueAccountEmail(userId, template, requestId) {
    await sql()`select private.queue_staff_account_email(${userId}, ${template}, ${requestId})`
  },
  async activeStaffByEmail(email) {
    const [row] = await sql()`select private.active_staff_by_email(${email}) as id`
    return (row?.id as string | null | undefined) ?? null
  },
  async rateLimitTake(addrHash, limit) {
    const [row] =
      await sql()`select private.rate_limit_take('password_reset', ${addrHash}, ${null}, ${limit}) as ok`
    return Boolean(row?.ok)
  },
  async kickWorker() {
    await sql()`select private.kick_worker()`
  },
}
