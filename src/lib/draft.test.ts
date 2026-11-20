import {
  completeSubmission,
  emptyDraft,
  ensureIdempotencyKey,
  loadDraft,
  readSubmittedReference,
  saveDraft,
} from './draft'
import { safeStorage, type SafeStorage } from './storage'

function memoryStorage(): SafeStorage {
  const data = new Map<string, string>()
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  }
}

let counter = 0
const nextKey = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

describe('draft persistence', () => {
  it('round-trips answers and step across a reload', () => {
    const storage = memoryStorage()
    const draft = {
      ...emptyDraft('enquiry', 1),
      step: 2,
      answers: { project_type: 'kitchen', rooms: ['attic'] },
    }
    saveDraft(storage, draft)
    expect(loadDraft(storage, 'enquiry', 1)).toEqual(draft)
  })

  it('starts fresh for a different form version or a corrupt draft', () => {
    const storage = memoryStorage()
    saveDraft(storage, { ...emptyDraft('enquiry', 1), step: 3 })
    expect(loadDraft(storage, 'enquiry', 2)).toEqual(emptyDraft('enquiry', 2))
    storage.set('q3.enquiry.draft', '{"step": "three"}')
    expect(loadDraft(storage, 'enquiry', 1)).toEqual(emptyDraft('enquiry', 1))
  })

  it('works when storage throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      const storage = safeStorage('session')
      expect(() => saveDraft(storage, emptyDraft('enquiry', 1))).not.toThrow()
      expect(loadDraft(storage, 'enquiry', 1)).toEqual(emptyDraft('enquiry', 1))
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original)
    }
  })
})

describe('idempotency key', () => {
  it('is created once and reused for every retry of the same draft', () => {
    const storage = memoryStorage()
    const first = ensureIdempotencyKey(storage, emptyDraft('enquiry', 1), nextKey)
    const second = ensureIdempotencyKey(storage, first.draft, nextKey)
    expect(second.key).toBe(first.key)
  })

  it('is persisted before the request, so a retry after a reload uses it', () => {
    const storage = memoryStorage()
    const { key } = ensureIdempotencyKey(storage, emptyDraft('enquiry', 1), nextKey)
    const reloaded = loadDraft(storage, 'enquiry', 1)
    expect(ensureIdempotencyKey(storage, reloaded, nextKey).key).toBe(key)
  })

  it('is discarded after a successful save, so the next enquiry gets a new one', () => {
    const storage = memoryStorage()
    const { key } = ensureIdempotencyKey(storage, emptyDraft('enquiry', 1), nextKey)
    completeSubmission(storage, 'Q3-ABC234')
    expect(readSubmittedReference(storage)).toBe('Q3-ABC234')
    const fresh = loadDraft(storage, 'enquiry', 1)
    expect(fresh.idempotencyKey).toBeNull()
    expect(ensureIdempotencyKey(storage, fresh, nextKey).key).not.toBe(key)
  })

  it('generates a UUID by default', () => {
    const { key } = ensureIdempotencyKey(memoryStorage(), emptyDraft('enquiry', 1))
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })
})
