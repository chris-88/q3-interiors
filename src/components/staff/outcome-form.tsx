import { useState } from 'react'
import { useRecordOutcome } from '@/api/outcomes'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  LOST_REASONS,
  formatEuro,
  irishToday,
  outcomeInputSchema,
  reasonLabel,
  stageLabel,
  type LostReason,
  type OutcomeStage,
} from '@/lib/outcome'
import { isKnown } from '@/lib/tolerant'

export type CurrentOutcome = {
  stage: OutcomeStage | null
  quoteAmount: number | null
  quoteDate: string | null
  wonValue: number | null
  wonDate: string | null
  reason: string | null
  note: string | null
}

type Mode = 'view' | 'quoted' | 'won' | 'lost' | 'clear'

const day = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const formatDay = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`))

const big = 'h-12 w-full text-base sm:w-auto sm:px-6'

function Summary({ current, badge }: { current: CurrentOutcome; badge: boolean }) {
  const lines: string[] = []
  if (current.stage === 'won')
    lines.push(
      current.wonValue !== null
        ? `Won ${formatEuro(current.wonValue)}${current.wonDate ? ` on ${formatDay(current.wonDate)}` : ''}`
        : `Won${current.wonDate ? ` on ${formatDay(current.wonDate)}` : ''} (no value recorded)`,
    )
  if (current.stage === 'lost' && current.reason) lines.push(`Lost: ${reasonLabel(current.reason)}`)
  if (current.quoteAmount !== null && current.quoteDate)
    lines.push(`Quoted ${formatEuro(current.quoteAmount)} on ${formatDay(current.quoteDate)}`)
  return (
    <div className="flex flex-col gap-1">
      {badge && (
        <div>
          <Badge variant={current.stage === 'won' ? 'default' : 'outline'}>
            {stageLabel(current.stage)}
          </Badge>
        </div>
      )}
      {lines.map((line) => (
        <p key={line} className="tabular-nums">
          {line}
        </p>
      ))}
      {current.note && <p className="text-muted-foreground text-sm break-words">{current.note}</p>}
    </div>
  )
}

/** A form's starting values for a stage, from what is already recorded. */
function fieldsFor(next: 'quoted' | 'won' | 'lost', current: CurrentOutcome) {
  if (next === 'quoted')
    return {
      amount: current.quoteAmount !== null ? String(current.quoteAmount) : '',
      on: current.quoteDate ?? irishToday(),
      reason: '' as LostReason | '',
      note: current.stage === 'quoted' ? (current.note ?? '') : '',
    }
  if (next === 'won')
    return {
      amount:
        current.wonValue !== null
          ? String(current.wonValue)
          : current.quoteAmount !== null
            ? String(current.quoteAmount)
            : '',
      on: current.wonDate ?? irishToday(),
      reason: '' as LostReason | '',
      note: current.stage === 'won' ? (current.note ?? '') : '',
    }
  return {
    amount: '',
    on: irishToday(),
    reason:
      current.stage === 'lost' &&
      isKnown(
        LOST_REASONS.map(([v]) => v),
        current.reason,
      )
        ? (current.reason as LostReason)
        : ('' as LostReason | ''),
    note: current.stage === 'lost' ? (current.note ?? '') : '',
  }
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {message}
    </p>
  )
}

/**
 * The outcome after the appointment: record a quote, mark won, mark lost, correct any of them or
 * clear it. One small form at a time, full-width 48px buttons on a phone; the server re-checks
 * everything and records each change in the history.
 */
export function OutcomeForm({
  enquiryId,
  current,
  badge = true,
  primary,
  start,
  onDone,
}: {
  enquiryId: string
  current: CurrentOutcome
  /** Show the stage badge (the enquiry page already shows the stage at the top). */
  badge?: boolean
  /** The one action drawn filled: Record quote after an appointment, Mark won once quoted. */
  primary?: 'quote' | 'won' | 'none'
  /** Open straight at one small form (the actions sheet already asked which). */
  start?: 'quoted' | 'won' | 'lost'
  /** With `start`: called once it is saved or put away. */
  onDone?: () => void
}) {
  const save = useRecordOutcome(enquiryId)
  const first = start ? fieldsFor(start, current) : null
  const [mode, setMode] = useState<Mode>(start ?? 'view')
  const [amount, setAmount] = useState(first?.amount ?? '')
  const [on, setOn] = useState(first?.on ?? irishToday())
  const [reason, setReason] = useState<LostReason | ''>(first?.reason ?? '')
  const [note, setNote] = useState(first?.note ?? '')
  // Opened at one form: saving or cancelling ends it rather than showing the summary and buttons.
  const leave = () => (start && onDone ? onDone() : setMode('view'))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const id = (name: string) => `outcome-${enquiryId}-${name}`

  const open = (next: Mode) => {
    save.reset()
    setErrors({})
    if (next === 'quoted' || next === 'won' || next === 'lost') {
      const f = fieldsFor(next, current)
      setAmount(f.amount)
      setOn(f.on)
      setReason(f.reason)
      setNote(f.note)
    }
    setMode(next)
  }

  const submit = () => {
    const input =
      mode === 'lost'
        ? { stage: 'lost', reason: reason || undefined, note }
        : mode === 'clear'
          ? { stage: 'none' }
          : { stage: mode, amount, on, note }
    const parsed = outcomeInputSchema().safeParse(input)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        next[key] ??= issue.message
      }
      setErrors(next)
      const first = Object.keys(next)[0]
      if (first) document.getElementById(id(first))?.focus()
      return
    }
    setErrors({})
    save.mutate(parsed.data, { onSuccess: leave })
  }

  if (mode === 'view') {
    const has = current.stage !== null
    const filled = primary ?? (current.stage === 'won' ? 'none' : 'won')
    return (
      <div className="flex flex-col gap-4">
        {(badge || has || current.quoteAmount !== null) && (
          <Summary current={current} badge={badge} />
        )}
        {save.isSuccess && (
          <p aria-live="polite" className="text-muted-foreground text-sm">
            Saved.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant={filled === 'quote' ? 'default' : 'outline'}
            className={big}
            onClick={() => open('quoted')}
          >
            {current.quoteAmount !== null ? 'Edit quote' : 'Record quote'}
          </Button>
          <Button
            type="button"
            variant={filled === 'won' ? 'default' : 'outline'}
            className={big}
            onClick={() => open('won')}
          >
            {current.stage === 'won' ? 'Edit win' : 'Mark won'}
          </Button>
          <Button type="button" variant="outline" className={big} onClick={() => open('lost')}>
            {current.stage === 'lost' ? 'Edit loss' : 'Mark lost'}
          </Button>
          {has && (
            <Button
              type="button"
              variant="ghost"
              className={`${big} underline underline-offset-4`}
              onClick={() => open('clear')}
            >
              Clear outcome
            </Button>
          )}
        </div>
      </div>
    )
  }

  const title =
    mode === 'quoted'
      ? 'Quote'
      : mode === 'won'
        ? 'Won'
        : mode === 'lost'
          ? 'Lost'
          : 'Clear the outcome?'

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <h3 className="font-medium">{title}</h3>
      {(mode === 'quoted' || mode === 'won') && (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor={id('amount')} className="font-medium">
              {mode === 'quoted' ? 'Quote amount (€, incl. VAT)' : 'Agreed value (€, incl. VAT)'}
            </label>
            <Input
              id={id('amount')}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? id('amount-error') : undefined}
              className="h-12 text-base md:text-base"
            />
            <FieldError id={id('amount-error')} message={errors.amount} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={id('on')} className="font-medium">
              {mode === 'quoted' ? 'Date quoted' : 'Date won'}
            </label>
            <Input
              id={id('on')}
              type="date"
              max={irishToday()}
              value={on}
              onChange={(e) => setOn(e.target.value)}
              aria-invalid={errors.on ? true : undefined}
              aria-describedby={errors.on ? id('on-error') : undefined}
              className="h-12 text-base md:text-base"
            />
            <FieldError id={id('on-error')} message={errors.on} />
          </div>
        </>
      )}
      {mode === 'lost' && (
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={errors.reason ? id('reason-error') : undefined}
        >
          <legend className="mb-1 font-medium">Why was it lost?</legend>
          {LOST_REASONS.map(([value, label]) => (
            <label
              key={value}
              className="border-edge has-[:checked]:border-action has-[:checked]:bg-soft flex min-h-12 items-center gap-3 rounded-md border px-3"
            >
              <input
                type="radio"
                name={id('reason')}
                id={value === LOST_REASONS[0][0] ? id('reason') : undefined}
                className="size-5"
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {label}
            </label>
          ))}
          <FieldError id={id('reason-error')} message={errors.reason} />
        </fieldset>
      )}
      {mode !== 'clear' && (
        <div className="flex flex-col gap-2">
          <label htmlFor={id('note')} className="font-medium">
            Note{' '}
            <span className="text-muted-foreground font-normal">
              {mode === 'lost' && reason === 'other' ? '(say why)' : '(optional)'}
            </span>
          </label>
          <Textarea
            id={id('note')}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? id('note-error') : undefined}
            className="text-base md:text-base"
          />
          <FieldError id={id('note-error')} message={errors.note} />
        </div>
      )}
      {mode === 'clear' && (
        <p className="text-sm">
          This removes the quote, win or loss recorded here. The history keeps what was recorded.
        </p>
      )}
      {save.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>That was not saved. Check the details and try again.</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" className={big} disabled={save.isPending}>
          {save.isPending
            ? 'Saving…'
            : mode === 'quoted'
              ? 'Save quote'
              : mode === 'won'
                ? 'Save as won'
                : mode === 'lost'
                  ? 'Save as lost'
                  : 'Clear outcome'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={big}
          disabled={save.isPending}
          onClick={leave}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
