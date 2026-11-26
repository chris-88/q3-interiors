import { z } from 'zod'

/*
 * The commercial outcome of an enquiry after the appointment (slice 7): none yet, quoted (amount
 * in euro incl. VAT, and date), won (agreed value and date), lost (reason, optional note). Stored
 * on the enquiry (the spine a future job record will hang off); written only by
 * `record_enquiry_outcome`, every change in the enquiry history.
 */

export const OUTCOME_STAGES = ['quoted', 'won', 'lost'] as const
export type OutcomeStage = (typeof OUTCOME_STAGES)[number]

export const STAGE_LABELS: Record<OutcomeStage, string> = {
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
}

/** Reasons offered for a new loss. */
export const LOST_REASONS = [
  ['price', 'Price'],
  ['timing', 'Timing'],
  ['chose_another', 'Went elsewhere'],
  ['no_response', 'No response'],
  ['not_a_fit', 'Not a fit for us'],
  ['other', 'Other'],
] as const
export type LostReason = (typeof LOST_REASONS)[number][0]

/** Labels for every reason that may be stored, including retired ones. */
const REASON_LABELS: Record<string, string> = {
  ...Object.fromEntries(LOST_REASONS),
  project_cancelled: 'Project cancelled or postponed',
}

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
}

export function stageLabel(stage: string | null): string {
  if (stage === null) return 'No outcome yet'
  return (STAGE_LABELS as Record<string, string>)[stage] ?? stage
}

const euro = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

export function formatEuro(value: number): string {
  return euro.format(value)
}

/**
 * A euro amount as typed: "18450", "18,450.50", "€18 450", "18450.5". Null when it is not a
 * positive amount with at most two decimals.
 */
export function parseEuro(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return value > 0 && value < 10_000_000_000 ? value : null
}

/** Today in Irish time, YYYY-MM-DD. */
export function irishToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(now)
}

const amountAndDate = (now: Date) => ({
  amount: z.string().transform((v, ctx) => {
    const value = parseEuro(v)
    if (value === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter the amount in euro, for example 18,450.' })
      return z.NEVER
    }
    return value
  }),
  on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date.')
    .refine((d) => d <= irishToday(now), 'The date cannot be in the future.')
    .refine((d) => d >= '2020-01-01', 'Choose a date from 2020 on.'),
  note: z.string().trim().max(500, 'Keep the note under 500 characters.'),
})

/** What the form sends for each action; validated before the call, checked again by the server. */
export function outcomeInputSchema(now: Date = new Date()) {
  return z.discriminatedUnion('stage', [
    z.object({ stage: z.literal('quoted'), ...amountAndDate(now) }),
    z.object({ stage: z.literal('won'), ...amountAndDate(now) }),
    z
      .object({
        stage: z.literal('lost'),
        reason: z.enum(LOST_REASONS.map(([v]) => v) as [LostReason, ...LostReason[]], {
          error: 'Choose a reason.',
        }),
        note: z.string().trim().max(500, 'Keep the note under 500 characters.'),
      })
      .refine((v) => v.reason !== 'other' || v.note.length > 0, {
        path: ['note'],
        message: 'Say why it was lost.',
      }),
    z.object({ stage: z.literal('none') }),
  ])
}
export type OutcomeInput = z.output<ReturnType<typeof outcomeInputSchema>>
