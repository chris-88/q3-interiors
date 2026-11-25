import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { isIos, isStandalone, useInstallPrompt } from '@/staff-pwa'

/** "Install the app": the browser's prompt where there is one, the Share menu on an iPhone. */
export function InstallHint() {
  const { canPrompt, prompt } = useInstallPrompt()
  const [hidden, setHidden] = useState(() => isStandalone())
  if (hidden || (!canPrompt && !isIos())) return null
  return (
    <section aria-labelledby="install-heading" className="bg-soft rounded-md border p-4">
      <h2 id="install-heading" className="text-base font-medium">
        Install the app
      </h2>
      {canPrompt ? (
        <>
          <p className="text-muted-foreground mt-1 text-sm">
            Put the staff console on your home screen and open it like any other app.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="h-12 px-6" onClick={() => void prompt()}>
              Install
            </Button>
            <Button variant="ghost" className="h-12" onClick={() => setHidden(true)}>
              Not now
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground mt-1 text-sm">
            On an iPhone: open this page in Safari, tap the Share button, then “Add to Home Screen”.
          </p>
          <Button variant="ghost" className="mt-2 h-12" onClick={() => setHidden(true)}>
            Got it
          </Button>
        </>
      )}
    </section>
  )
}
