// The frame for a focused task on one enquiry (review P5): writing the estimate or the quote, or
// booking a visit or a call. A way back to the enquiry, the task's title and step, what it is
// about, and the task's own action in the bar (fixed to the bottom on phones, as on the enquiry
// page, so the bar never offers the stage's action while a task is open).
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'

export function TaskFrame({
  enquiryId,
  name,
  title,
  step,
  about,
  saved,
  bar,
  padded = false,
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
  children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const at = step?.at ?? 1
  // A later step starts at its heading, so a screen reader hears where it is.
  useEffect(() => {
    if (at > 1) heading.current?.focus()
  }, [at])
  return (
    <div
      className={`mx-auto flex w-full max-w-2xl flex-col gap-4 ${bar || padded ? 'pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0' : ''}`}
    >
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
          <p className="text-muted-foreground text-sm">Saved on this phone until you send it.</p>
        )}
      </div>
      {children}
      {bar && <TaskBar>{bar}</TaskBar>}
    </div>
  )
}

/** The task's action bar: fixed to the bottom on phones (in thumb reach), in the flow from 1024px. */
export function TaskBar({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Actions"
      data-action-bar=""
      className="bg-background fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t px-4 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:static lg:border-0 lg:p-0"
    >
      {children}
    </section>
  )
}
