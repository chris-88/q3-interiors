// Knowing when the open staff console is out of date (staff build only; imported from StaffApp,
// so this module lives in the StaffApp chunk and `import.meta.url` names that chunk).
//
// Each staff deploy publishes /version.json with the file name of its StaffApp chunk (whose hash
// changes with any staff code). The app compares it with its own on start, when it comes back to
// the foreground, every five minutes, and whenever a screen could not read its data. When a newer
// build exists:
//   - not busy: reload straight away;
//   - busy (typing or saving, see `isBusy`): a persistent bar "A new version is ready. Reload",
//     and a reload as soon as the person moves to another screen.
import { useSyncExternalStore } from 'react'
import { z } from 'zod'

/** This build's StaffApp chunk, e.g. "StaffApp-CcGEM2YL.js"; null in dev and tests. */
export function ownBuild(url: string = import.meta.url): string | null {
  const name = new URL(url, 'http://local/').pathname.split('/').pop() ?? ''
  return /^StaffApp-[\w-]+\.js$/.test(name) ? name : null
}

export function isNewer(own: string | null, latest: string | null): boolean {
  return own !== null && latest !== null && latest !== own
}

const versionSchema = z.object({ app: z.string() })

export async function latestBuild(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetcher('/version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const parsed = versionSchema.safeParse(await res.json())
    return parsed.success ? parsed.data.app : null
  } catch {
    return null
  }
}

/**
 * "In the middle of typing or submitting": focus is in a field you can type in, something was
 * typed on this screen since it opened or since the last save, or a save is in flight. Choosing a
 * radio or checkbox alone is not typing.
 */
export function isBusy(state: {
  activeElement: Element | null
  typedSinceSave: boolean
  saving: boolean
}): boolean {
  if (state.saving || state.typedSinceSave) return true
  const el = state.activeElement
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(
      el.type,
    )
  return el instanceof HTMLElement && el.isContentEditable === true
}

// ---------------------------------------------------------------------------------------------
// The store the shell reads: is this build stale, and did a screen fail to read its data?
// ---------------------------------------------------------------------------------------------

type State = { stale: boolean; unreadable: string | null }
let state: State = { stale: false, unreadable: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useStaleState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
}

let typedSinceSave = false
let savingCount = () => 0

export function noteSaved() {
  typedSinceSave = false
}

function busyNow(): boolean {
  return isBusy({
    activeElement: typeof document === 'undefined' ? null : document.activeElement,
    typedSinceSave,
    saving: savingCount() > 0,
  })
}

function reload() {
  window.location.reload()
}

/** The person moved to another screen: what they typed is behind them, and a waiting new version
 * can be picked up now. Called by StaffWatch on every route change. */
export function noteNavigation() {
  typedSinceSave = false
  if (state.stale && !busyNow()) reload()
}

/** Check for a newer build; act on it. Resolves to whether one exists. */
export async function checkForNewerBuild(): Promise<boolean> {
  const newer = isNewer(ownBuild(), await latestBuild())
  if (!newer) return false
  if (busyNow()) set({ stale: true })
  else reload()
  return true
}

/** A screen could not read what the server sent: a newer build first, else say so plainly. */
export async function onUnreadableData(where: string) {
  if (await checkForNewerBuild()) return
  set({ unreadable: where })
}

let started = false

/** Start watching (once). `mutating` reports saves in flight (TanStack's isMutating). */
export function startVersionWatch(mutating: () => number) {
  savingCount = mutating
  if (started || typeof window === 'undefined') return
  started = true
  document.addEventListener(
    'input',
    (event) => {
      const t = event.target
      if (t instanceof HTMLInputElement && ['checkbox', 'radio'].includes(t.type)) return
      typedSinceSave = true
    },
    true,
  )
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForNewerBuild()
  })
  window.setInterval(() => void checkForNewerBuild(), 5 * 60_000)
  void checkForNewerBuild()
}
