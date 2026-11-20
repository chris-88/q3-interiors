import { z } from 'zod'
import { readJson, type SafeStorage } from './storage'

/**
 * The scheduling link for the customer's latest enquiry, kept in this browser so they can come
 * back to book later. The token is opaque and scoped to that one enquiry; it expires on the
 * server after 30 days.
 */
const KEY = 'q3.booking.access'
const schema = z.object({ reference: z.string(), token: z.string().min(20), savedAt: z.number() })
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type BookingAccess = { reference: string; token: string }

export function rememberBookingAccess(
  storage: SafeStorage,
  access: BookingAccess,
  now = Date.now(),
) {
  storage.set(KEY, JSON.stringify({ ...access, savedAt: now }))
}

export function readBookingAccess(storage: SafeStorage, now = Date.now()): BookingAccess | null {
  const parsed = schema.safeParse(readJson(storage, KEY))
  if (!parsed.success || now - parsed.data.savedAt > MAX_AGE_MS) return null
  return { reference: parsed.data.reference, token: parsed.data.token }
}

export function forgetBookingAccess(storage: SafeStorage) {
  storage.remove(KEY)
}
