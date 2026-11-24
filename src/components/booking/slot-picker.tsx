import { useMemo, useState } from 'react'
import type { Slot } from '@/api/booking'
import { Button } from '@/components/ui/button'
import { formatClock, formatDayChip, formatLongDate } from '@/lib/format'
import { cn } from '@/lib/utils'

type Props = {
  slots: Slot[]
  selected: Slot | null
  onSelect: (slot: Slot) => void
  /** Day to open on, e.g. the day of the nearest alternative. */
  initialDate?: string
}

/** Days first, then the times on the chosen day. All times are Irish time. */
export function SlotPicker({ slots, selected, onSelect, initialDate }: Props) {
  const days = useMemo(() => {
    const byDate = new Map<string, Slot[]>()
    for (const slot of slots) byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot])
    return [...byDate.entries()]
  }, [slots])
  const [day, setDay] = useState<string | null>(
    selected?.date ?? initialDate ?? days[0]?.[0] ?? null,
  )
  const times = days.find(([date]) => date === day)?.[1] ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* min-w-0: a fieldset otherwise grows to fit the scrolling day list and widens the page. */}
      <fieldset className="min-w-0">
        <legend className="text-base font-medium">Day</legend>
        <ul className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
          {days.map(([date, daySlots]) => {
            const [weekday, dm] = formatDayChip(daySlots[0]?.start ?? date)
            const active = date === day
            return (
              <li key={date}>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={formatLongDate(daySlots[0]?.start ?? date)}
                  onClick={() => setDay(date)}
                  className={cn(
                    'focus-visible:ring-ring/50 flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border text-sm transition-colors focus-visible:ring-3 focus-visible:outline-none',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-muted',
                  )}
                >
                  <span className={active ? '' : 'text-muted-foreground'}>{weekday}</span>
                  <span className="font-medium">{dm}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </fieldset>
      {day && (
        <fieldset className="min-w-0">
          <legend className="text-base font-medium">
            Time on {formatLongDate(times[0]?.start ?? day)}
          </legend>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {times.map((slot) => {
              const active = selected?.start === slot.start
              return (
                <Button
                  key={slot.start}
                  type="button"
                  variant={active ? 'default' : 'outline'}
                  aria-pressed={active}
                  className="h-12 text-base tabular-nums"
                  onClick={() => onSelect(slot)}
                >
                  {formatClock(slot.start)}
                </Button>
              )
            })}
          </div>
        </fieldset>
      )}
    </div>
  )
}
