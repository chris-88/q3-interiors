import type { StageView } from '@/lib/enquiry-stage'

/**
 * The due chip from the stage model: filled when overdue or due today, outlined when due later,
 * grey for a diary time or a good-until date. The words carry the meaning ("Overdue ·" is
 * visible); colour only repeats it.
 */
export function DueChip({ view }: { view: Pick<StageView, 'chip' | 'urgency' | 'whose'> }) {
  if (!view.chip) return null
  const look =
    view.urgency === 'overdue' || view.urgency === 'today'
      ? 'border-action bg-action text-white'
      : view.urgency === 'later'
        ? 'border-action text-ink'
        : 'border-rule text-muted-foreground font-normal'
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[13px] leading-5 font-medium whitespace-nowrap ${look}`}
    >
      {/* Said in words, not only by the fill. */}
      {view.urgency === 'overdue' && (
        <>
          <span aria-hidden="true">Overdue · </span>
          <span className="sr-only">Overdue: </span>
        </>
      )}
      {view.chip}
    </span>
  )
}
