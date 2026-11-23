import { useState } from 'react'
import { LOST_REASONS, useSetOutcome, type LostReason } from '@/api/staff-booking'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

export type CurrentOutcome = {
  outcome: 'won' | 'lost' | null
  value: number | null
  reason: LostReason | null
  note: string | null
}

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

/** Won (optional quoted value) or lost (reason, free text for "other"); history records each change. */
export function OutcomeForm({
  enquiryId,
  current,
}: {
  enquiryId: string
  current: CurrentOutcome
}) {
  const save = useSetOutcome(enquiryId)
  const [choice, setChoice] = useState<'won' | 'lost' | null>(current.outcome)
  const [value, setValue] = useState(current.value === null ? '' : String(current.value))
  const [reason, setReason] = useState<LostReason>(current.reason ?? 'price')
  const [note, setNote] = useState(current.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    if (choice === 'won') {
      const n = value.trim() === '' ? null : Number(value.replace(/[,€\s]/g, ''))
      if (n !== null && (!Number.isFinite(n) || n < 0)) {
        setError('Enter an amount in euro, e.g. 12500.')
        return
      }
      save.mutate({ outcome: 'won', value: n })
    } else if (choice === 'lost') {
      if (reason === 'other' && note.trim() === '') {
        setError('Say why.')
        return
      }
      save.mutate({ outcome: 'lost', reason, note })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {current.outcome && (
        <p className="text-sm">
          Recorded:{' '}
          <strong>
            {current.outcome === 'won'
              ? `Won${current.value !== null ? `, quoted ${euro.format(current.value)}` : ''}`
              : `Lost (${LOST_REASONS.find(([v]) => v === current.reason)?.[1] ?? current.reason})`}
          </strong>
          {current.note ? ` · ${current.note}` : ''}
        </p>
      )}
      <fieldset>
        <legend className="text-muted-foreground text-sm">Outcome</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(['won', 'lost'] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              className="h-9"
              variant={choice === v ? 'default' : 'outline'}
              aria-pressed={choice === v}
              onClick={() => setChoice(v)}
            >
              {v === 'won' ? 'Won' : 'Lost'}
            </Button>
          ))}
        </div>
      </fieldset>
      {choice === 'won' && (
        <Field>
          <FieldLabel htmlFor="outcome-value">Quoted value in euro (optional)</FieldLabel>
          <Input
            id="outcome-value"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 text-base"
          />
        </Field>
      )}
      {choice === 'lost' && (
        <>
          <Field>
            <FieldLabel htmlFor="outcome-reason">Reason</FieldLabel>
            <NativeSelect
              id="outcome-reason"
              className="w-full [&_select]:h-11 [&_select]:text-base"
              value={reason}
              onChange={(e) => setReason(e.target.value as LostReason)}
            >
              {LOST_REASONS.map(([v, label]) => (
                <NativeSelectOption key={v} value={v}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="outcome-note">
              {reason === 'other' ? 'What happened' : 'Note (optional)'}
            </FieldLabel>
            <Textarea
              id="outcome-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="text-base"
            />
          </Field>
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
      {save.isError && (
        <Alert variant="destructive">
          <AlertDescription>Not saved: {save.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button className="h-10 px-4" disabled={!choice || save.isPending} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save outcome'}
        </Button>
        {current.outcome && (
          <Button
            variant="ghost"
            className="h-10"
            disabled={save.isPending}
            onClick={() => {
              setChoice(null)
              save.mutate({ outcome: 'none' })
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
