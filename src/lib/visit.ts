import { z } from 'zod'
import type { Attribution } from './attribution'
import { readJson, type SafeStorage } from './storage'

/**
 * First-party visit counting (pilot measures). One record per browser tab that arrives on the
 * landing page or the enquiry form: a random id kept in sessionStorage (so a reload is the same
 * visit and nothing survives the tab), where it landed, the form version shown, this arrival's
 * campaign tags, and later the route tapped. No cookie, no personal details: the payload is built
 * here from an allow-list and `visit.test.ts` fails if anything else gets in.
 */

const KEY = 'q3.visit'

const storedSchema = z.object({
  id: z.uuid(),
  sent: z.boolean(),
  route: z.enum(['phone', 'on_site']).nullable(),
  surface: z.enum(['landing', 'enquire']).nullable().default(null),
})
export type VisitState = z.infer<typeof storedSchema>

export type Surface = 'landing' | 'enquire'

/** The surfaces that count as a landing; anything else (booking links, privacy) does not. */
export function surfaceFor(pathname: string): Surface | null {
  if (pathname === '/') return 'landing'
  if (pathname === '/enquire') return 'enquire'
  return null
}

export function readVisit(storage: SafeStorage): VisitState | null {
  const parsed = storedSchema.safeParse(readJson(storage, KEY))
  return parsed.success ? parsed.data : null
}

export function ensureVisit(
  storage: SafeStorage,
  newId: () => string = () => crypto.randomUUID(),
): VisitState {
  const existing = readVisit(storage)
  if (existing) return existing
  const fresh: VisitState = { id: newId(), sent: false, route: null, surface: null }
  storage.set(KEY, JSON.stringify(fresh))
  return fresh
}

export function saveVisit(storage: SafeStorage, state: VisitState): void {
  storage.set(KEY, JSON.stringify(state))
}

/** Every key the server may receive. Adding a personal field here is a decision, not a slip. */
export const VISIT_KEYS = [
  'p_session_id',
  'p_surface',
  'p_form_version',
  'p_attribution',
  'p_route',
] as const
export const VISIT_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'click_id_present',
] as const

export type VisitPayload = {
  p_session_id: string
  p_surface: Surface
  p_form_version: number
  p_attribution: Partial<Record<(typeof VISIT_ATTRIBUTION_KEYS)[number], string | boolean>> | null
  p_route: 'phone' | 'on_site' | null
}

export function visitPayload(input: {
  id: string
  surface: Surface
  formVersion: number
  attribution: Attribution | null
  route?: 'phone' | 'on_site' | null
}): VisitPayload {
  let tags: VisitPayload['p_attribution'] = null
  if (input.attribution) {
    tags = {}
    for (const key of VISIT_ATTRIBUTION_KEYS) {
      const value = (input.attribution as Record<string, unknown>)[key]
      if (typeof value === 'string' || typeof value === 'boolean') tags[key] = value
    }
  }
  return {
    p_session_id: input.id,
    p_surface: input.surface,
    p_form_version: input.formVersion,
    p_attribution: tags,
    p_route: input.route ?? null,
  }
}
