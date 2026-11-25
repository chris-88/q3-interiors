import { currentEnquiryForm } from '@/forms/enquiry/v2'
import { parseAttribution } from '@/lib/attribution'
import { safeStorage, type SafeStorage } from '@/lib/storage'
import { ensureVisit, saveVisit, surfaceFor, visitPayload, type Surface } from '@/lib/visit'
import { supabase } from '@/lib/supabase'

/*
 * Visit counting through `record_visit` (anon RPC). Fire and forget: never awaited by the page,
 * never retried, every failure ignored, so counting can neither block nor break the journey.
 */

function send(payload: ReturnType<typeof visitPayload>) {
  try {
    void Promise.resolve(supabase.rpc('record_visit', payload)).then(
      () => undefined,
      () => undefined,
    )
  } catch {
    // ignored
  }
}

function arrivalTags() {
  try {
    return parseAttribution(
      { search: window.location.search, hash: window.location.hash },
      new Date(),
    )
  } catch {
    return null
  }
}

/** Once per tab, on arriving at the landing page or the enquiry form. */
export function countArrival(pathname: string, storage: SafeStorage = safeStorage('session')) {
  const surface = surfaceFor(pathname)
  if (!surface) return
  const visit = ensureVisit(storage)
  if (visit.sent) return
  saveVisit(storage, { ...visit, sent: true, surface })
  send(
    visitPayload({
      id: visit.id,
      surface,
      formVersion: currentEnquiryForm.version,
      attribution: arrivalTags(),
    }),
  )
}

/** The route the customer tapped (first one per tab only). */
export function countRouteChoice(
  route: 'phone' | 'on_site',
  storage: SafeStorage = safeStorage('session'),
) {
  const visit = ensureVisit(storage)
  if (visit.route) return
  const surface: Surface = visit.surface ?? 'enquire'
  saveVisit(storage, { ...visit, route, surface, sent: true })
  send(
    visitPayload({
      id: visit.id,
      surface,
      formVersion: currentEnquiryForm.version,
      attribution: arrivalTags(),
      route,
    }),
  )
}

/** The tab's visit id for the submission, if this tab was counted. */
export function currentVisitId(storage: SafeStorage = safeStorage('session')): string | null {
  const visit = ensureVisit(storage)
  return visit.sent || visit.route ? visit.id : null
}
