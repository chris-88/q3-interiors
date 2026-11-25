import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useDeleteEnquiry } from '@/api/staff-booking'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

/** For a data request: delete everything about this enquiry, after typing its reference. */
export function DeleteEnquiry({ enquiryId, reference }: { enquiryId: string; reference: string }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const navigate = useNavigate()
  const remove = useDeleteEnquiry((deleted) => navigate('/', { replace: true, state: { deleted } }))
  const matches = typed.trim().toUpperCase() === reference

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="text-destructive h-10 self-start"
        onClick={() => setOpen(true)}
      >
        Delete this enquiry…
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        This permanently deletes the enquiry, its answers, bookings, history and any queued emails,
        and removes its Google Calendar events. Only a note that {reference} was deleted, when and
        by whom, is kept. It cannot be undone.
      </p>
      <Field>
        <FieldLabel htmlFor="confirm-delete">Type {reference} to confirm</FieldLabel>
        <Input
          id="confirm-delete"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="h-10 font-mono text-base"
        />
        <FieldDescription>
          Use this for a customer&apos;s request to delete their details.
        </FieldDescription>
      </Field>
      {remove.isError && (
        <Alert variant="destructive">
          <AlertDescription>Not deleted: {remove.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          className="h-10"
          disabled={!matches || remove.isPending}
          onClick={() => remove.mutate({ enquiryId, confirm: typed })}
        >
          {remove.isPending ? 'Deleting…' : 'Delete permanently'}
        </Button>
        <Button
          variant="ghost"
          className="h-10"
          onClick={() => {
            setOpen(false)
            setTyped('')
          }}
          disabled={remove.isPending}
        >
          Keep it
        </Button>
      </div>
    </div>
  )
}
