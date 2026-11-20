/**
 * Web Storage that never throws. Private windows, blocked site data and some in-app browsers
 * make storage unavailable or make every access throw; the app must still work without it.
 */
export type SafeStorage = {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

function resolve(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function safeStorage(kind: 'local' | 'session'): SafeStorage {
  return {
    get(key) {
      try {
        return resolve(kind)?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        resolve(kind)?.setItem(key, value)
      } catch {
        // Storage full or blocked: the in-memory state still works for this page view.
      }
    },
    remove(key) {
      try {
        resolve(kind)?.removeItem(key)
      } catch {
        // Nothing to clean up if storage is unavailable.
      }
    },
  }
}

/** Parse stored JSON, returning null for anything missing or malformed. */
export function readJson(storage: SafeStorage, key: string): unknown {
  const raw = storage.get(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}
