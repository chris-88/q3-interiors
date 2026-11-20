import { Button } from '@/components/ui/button'
import { formatAnswer, visibleFields } from '@/forms/logic'
import type { Answers, FormDefinition } from '@/forms/types'
import { cn } from '@/lib/utils'

type Props = {
  form: FormDefinition
  answers: Answers
  marketingOptIn: boolean
  onEdit: (stepIndex: number) => void
  className?: string
}

/** Every answer, grouped by step, each group with a button back to that step. */
export function ReviewStep({ form, answers, marketingOptIn, onEdit, className }: Props) {
  return (
    <div className={cn('flex flex-col divide-y rounded-xl border', className)}>
      {form.steps.map((step, index) => {
        const fields = visibleFields(step.fields, answers)
        if (fields.length === 0) return null
        const isContact = step.fields.some((f) => f.type === 'email')
        const headingId = `review-${step.id}`
        return (
          <section key={step.id} aria-labelledby={headingId} className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 id={headingId} className="text-muted-foreground text-sm font-medium">
                {step.title}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-mt-1 -mr-2 h-9 px-3"
                onClick={() => onEdit(index)}
                aria-label={`Change: ${step.title}`}
              >
                Change
              </Button>
            </div>
            <dl className="flex flex-col gap-3">
              {fields.map((field) => (
                <div key={field.id} className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground text-sm">{field.label}</dt>
                  <dd className="text-base break-words whitespace-pre-line">
                    {formatAnswer(field, answers[field.id]) ?? (
                      <span className="text-muted-foreground">Not answered</span>
                    )}
                  </dd>
                </div>
              ))}
              {isContact && (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground text-sm">News and offers</dt>
                  <dd className="text-base">{marketingOptIn ? 'Yes, please' : 'No, thanks'}</dd>
                </div>
              )}
            </dl>
          </section>
        )
      })}
    </div>
  )
}
