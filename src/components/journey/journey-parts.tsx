import { useEffect, useRef, type ReactNode } from 'react'
import { Check, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Pieces shared by the journey's form screens (Project, Details, Time): the progress labels, the
 * compact Back link, the focused heading and the tappable choice cards.
 */

const STEPS = ['Project', 'Details', 'Time'] as const

/** "Project → Details → Time", the current one marked for sight and for screen readers. */
export function JourneyProgress({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Progress" className="flex gap-2">
      {STEPS.map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? 'step' : undefined}
          className="flex min-w-0 flex-1 flex-col gap-1.5"
        >
          <span
            aria-hidden="true"
            className={cn('h-1 rounded-full', index <= current ? 'bg-action' : 'bg-rule')}
          />
          <span
            className={cn(
              'truncate text-sm',
              index === current ? 'text-ink font-medium' : 'text-muted-foreground',
            )}
          >
            {label}
            {index < current && <span className="sr-only"> (done)</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** The compact Back link above the heading. A button: it moves within the journey. */
export function BackLink({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-ink -ml-2 inline-flex min-h-12 items-center gap-1 self-start rounded-sm px-2 text-base underline-offset-4 hover:underline"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {label}
    </button>
  )
}

/** The screen's heading; takes focus when the screen changes so a screen reader starts here. */
export function ScreenHeading({
  children,
  focusKey,
  id,
}: {
  children: ReactNode
  /** Changes when the screen changes; focus moves on change, not on first load. */
  focusKey: string
  id?: string
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo({ top: 0 })
    ref.current?.focus()
  }, [focusKey])
  return (
    <h1
      id={id}
      ref={ref}
      tabIndex={-1}
      className="text-section text-ink font-medium text-balance break-words hyphens-auto outline-none"
    >
      {children}
    </h1>
  )
}

export type ChoiceOption = { value: string; label: string; description?: string }

/**
 * Native radio buttons drawn as tappable cards (48px or more): arrow keys move between them, the
 * selected card shows a check, and `reveal` renders extra questions directly beneath the selected
 * card with a short transition (none when reduced motion is asked for).
 */
export function ChoiceCards({
  name,
  legend,
  legendClassName,
  options,
  value,
  onChange,
  error,
  reveal,
  optional,
  hint,
}: {
  name: string
  legend: ReactNode
  legendClassName?: string
  options: ChoiceOption[]
  value: string | null
  onChange: (value: string) => void
  error?: string
  reveal?: (value: string) => ReactNode
  optional?: boolean
  /** A short line under the question (screen copy, not part of a stored form). */
  hint?: string
}) {
  const errorId = `${name}-error`
  const hintId = `${name}-hint`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')
  return (
    <fieldset
      data-field={name}
      aria-describedby={describedBy || undefined}
      className="flex min-w-0 flex-col gap-2"
    >
      <legend className={cn('text-ink mb-2 text-base font-medium', legendClassName)}>
        {legend}
        {optional && <span className="text-muted-foreground font-normal"> (optional)</span>}
      </legend>
      {hint && (
        <p id={hintId} className="text-muted-foreground -mt-1 mb-1 text-sm">
          {hint}
        </p>
      )}
      {options.map((option) => {
        const id = `${name}-${option.value}`
        const selected = value === option.value
        const extra = selected && reveal ? reveal(option.value) : null
        return (
          <div key={option.value} className="flex flex-col gap-2">
            <label
              htmlFor={id}
              className={cn(
                'relative flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors duration-150 motion-reduce:transition-none',
                'has-[:focus-visible]:outline-action has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-solid',
                selected ? 'border-action bg-soft border-2 px-[15px] py-[11px]' : 'border-input',
                error && !selected && 'border-destructive',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-ink text-base">{option.label}</span>
                {option.description && (
                  <span className="text-muted-foreground text-sm">{option.description}</span>
                )}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-action bg-action text-white' : 'border-input',
                )}
              >
                {selected && <Check className="size-4" />}
              </span>
            </label>
            {extra && (
              <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 border-action ml-4 border-l-2 pt-1 pb-2 pl-4 duration-150">
                {extra}
              </div>
            )}
          </div>
        )
      })}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </fieldset>
  )
}
