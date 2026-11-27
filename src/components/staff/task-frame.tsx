// The frame for a focused task on one enquiry (review P5): writing the estimate or the quote, or
// booking a visit or a call. A way back to the enquiry, the task's title and step, what it is
// about, and the task's own action in the bar: fixed to the bottom on phones, as on the enquiry
// page, and from 1024px in a sticky left column with the title, so it is always on the first
// screen. The bar never offers the stage's action while a task is open.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'

/** Where a `TaskBar` drawn inside the task's content goes: the frame's left column. */
const BarSlot = createContext<HTMLElement | null>(null)

export function TaskFrame({
  enquiryId,
  name,
  title,
  step,
  about,
  saved,
  bar,
  padded = false,
  focusTitle = false,
  children,
}: {
  enquiryId: string
  /** The customer's name, for the way back. */
  name: string
  title: string
  /** "Step 1 of 2: the estimate". */
  step?: { at: number; of: number; label: string }
  /** One line on what the task is for ("After the site visit on Tue 24 Nov, 10:00"). */
  about?: ReactNode
  /** Says the draft is kept on this device. */
  saved?: boolean
  /** The task's own action; a task whose panel draws its own `TaskBar` sets `padded`. */
  bar?: ReactNode
  padded?: boolean
  /** A task with no first field to start in (booking) starts at its title. */
  focusTitle?: boolean
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const at = step?.at ?? 1
  // A later step, or a task with no field to start in, starts at its heading.
  useEffect(() => {
    if (at > 1 || focusTitle) heading.current?.focus()
  }, [at, focusTitle])
  return (
    <div
      className={`mx-auto grid w-full max-w-2xl gap-4 lg:max-w-none lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-8 ${bar || padded ? 'pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0' : ''}`}
    >
      <div className="flex flex-col gap-4 lg:sticky lg:top-4">
        <Link
          to={`/enquiries/${enquiryId}`}
          className="text-primary inline-flex min-h-12 items-center gap-1 self-start text-sm underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back to {name}
        </Link>
        <div className="flex flex-col gap-1">
          {step && (
            <p className="text-muted-foreground text-sm">
              Step {step.at} of {step.of}: {step.label}
            </p>
          )}
          <h1 ref={heading} tabIndex={-1} className="text-title font-medium outline-none">
            {title}
          </h1>
          {about && <p className="text-muted-foreground text-sm">{about}</p>}
          {saved && (
            <p className="text-muted-foreground text-sm">Saved on this device until you send it.</p>
          )}
        </div>
        {bar && <TaskBar>{bar}</TaskBar>}
        <div ref={setSlot} className="contents" />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <BarSlot.Provider value={slot}>{children}</BarSlot.Provider>
      </div>
    </div>
  )
}

/**
 * The task's action bar: fixed to the bottom on phones (in thumb reach), in the left column from
 * 1024px. Drawn inside a task's content, it is moved there (a portal into the frame's slot).
 */
export function TaskBar({ children }: { children: ReactNode }) {
  const slot = useContext(BarSlot)
  const bar = (
    <section
      aria-label="Actions"
      data-action-bar=""
      className="bg-background fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t px-4 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:static lg:border-0 lg:p-0"
    >
      {children}
    </section>
  )
  return slot ? createPortal(bar, slot) : bar
}
