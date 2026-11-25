// The staff console as an installed app (staff build only; imported from StaffApp).
//
// Updates: the service worker (dist-staff/sw.js) installs a new version and takes over at once;
// the open page keeps running the code it loaded and shows "A new version is ready. Reload."
// (useUpdateReady). If a deploy removed a chunk the old page still needs, the page reloads
// instead of going blank (vite:preloadError).
import { useEffect, useState, useSyncExternalStore } from 'react'

type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

let updateReady = false
let installPrompt: InstallPrompt | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

let started = false

export function startStaffPwa() {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('vite:preloadError', (event) => {
    // Avoid a loop: at most one reload a minute for a missing chunk.
    const key = 'q3.staff.reloadedForChunk'
    try {
      const last = Number(window.sessionStorage.getItem(key) ?? 0)
      if (Date.now() - last < 60_000) return
      window.sessionStorage.setItem(key, String(Date.now()))
    } catch {
      // Storage blocked: still reload once.
    }
    event.preventDefault()
    window.location.reload()
  })

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as InstallPrompt
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    notify()
  })

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install claiming the page is not an update.
    if (!hadController) return
    updateReady = true
    notify()
  })
  void navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      const check = () => void registration.update().catch(() => undefined)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.setInterval(check, 30 * 60_000)
    })
    .catch(() => undefined)
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => updateReady,
    () => false,
  )
}

/** Running as the installed app (Android, desktop, or an iPhone home-screen app). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const ios = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function useInstallPrompt(): { canPrompt: boolean; prompt: () => Promise<void> } {
  const available = useSyncExternalStore(
    subscribe,
    () => installPrompt !== null,
    () => false,
  )
  return {
    canPrompt: available,
    prompt: async () => {
      const p = installPrompt
      if (!p) return
      await p.prompt()
      await p.userChoice.catch(() => undefined)
      installPrompt = null
      notify()
    },
  }
}

/** Online status, so the console says it is offline instead of showing stale data. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
