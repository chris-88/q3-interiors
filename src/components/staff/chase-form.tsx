import { useState } from 'react'
import { useSetChaseDetails } from '@/api/pilot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'

/**
 * "Had to chase details": any active staff member ticks it and says what was missing. The
 * server checks the person and the note; every change is in the history.
 */
export function ChaseForm({
  enquiryId,
  current,
}: {
  enquiryId: string
  current: { at: string | null; note: string | null; by: string | null }
}) {
  const save = useSetChaseDetails(enquiryId)
  const [flagged, setFlagged] = useState(current.at !== null)
  const [note, setNote] = useState(current.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const changed =
    flagged !== (current.at !== null) || (flagged && note.trim() !== (current.note ?? ''))

  const submit = () => {
    const text = note.trim()
    if (flagged && (text.length < 3 || text.length > 500)) {
      setError('Say what was missing (3 to 500 characters).')
      return
    }
    setError(null)
    save.mutate({ flagged, note: flagged ? text : '' })
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {current.at && (
        <p className="text-sm">
          Flagged {formatDateTime(current.at)}
          {current.by ? ` by ${current.by}` : ''}.
        </p>
      )}
      <label htmlFor={`chase-${enquiryId}`} className="flex min-h-10 items-center gap-3">
        <Checkbox
          id={`chase-${enquiryId}`}
          checked={flagged}
          onCheckedChange={(checked) => {
            setFlagged(checked)
            setError(null)
          }}
        />
        <span>Had to chase details</span>
      </label>
      {flagged && (
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`chase-note-${enquiryId}`}>What was missing?</FieldLabel>
          <FieldDescription>For example: no house number, wrong phone number.</FieldDescription>
          <Textarea
            id={`chase-note-${enquiryId}`}
            rows={2}
            maxLength={500}
            value={note}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setNote(e.target.value)
              setError(null)
            }}
            className="text-base"
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
      )}
      {save.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>That was not saved. Please try again.</AlertDescription>
        </Alert>
      )}
      {save.isSuccess && !changed && (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          Saved
        </p>
      )}
      <Button
        type="submit"
        variant="outline"
        className="h-10 self-start"
        disabled={save.isPending || !changed}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
