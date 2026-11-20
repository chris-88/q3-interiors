import {
  ATTRIBUTION_TTL_MS,
  captureAttribution,
  isTagged,
  parseAttribution,
  readAttribution,
} from './attribution'
import type { SafeStorage } from './storage'

function memoryStorage(): SafeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  }
}

const now = new Date('2026-11-20T10:00:00Z')

describe('parseAttribution', () => {
  it('reads utm parameters from before the hash', () => {
    const a = parseAttribution(
      { search: '?utm_source=instagram&utm_medium=paid_social&utm_campaign=kitchens', hash: '#/' },
      now,
    )
    expect(a).toEqual({
      utm_source: 'instagram',
      utm_medium: 'paid_social',
      utm_campaign: 'kitchens',
      click_id_present: false,
      landing_path: '/',
      first_seen_at: now.toISOString(),
    })
  })

  it('reads utm parameters from inside the hash route', () => {
    const a = parseAttribution(
      { search: '', hash: '#/enquire?utm_source=instagram&utm_content=reel_2&utm_term=attic' },
      now,
    )
    expect(a.utm_source).toBe('instagram')
    expect(a.utm_content).toBe('reel_2')
    expect(a.utm_term).toBe('attic')
    expect(a.landing_path).toBe('/enquire')
  })

  it('prefers the value before the hash when both are present', () => {
    const a = parseAttribution(
      { search: '?utm_source=outer', hash: '#/?utm_source=inner&utm_medium=x' },
      now,
    )
    expect(a.utm_source).toBe('outer')
    expect(a.utm_medium).toBe('x')
  })

  it('records that a click id was present without keeping its value', () => {
    const a = parseAttribution({ search: '?fbclid=abc123', hash: '' }, now)
    expect(a.click_id_present).toBe(true)
    expect(JSON.stringify(a)).not.toContain('abc123')
    expect(parseAttribution({ search: '', hash: '#/?gclid=1' }, now).click_id_present).toBe(true)
  })

  it('leaves missing and empty values out rather than guessing', () => {
    const a = parseAttribution({ search: '?utm_source=&utm_medium=%20%20', hash: '#/' }, now)
    expect(a).not.toHaveProperty('utm_source')
    expect(a).not.toHaveProperty('utm_medium')
    expect(isTagged(a)).toBe(false)
  })

  it('caps long values', () => {
    const a = parseAttribution({ search: `?utm_campaign=${'x'.repeat(500)}`, hash: '' }, now)
    expect(a.utm_campaign).toHaveLength(200)
  })

  it('falls back to / for an odd landing path', () => {
    expect(parseAttribution({ search: '', hash: '' }, now).landing_path).toBe('/')
    expect(parseAttribution({ search: '', hash: '#/a b<c>' }, now).landing_path).toBe('/')
  })
})

describe('captureAttribution', () => {
  it('keeps the first tagged arrival and ignores later ones', () => {
    const storage = memoryStorage()
    captureAttribution({ search: '?utm_source=first', hash: '#/' }, storage, now)
    const later = new Date(now.getTime() + 60_000)
    const kept = captureAttribution({ search: '?utm_source=second', hash: '#/' }, storage, later)
    expect(kept?.utm_source).toBe('first')
    expect(readAttribution(storage, later)?.utm_source).toBe('first')
  })

  it('records nothing for an untagged arrival', () => {
    const storage = memoryStorage()
    expect(captureAttribution({ search: '', hash: '#/enquire' }, storage, now)).toBeNull()
    expect(storage.data.size).toBe(0)
  })

  it('lets a tagged arrival replace an expired one', () => {
    const storage = memoryStorage()
    captureAttribution({ search: '?utm_source=old', hash: '' }, storage, now)
    const expired = new Date(now.getTime() + ATTRIBUTION_TTL_MS + 1)
    expect(readAttribution(storage, expired)).toBeNull()
    expect(
      captureAttribution({ search: '?utm_source=new', hash: '' }, storage, expired)?.utm_source,
    ).toBe('new')
  })

  it('ignores malformed stored data', () => {
    const storage = memoryStorage()
    storage.set('q3.attribution', '{not json')
    expect(readAttribution(storage, now)).toBeNull()
    storage.set('q3.attribution', JSON.stringify({ attribution: { utm_source: 1 }, expiresAt: 0 }))
    expect(readAttribution(storage, now)).toBeNull()
  })
})
