import { z } from 'zod'
import { readJson, type SafeStorage } from './storage'

/**
 * Campaign attribution. Only campaign tags and whether a click id was present are read from the
 * URL; the click id value itself is not kept, and nothing about the customer ever goes into a URL.
 */
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const
export const CLICK_ID_KEYS = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid'] as const

const STORAGE_KEY = 'q3.attribution'
const MAX_VALUE_LENGTH = 200
export const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const attributionSchema = z.object({
  utm_source: z.string().max(MAX_VALUE_LENGTH).optional(),
  utm_medium: z.string().max(MAX_VALUE_LENGTH).optional(),
  utm_campaign: z.string().max(MAX_VALUE_LENGTH).optional(),
  utm_content: z.string().max(MAX_VALUE_LENGTH).optional(),
  utm_term: z.string().max(MAX_VALUE_LENGTH).optional(),
  click_id_present: z.boolean(),
  landing_path: z.string(),
  first_seen_at: z.string(),
})

export type Attribution = z.infer<typeof attributionSchema>

const storedSchema = z.object({ attribution: attributionSchema, expiresAt: z.number() })

type UrlParts = { search: string; hash: string }

function hashParts(hash: string): { path: string; query: string } {
  const route = hash.startsWith('#') ? hash.slice(1) : hash
  const index = route.indexOf('?')
  return index === -1
    ? { path: route, query: '' }
    : { path: route.slice(0, index), query: route.slice(index + 1) }
}

function safeParams(query: string): URLSearchParams {
  try {
    return new URLSearchParams(query)
  } catch {
    return new URLSearchParams()
  }
}

function clean(value: string | null): string | undefined {
  if (value === null) return undefined
  const trimmed = value.trim().slice(0, MAX_VALUE_LENGTH)
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read attribution from a URL. Parameters may sit before the `#` (how ad platforms append them)
 * or inside the hash route (`#/enquire?utm_source=...`); a value before the `#` wins.
 */
export function parseAttribution(url: UrlParts, now: Date): Attribution {
  const outer = safeParams(url.search)
  const { path, query } = hashParts(url.hash)
  const inner = safeParams(query)
  const attribution: Attribution = {
    click_id_present: CLICK_ID_KEYS.some((key) => outer.has(key) || inner.has(key)),
    landing_path: /^\/[A-Za-z0-9/_-]{0,199}$/.test(path) ? path : '/',
    first_seen_at: now.toISOString(),
  }
  for (const key of UTM_KEYS) {
    const value = clean(outer.get(key)) ?? clean(inner.get(key))
    if (value !== undefined) attribution[key] = value
  }
  return attribution
}

export function isTagged(attribution: Attribution): boolean {
  return attribution.click_id_present || UTM_KEYS.some((key) => attribution[key] !== undefined)
}

export function readAttribution(storage: SafeStorage, now: Date): Attribution | null {
  const parsed = storedSchema.safeParse(readJson(storage, STORAGE_KEY))
  if (!parsed.success) return null
  if (parsed.data.expiresAt <= now.getTime()) {
    storage.remove(STORAGE_KEY)
    return null
  }
  return parsed.data.attribution
}

/**
 * Called once at boot. Keeps the first tagged arrival within the TTL: a later tagged visit does
 * not overwrite it, and an untagged visit records nothing. Returns what is now stored, or null
 * when attribution is unknown (no tags seen, or storage unavailable and this visit untagged).
 */
export function captureAttribution(
  url: UrlParts,
  storage: SafeStorage,
  now: Date,
): Attribution | null {
  const existing = readAttribution(storage, now)
  if (existing) return existing
  const arrival = parseAttribution(url, now)
  if (!isTagged(arrival)) return null
  storage.set(
    STORAGE_KEY,
    JSON.stringify({ attribution: arrival, expiresAt: now.getTime() + ATTRIBUTION_TTL_MS }),
  )
  return arrival
}

let bootArrival: Attribution | null = null

/** Capture attribution for this page load. Call once, before the router renders. */
export function initAttribution(storage: SafeStorage): void {
  bootArrival = captureAttribution(window.location, storage, new Date())
}

/** Attribution to send with an enquiry, or null for unknown. Survives blocked storage in memory. */
export function currentAttribution(storage: SafeStorage): Attribution | null {
  return readAttribution(storage, new Date()) ?? bootArrival
}
