import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * The one confirm (review P8): a question, what will happen, the action that names itself, and a
 * way back. Shown in place (inside the sheet or the form) rather than as a second dialog; focus
 * moves to it when it appears and an error stays beside it.
 */
export function Confirm({
  question,
  detail,
  confirm,
  pending,
  pendingLabel = 'Saving…',
  cancel = 'Not yet',
  danger = false,
  error,
  onConfirm,
  onCancel,
}: {
  question: ReactNode
  detail?: ReactNode
  /** The action, in words: "Yes, send it", "Cancel the appointment". */
  confirm: string
  pending?: boolean
  pendingLabel?: string
  cancel?: string
  danger?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [])
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="alertdialog"
      aria-labelledby={`${id}-q`}
      aria-describedby={detail ? `${id}-d` : undefined}
      className="rounded-md border p-3 outline-none"
    >
      <p id={`${id}-q`} className="font-medium">
        {question}
      </p>
      {detail && (
        <p id={`${id}-d`} className="text-muted-foreground mt-1 text-sm">
          {detail}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant={danger ? 'destructive' : 'default'}
          className="h-12 sm:px-6"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? pendingLabel : confirm}
        </Button>
        <Button type="button" variant="outline" className="h-12 sm:px-6" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
