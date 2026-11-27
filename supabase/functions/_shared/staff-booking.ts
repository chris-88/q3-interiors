import { z } from 'zod'
import { availabilityForMove, cancel, reschedule, runDueFor, type ChangeDeps } from './changes.ts'
import { availability } from './public-booking.ts'
import type { Slot } from './slots.ts'

/** Staff cancel and reschedule: the same server paths as customers, without the cut-off. */
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move_options'), bookingId: z.uuid() }),
  z.object({ action: z.literal('reschedule'), bookingId: z.uuid(), start: z.iso.datetime() }),
  z.object({
    action: z.literal('cancel'),
    bookingId: z.uuid(),
    reason: z.string().max(300).optional(),
  }),
  // After a call: book the site visit on the customer's behalf.
  z.object({ action: z.literal('visit_options'), enquiryId: z.uuid() }),
  z.object({
    action: z.literal('book_visit'),
    enquiryId: z.uuid(),
    start: z.iso.datetime(),
    idempotencyKey: z.uuid(),
    /** The address typed by staff when the enquiry lacks one (same fields as the customer's). */
    siteStreet: z.string().max(200).optional(),
    siteUnit: z.string().max(200).optional(),
  }),
])

const near = (slots: Slot[], start: string) => {
  const after = slots.filter((s) => s.start >= start)
  return (after.length ? after : slots).slice(0, 6)
}

export async function handleStaff(
  raw: unknown,
  staffUserId: string,
  deps: ChangeDeps,
): Promise<{ status: number; body: unknown }> {
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { error: 'bad_request' } }
  const req = parsed.data
  if (req.action === 'visit_options' || req.action === 'book_visit')
    return visitAction(req, staffUserId, deps)
  const booking = await deps.db.bookingById(req.bookingId)
  if (!booking) return { status: 404, body: { error: 'not_found' } }
  switch (req.action) {
    case 'move_options':
      return { status: 200, body: await availabilityForMove(deps, booking) }
    case 'reschedule':
      return { status: 200, body: await reschedule(deps, booking, req.start, 'staff', staffUserId) }
    case 'cancel':
      return {
        status: 200,
        body: await cancel(deps, booking, 'staff', req.reason ?? null, staffUserId),
      }
  }
}

type VisitRequest = Extract<
  z.infer<typeof requestSchema>,
  { action: 'visit_options' | 'book_visit' }
>

/**
 * The site visit staff book for a customer: the same free slots the customer sees and the same
 * reserve path, so the customer gets the normal confirmation email with its manage link.
 */
async function visitAction(
  req: VisitRequest,
  staffUserId: string,
  deps: ChangeDeps,
): Promise<{ status: number; body: unknown }> {
  const { db } = deps
  const ok = (body: unknown) => ({ status: 200, body })
  const enquiry = await db.getEnquiry(req.enquiryId)
  if (!enquiry) return { status: 404, body: { error: 'not_found' } }
  const type = (await db.listTypes()).find((t) => t.active && t.mode === 'on_site')
  if (!type) return ok({ status: 'unavailable', reason: 'no_type' })
  const address = enquiry.site_details?.site_address
  const siteAddress = typeof address === 'string' && address.trim() ? address : null

  if (req.action === 'visit_options') {
    return ok({
      ...(await availability(deps, type)),
      typeLabel: type.label,
      eligibility: await db.eligibility(enquiry.id, type.id),
      siteAddress,
    })
  }

  const existing = await db.bookingByKey(req.idempotencyKey)
  if (existing) {
    if (existing.enquiry_id !== enquiry.id) return { status: 403, body: { error: 'forbidden' } }
    return ok({ status: 'booked', bookingId: existing.id })
  }
  let addressAdded = false
  const street = req.siteStreet?.trim()
  if (street) {
    try {
      await db.updateDetails(enquiry.id, {
        site_street: street,
        site_unit: req.siteUnit?.trim() ?? '',
        appointment_preference: 'on_site',
      })
      addressAdded = true
    } catch (error) {
      if ((error as { code?: string }).code === '22023') return ok({ status: 'invalid_address' })
      throw error
    }
  }
  const eligibility = await db.eligibility(enquiry.id, type.id)
  if (eligibility !== 'eligible') return ok({ status: 'ineligible', reason: eligibility })

  const start = new Date(req.start).toISOString()
  const before = await availability(deps, type)
  if (before.status !== 'ok') return ok(before)
  if (!before.slots.some((s) => s.start === start))
    return ok({ status: 'slot_unavailable', alternatives: near(before.slots, start) })

  const result = await db.reserve(enquiry.id, type.id, start, req.idempotencyKey)
  if (result.status === 'slot_unavailable') {
    const fresh = await availability(deps, type)
    return ok({
      status: 'slot_unavailable',
      alternatives: fresh.status === 'ok' ? near(fresh.slots, start) : [],
    })
  }
  if (result.status === 'ineligible') return ok({ status: 'ineligible', reason: result.reason })
  if (result.status === 'no_staff') return ok({ status: 'unavailable', reason: 'no_staff' })
  if (result.status === 'already_booked') return ok({ status: 'already_booked' })
  await db.visitBookedByStaff(result.booking_id, staffUserId, addressAdded)
  await runDueFor(deps, result.booking_id)
  return ok({ status: 'booked', bookingId: result.booking_id })
}
