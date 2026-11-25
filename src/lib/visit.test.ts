import type { Attribution } from './attribution'
import type { SafeStorage } from './storage'
import { VISIT_ATTRIBUTION_KEYS, VISIT_KEYS, ensureVisit, surfaceFor, visitPayload } from './visit'

function memory(): SafeStorage {
  const map = new Map<string, string>()
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  }
}

describe('visit counting', () => {
  it('sends only the agreed, non-personal fields', () => {
    // Even if something personal were ever put next to the tags, it is not sent.
    const attribution = {
      utm_source: 'instagram',
      utm_campaign: 'kitchens',
      click_id_present: true,
      landing_path: '/',
      first_seen_at: '2026-11-27T10:00:00Z',
      name: 'Ann Smith',
      email: 'ann@example.com',
      phone: '087 123 4567',
    } as unknown as Attribution
    const payload = visitPayload({
      id: '00000000-0000-4000-8000-000000000001',
      surface: 'landing',
      formVersion: 2,
      attribution,
      route: 'on_site',
    })
    expect(Object.keys(payload).sort()).toEqual([...VISIT_KEYS].sort())
    expect(
      Object.keys(payload.p_attribution ?? {}).every((k) =>
        (VISIT_ATTRIBUTION_KEYS as readonly string[]).includes(k),
      ),
    ).toBe(true)
    expect(payload.p_attribution).toEqual({
      utm_source: 'instagram',
      utm_campaign: 'kitchens',
      click_id_present: true,
    })
    const text = JSON.stringify(payload)
    for (const personal of ['Ann', 'example.com', '087', 'first_seen', 'landing_path'])
      expect(text).not.toContain(personal)
  })

  it('pins the allow-lists: a new key here must be a deliberate change', () => {
    expect(VISIT_KEYS).toEqual([
      'p_session_id',
      'p_surface',
      'p_form_version',
      'p_attribution',
      'p_route',
    ])
    expect(VISIT_ATTRIBUTION_KEYS).toEqual([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'click_id_present',
    ])
  })

  it('keeps one id per tab', () => {
    const storage = memory()
    const first = ensureVisit(storage, () => '00000000-0000-4000-8000-000000000001')
    const again = ensureVisit(storage, () => '00000000-0000-4000-8000-000000000002')
    expect(again.id).toBe(first.id)
  })

  it('counts arrivals on the landing page and the form only', () => {
    expect(surfaceFor('/')).toBe('landing')
    expect(surfaceFor('/enquire')).toBe('enquire')
    expect(surfaceFor('/book/tok')).toBeNull()
    expect(surfaceFor('/privacy')).toBeNull()
  })
})
