import { useState } from 'react'
import { useAddSpend, useDeleteSpend, useSpend } from '@/api/campaigns'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatEuroCents, parseEuro } from '@/lib/campaigns'

function todayDublin(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date())
}

/** Spend for one campaign: the entries, the total, and a form to add a day (admins only). */
export function CampaignSpend({ campaignId }: { campaignId: string }) {
  const me = useCurrentStaff()
  const spend = useSpend(campaignId)
  const add = useAddSpend()
  const remove = useDeleteSpend()
  const [day, setDay] = useState(todayDublin)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const id = `spend-${campaignId.slice(0, 8)}`
  const total = (spend.data ?? []).reduce((sum, s) => sum + s.amount_cents, 0)
  return (
    <div className="flex flex-col gap-2">
      {spend.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : spend.isError ? (
        <p role="alert" className="text-destructive text-sm">
          Could not load spend.
        </p>
      ) : spend.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No spend entered yet. The report shows “No spend entered” until you add some.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Total so far: <span className="font-medium tabular-nums">{formatEuroCents(total)}</span>
          </p>
          <ul className="flex flex-col gap-1">
            {spend.data.map((s) => (
              <li
                key={s.id}
                className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1 text-sm"
              >
                <span className="tabular-nums">
                  {s.spent_on} · {formatEuroCents(s.amount_cents)}
                  {s.note ? ` · ${s.note}` : ''}
                </span>
                <Button
                  variant="ghost"
                  className="h-12"
                  onClick={() => remove.mutate(s)}
                  aria-label={`Remove spend of ${formatEuroCents(s.amount_cents)} on ${s.spent_on}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form
        noValidate
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          const cents = parseEuro(amount)
          if (!day) return setProblem('Choose the day.')
          if (cents === null) return setProblem('Enter an amount in euro, like 125 or 125.50.')
          setProblem(null)
          add.mutate(
            {
              campaign_id: campaignId,
              spent_on: day,
              amount_cents: cents,
              note: note.trim() || null,
              created_by_name: me.display_name,
            },
            {
              onSuccess: () => {
                setAmount('')
                setNote('')
              },
            },
          )
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-day`} className="text-sm font-medium">
            Day
          </label>
          <Input
            id={`${id}-day`}
            type="date"
            className="h-12 min-w-0 text-base"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-amount`} className="text-sm font-medium">
            Amount (€)
          </label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            className="h-12 min-w-0 text-base"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-error` : undefined}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-note`} className="text-sm font-medium">
            Note (optional)
          </label>
          <Input
            id={`${id}-note`}
            className="h-12 min-w-0 text-base"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {(problem ?? add.isError) && (
          <p id={`${id}-error`} role="alert" className="text-destructive text-sm sm:col-span-3">
            {problem ?? 'Not saved. Please try again.'}
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          className="h-12 sm:col-span-3"
          disabled={add.isPending}
        >
          {add.isPending ? 'Adding…' : 'Add spend'}
        </Button>
      </form>
    </div>
  )
}
