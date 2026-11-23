import { z } from 'zod'
import { availabilityForMove, cancel, reschedule, type ChangeDeps } from './changes.ts'

/** Staff cancel and reschedule: the same server paths as customers, without the cut-off. */
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move_options'), bookingId: z.uuid() }),
  z.object({ action: z.literal('reschedule'), bookingId: z.uuid(), start: z.iso.datetime() }),
  z.object({
    action: z.literal('cancel'),
    bookingId: z.uuid(),
    reason: z.string().max(300).optional(),
  }),
])

export async function handleStaff(
  raw: unknown,
  staffUserId: string,
  deps: ChangeDeps,
): Promise<{ status: number; body: unknown }> {
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) return { status: 400, body: { error: 'bad_request' } }
  const req = parsed.data
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
