import { z } from 'zod'
import type { AccessTokenProvider } from './calendar-job.ts'
import { availabilityForMove, cancel, isLive, reschedule, runDueFor } from './changes.ts'
import { firstName, type Mailer } from './email.ts'
import { bucketFor, type Limiter } from './limits.ts'
import { customerCanChange } from './rules.ts'
import { GoogleError, type CalendarApi } from './google.ts'
import { availabilityWindow, generateSlots, type Slot, type SlotType } from './slots.ts'
import { BUSINESS_TZ } from './time.ts'
import { PHOTO_MAX_BYTES, THUMB_MAX_BYTES, decodeBase64, inspectJpeg } from './jpeg.ts'
import { quotePageText } from './quote-page.ts'
import type { PhotoStore } from './storage.ts'
import type { AppointmentType, Db } from './types.ts'

export type PublicDeps = {
  db: Db
  /** Null when Google credentials are not configured: booking is unavailable, contact-me works. */
  calendar: CalendarApi | null
  accessToken: AccessTokenProvider
  mailer: Mailer | null
  appUrl: string
  now: () => number
  /** Per-address limit for this request; absent in tests that do not exercise it. */
  limit?: Limiter
  /** The private photo bucket; null when the service key is not configured (photos refused). */
  photos?: PhotoStore | null
}

export type PublicResult = { status: number; body: unknown }

const token = z.string().min(20).max(200)
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('context'), token }),
  z.object({ action: z.literal('availability'), token, typeId: z.string().max(64) }),
  z.object({
    action: z.literal('site_details'),
    token,
    answers: z.record(z.string().max(64), z.string().max(1000)),
  }),
  z.object({
    action: z.literal('book'),
    token,
    typeId: z.string().max(64),
    start: z.iso.datetime(),
    idempotencyKey: z.uuid(),
  }),
  z.object({
    action: z.literal('update_details'),
    token,
    // The time screen's editable line, and a change between call and visit after the save.
    details: z
      .object({
        phone: z.string().max(30).optional(),
        appointment_preference: z.enum(['phone', 'on_site']).optional(),
        site_street: z.string().max(150).optional(),
        site_unit: z.string().max(60).optional(),
      })
      .strict()
      .refine((d) => Object.keys(d).length > 0),
  }),
  // "Help us prepare" after booking (form v2 part B).
  z.object({ action: z.literal('prepare'), token }),
  z.object({
    action: z.literal('save_prepare'),
    token,
    details: z
      .object({
        budget: z.string().max(40).optional(),
        timing: z.string().max(40).optional(),
        access_notes: z.string().max(500).optional(),
        marketing_opt_in: z.boolean().optional(),
      })
      .strict()
      .refine((d) => Object.keys(d).length > 0),
  }),
  z.object({
    action: z.literal('add_photo'),
    token,
    key: z.uuid(),
    // Base64 of the JPEG (at most 2 MiB) and of its thumbnail (at most 40 kB).
    photo: z.string().max(Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4),
    thumb: z.string().max(Math.ceil((THUMB_MAX_BYTES * 4) / 3) + 4),
  }),
  z.object({ action: z.literal('remove_photo'), token, photoId: z.uuid() }),
  z.object({ action: z.literal('status'), token }),
  z.object({ action: z.literal('request_contact'), token, reason: z.string().max(200).optional() }),
  z.object({ action: z.literal('cancel'), token, reason: z.string().max(300).optional() }),
  z.object({ action: z.literal('move_options'), token }),
  z.object({ action: z.literal('reschedule'), token, start: z.iso.datetime() }),
  // The estimate email's "Get my quote": the page reads the estimate, then a button posts the yes
  // (a mail scanner opening the link records nothing).
  z.object({ action: z.literal('estimate'), token, estimateId: z.uuid() }),
  z.object({ action: z.literal('request_quote'), token, estimateId: z.uuid() }),
])

export type PublicRequest = z.infer<typeof requestSchema>

export type BookingSummary = {
  id: string
  state: string
  type: { id: string; label: string; mode: 'phone' | 'on_site'; durationMinutes: number }
  start: string
  end: string
  timezone: string
  staffFirstName: string
  phone: string | null
  address: string | null
  whatToPrepare: string
  /** False inside the change cut-off: the customer is asked to ring instead. */
  canChange: boolean
  businessPhone: string | null
}

type Availability =
  | { status: 'ok'; slots: Slot[]; timezone: string }
  | { status: 'unavailable'; reason: 'calendar_unavailable' | 'calendar_error' | 'no_staff' }

const slotType = (t: AppointmentType): SlotType => ({
  mode: t.mode,
  durationMinutes: t.duration_minutes,
  bufferBeforeMinutes: t.buffer_before_minutes,
  bufferAfterMinutes: t.buffer_after_minutes,
})

const ok = (body: unknown): PublicResult => ({ status: 200, body })

async function summary(
  db: Db,
  bookingId: string,
  now: number = Date.now(),
): Promise<BookingSummary | null> {
  const ctx = await db.bookingContext(bookingId)
  if (!ctx) return null
  const settings = await db.getSettings()
  const phone = ctx.enquiry.answers.phone
  const address = ctx.enquiry.site_details?.site_address
  return {
    id: ctx.booking.id,
    state: ctx.booking.state,
    type: {
      id: ctx.type.id,
      label: ctx.type.label,
      mode: ctx.type.mode,
      durationMinutes: ctx.type.duration_minutes,
    },
    start: new Date(ctx.booking.starts_at).toISOString(),
    end: new Date(ctx.booking.ends_at).toISOString(),
    timezone: BUSINESS_TZ,
    staffFirstName: firstName(ctx.staff.display_name),
    phone: ctx.type.mode === 'phone' && typeof phone === 'string' ? phone : null,
    address: ctx.type.mode === 'on_site' && typeof address === 'string' ? address : null,
    whatToPrepare: ctx.type.what_to_prepare,
    canChange:
      isLive(ctx.booking) &&
      customerCanChange(Date.parse(ctx.booking.starts_at), now, settings.change_cutoff_minutes),
    businessPhone: settings.business_phone,
  }
}

/** Free slots for a type, or a truthful reason there are none we can promise. */
export async function availability(deps: PublicDeps, type: AppointmentType): Promise<Availability> {
  const { db } = deps
  const staff = await db.bookableStaff()
  const rules = staff ? await db.getAvailability(staff) : null
  if (!staff || !rules) return { status: 'unavailable', reason: 'no_staff' }
  const connection = await db.getConnection(staff)
  if (!deps.calendar || !connection || connection.status !== 'connected') {
    return { status: 'unavailable', reason: 'calendar_unavailable' }
  }
  const now = deps.now()
  const st = slotType(type)
  const ruleSet = {
    weeklyHours: rules.working_hours,
    minNoticeMinutes: rules.min_notice_minutes,
    horizonDays: rules.horizon_days,
    dailyVisitLimit: rules.daily_visit_limit,
    slotStepMinutes: rules.slot_step_minutes,
  }
  const window = availabilityWindow(now, ruleSet, st)
  let busy
  try {
    busy = await deps.calendar.freeBusy(
      await deps.accessToken(staff),
      connection.calendar_id,
      window,
    )
  } catch (error) {
    // A failed free/busy query means unavailable, never free.
    const g = error instanceof GoogleError ? error : new GoogleError('transient', String(error))
    if (g.kind !== 'auth') await db.recordCalendarError(staff, `freebusy ${g.kind}: ${g.message}`)
    return {
      status: 'unavailable',
      reason: g.kind === 'auth' ? 'calendar_unavailable' : 'calendar_error',
    }
  }
  const reservations = await db.liveReservations(staff, window)
  return {
    status: 'ok',
    timezone: BUSINESS_TZ,
    slots: generateSlots({ now, type: st, rules: ruleSet, busy, reservations }),
  }
}

function alternativesNear(slots: Slot[], start: string): Slot[] {
  const after = slots.filter((s) => s.start >= start)
  return (after.length > 0 ? after : slots).slice(0, 6)
}

/** Run whatever is due for this booking now (calendar jobs, reminder plan, emails). */
const runInline = (deps: PublicDeps, bookingId: string) => runDueFor(deps, bookingId)

export async function handlePublic(raw: unknown, deps: PublicDeps): Promise<PublicResult> {
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { error: 'bad_request' } }
  const req = parsed.data
  const { db } = deps

  const enquiryId = await db.resolveToken(req.token)
  if (!enquiryId) return { status: 401, body: { error: 'invalid_token' } }
  const enquiry = await db.getEnquiry(enquiryId)
  if (!enquiry) return { status: 401, body: { error: 'invalid_token' } }

  if (deps.limit) {
    const { bucket, idemKey } = bucketFor(req.action, enquiryId, req as Record<string, unknown>)
    if (!(await deps.limit(bucket, idemKey)))
      return { status: 429, body: { error: 'rate_limited' } }
  }

  const findType = async (id: string) => (await db.listTypes()).find((t) => t.id === id && t.active)

  switch (req.action) {
    case 'context': {
      const types = (await db.listTypes()).filter((t) => t.active)
      const latest = await db.latestBooking(enquiryId)
      const staff = await db.bookableStaff()
      const connection = staff ? await db.getConnection(staff) : null
      const { name, phone, location, appointment_preference: preference } = enquiry.answers
      const text = (v: unknown) => (typeof v === 'string' ? v : null)
      return ok({
        reference: enquiry.reference,
        firstName: typeof name === 'string' ? name.split(/\s+/)[0] : null,
        phone: text(phone),
        location: text(location),
        // Form v2 saves the customer's choice from the landing page; v1 enquiries have none.
        preference: preference === 'phone' || preference === 'on_site' ? preference : null,
        siteStreet: text(enquiry.answers.site_street),
        siteUnit: text(enquiry.answers.site_unit),
        siteAddress:
          typeof enquiry.site_details?.site_address === 'string'
            ? enquiry.site_details.site_address
            : null,
        contactRequested: enquiry.contact_requested_at !== null,
        calendarAvailable: Boolean(deps.calendar && connection?.status === 'connected'),
        types: await Promise.all(
          types.map(async (t) => ({
            id: t.id,
            label: t.label,
            description: t.description,
            mode: t.mode,
            durationMinutes: t.duration_minutes,
            requiresSiteAddress: t.requires_site_address,
            eligibility: await db.eligibility(enquiryId, t.id),
          })),
        ),
        booking: latest ? await summary(db, latest.id, deps.now()) : null,
      })
    }

    case 'availability': {
      const type = await findType(req.typeId)
      if (!type) return { status: 400, body: { error: 'unknown_type' } }
      return ok(await availability(deps, type))
    }

    case 'site_details': {
      try {
        await db.saveSiteDetails(enquiryId, req.answers)
      } catch (error) {
        if ((error as { code?: string }).code === '22023')
          return { status: 400, body: { error: 'invalid_answers' } }
        throw error
      }
      return ok({ status: 'saved' })
    }

    case 'update_details': {
      // Only before a booking exists: a live booking's calendar event already carries them.
      if (await db.liveBookingFor(enquiryId))
        return { status: 409, body: { error: 'booking_live' } }
      try {
        await db.updateDetails(enquiryId, req.details)
      } catch (error) {
        if ((error as { code?: string }).code === '22023')
          return { status: 400, body: { error: 'invalid_details' } }
        throw error
      }
      return ok({ status: 'saved' })
    }

    case 'prepare':
      return ok(await db.prepareState(enquiryId))

    case 'save_prepare': {
      let result
      try {
        result = await db.savePrepare(enquiryId, req.details)
      } catch (error) {
        if ((error as { code?: string }).code === '22023')
          return { status: 400, body: { error: 'invalid_details' } }
        throw error
      }
      if (result.status === 'closed')
        return { status: 409, body: { error: 'closed', reason: result.reason ?? null } }
      return ok({ status: 'saved' })
    }

    case 'add_photo': {
      if (!deps.photos) return { status: 503, body: { error: 'photos_unavailable' } }
      // The bytes must be a JPEG; metadata is stripped whatever the browser sent.
      const raw = decodeBase64(req.photo, PHOTO_MAX_BYTES)
      const rawThumb = decodeBase64(req.thumb, THUMB_MAX_BYTES)
      if (!raw || !rawThumb) return { status: 400, body: { error: 'invalid_photo' } }
      const photo = inspectJpeg(raw, PHOTO_MAX_BYTES)
      const thumb = inspectJpeg(rawThumb, THUMB_MAX_BYTES)
      if (!photo.ok || !thumb.ok)
        return {
          status: 400,
          body: { error: 'invalid_photo', reason: photo.ok ? 'thumb' : photo.reason },
        }
      const place = await db.reservePhoto(enquiryId, req.key, {
        bytes: photo.bytes.length,
        width: photo.width,
        height: photo.height,
        thumb: thumb.bytes,
      })
      if (place.status === 'forbidden') return { status: 403, body: { error: 'forbidden' } }
      if (place.status === 'closed')
        return { status: 409, body: { error: 'closed', reason: place.reason } }
      if (place.status === 'limit') return { status: 409, body: { error: 'photo_limit' } }
      if (place.status === 'reserved') {
        try {
          await deps.photos.put(place.path, photo.bytes)
        } catch {
          // The place stays reserved for this key: the browser retries with the same key.
          return { status: 502, body: { error: 'storage' } }
        }
        await db.photoStored(enquiryId, place.id)
      }
      return ok({ status: 'added', id: place.id })
    }

    case 'remove_photo': {
      const result = await db.removePhoto(enquiryId, req.photoId)
      if (result.status === 'closed')
        return { status: 409, body: { error: 'closed', reason: result.reason ?? null } }
      if (result.status === 'removed' && result.path && deps.photos) {
        // Remove the file now; if that fails the worker retries from the queue.
        try {
          await deps.photos.remove([result.path])
          await db.photoDeletionDone([result.path])
        } catch {
          // left in private.pending_photo_deletions
        }
      }
      return ok({ status: result.status === 'removed' ? 'removed' : 'not_found' })
    }

    case 'estimate': {
      const estimate = await db.estimateById(req.estimateId)
      if (!estimate || estimate.enquiry_id !== enquiryId)
        return { status: 404, body: { error: 'not_found' } }
      return ok({
        low: estimate.low_eur,
        high: estimate.high_eur,
        workItems: estimate.work_items ?? [],
        note: estimate.work_looked_at,
        after: estimate.after === 'call' ? 'call' : 'visit',
        sentAt: estimate.sent_at,
        validUntil: estimate.valid_until,
        quoteRequested: estimate.quote_requested_at !== null,
        // The page's staff-editable text (defaults filled in) and the number to ring.
        text: quotePageText(await db.getWording()),
        businessPhone: (await db.getSettings()).business_phone,
      })
    }

    case 'request_quote': {
      const result = await db.requestQuote(enquiryId, req.estimateId)
      if (result === 'not_found') return { status: 404, body: { error: 'not_found' } }
      return ok({ status: 'requested' })
    }

    case 'request_contact': {
      await db.requestContact(enquiryId, req.reason ?? 'Customer asked to be contacted')
      return ok({ status: 'requested' })
    }

    case 'status': {
      const latest = await db.latestBooking(enquiryId)
      if (!latest) return ok({ booking: null })
      if (latest.state === 'reserved' || latest.state === 'calendar_pending')
        await runInline(deps, latest.id)
      return ok({ booking: await summary(db, latest.id, deps.now()) })
    }

    case 'cancel':
    case 'move_options':
    case 'reschedule': {
      const live = await db.liveBookingFor(enquiryId)
      if (!live) return ok({ status: 'not_live' })
      const settings = await db.getSettings()
      if (
        !customerCanChange(Date.parse(live.starts_at), deps.now(), settings.change_cutoff_minutes)
      ) {
        return ok({ status: 'too_late', businessPhone: settings.business_phone })
      }
      if (req.action === 'move_options') return ok(await availabilityForMove(deps, live))
      if (req.action === 'cancel') {
        const result = await cancel(deps, live, 'customer', req.reason ?? null)
        return ok({ ...result, booking: await summary(db, live.id, deps.now()) })
      }
      const result = await reschedule(deps, live, req.start, 'customer')
      return ok({ ...result, booking: await summary(db, live.id, deps.now()) })
    }

    case 'book': {
      const existing = await db.bookingByKey(req.idempotencyKey)
      if (existing) {
        if (existing.enquiry_id !== enquiryId) return { status: 403, body: { error: 'forbidden' } }
        return ok({ status: 'booked', booking: await summary(db, existing.id) })
      }
      const type = await findType(req.typeId)
      if (!type) return { status: 400, body: { error: 'unknown_type' } }
      const eligibility = await db.eligibility(enquiryId, type.id)
      if (eligibility !== 'eligible') return ok({ status: 'ineligible', reason: eligibility })

      const start = new Date(req.start).toISOString()
      const before = await availability(deps, type)
      if (before.status !== 'ok') return ok(before)
      if (!before.slots.some((s) => s.start === start)) {
        // A concurrent request with the same key (a double tap) may have just taken this slot.
        const raced = await db.bookingByKey(req.idempotencyKey)
        if (raced && raced.enquiry_id === enquiryId) {
          return ok({ status: 'booked', booking: await summary(db, raced.id) })
        }
        return ok({
          status: 'slot_unavailable',
          alternatives: alternativesNear(before.slots, start),
        })
      }

      const result = await db.reserve(enquiryId, type.id, start, req.idempotencyKey)
      if (result.status === 'slot_unavailable') {
        // Under a same-key race the loser's insert can hit the overlap before the key: the slot
        // is "taken" by this very request's twin. Hand back that booking.
        const raced = await db.bookingByKey(req.idempotencyKey)
        if (raced && raced.enquiry_id === enquiryId) {
          return ok({ status: 'booked', booking: await summary(db, raced.id) })
        }
        const fresh = await availability(deps, type)
        return ok({
          status: 'slot_unavailable',
          alternatives: fresh.status === 'ok' ? alternativesNear(fresh.slots, start) : [],
        })
      }
      if (result.status === 'ineligible') return ok({ status: 'ineligible', reason: result.reason })
      if (result.status === 'no_staff') return ok({ status: 'unavailable', reason: 'no_staff' })
      if (result.status === 'already_booked') {
        return ok({ status: 'already_booked', booking: await summary(db, result.booking_id) })
      }
      await runInline(deps, result.booking_id)
      return ok({ status: 'booked', booking: await summary(db, result.booking_id) })
    }
  }
}
