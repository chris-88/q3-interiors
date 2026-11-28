// A task's draft (an estimate or a quote not yet sent), kept per enquiry on this device until it
// is sent. localStorage only: it never reaches the server or another device, and every read and
// write tolerates storage being unavailable (private windows, cleared data).
import { z } from 'zod'

export type DraftKind = 'estimate' | 'quote'

const PREFIX = 'q3.staff.draft'
const key = (kind: DraftKind, enquiryId: string) => `${PREFIX}.${kind}.${enquiryId}`

/**
 * Every draft records what it was started on (`base`: the current estimate or quote id, or null),
 * so a draft started before another one went out is not offered again.
 */
const envelope = z.object({ base: z.string().nullable(), savedAt: z.string(), values: z.unknown() })

export function readDraft<T>(
  kind: DraftKind,
  enquiryId: string,
  base: string | null,
  schema: z.ZodType<T>,
): T | null {
  try {
    const raw = window.localStorage.getItem(key(kind, enquiryId))
    if (!raw) return null
    const env = envelope.safeParse(JSON.parse(raw))
    if (!env.success || env.data.base !== base) return null
    const values = schema.safeParse(env.data.values)
    return values.success ? values.data : null
  } catch {
    return null
  }
}

export function writeDraft(
  kind: DraftKind,
  enquiryId: string,
  base: string | null,
  values: unknown,
) {
  try {
    window.localStorage.setItem(
      key(kind, enquiryId),
      JSON.stringify({ base, savedAt: new Date().toISOString(), values }),
    )
  } catch {
    // Storage full or blocked: the form still works, the draft is just not kept.
  }
}

export function clearDraft(kind: DraftKind, enquiryId: string) {
  try {
    window.localStorage.removeItem(key(kind, enquiryId))
  } catch {
    // Nothing to do.
  }
}

/** Whether a draft for this enquiry, started on `base`, is waiting on this device. */
export function hasDraft(kind: DraftKind, enquiryId: string, base: string | null): boolean {
  return readDraft(kind, enquiryId, base, z.unknown()) !== null
}

export const estimateDraftSchema = z.object({
  price: z.string(),
  percent: z.string(),
  work: z.string(),
  ticked: z.array(z.string()),
})
export type EstimateDraft = z.infer<typeof estimateDraftSchema>

export const quoteDraftSchema = z.object({
  price: z.string(),
  included: z.array(z.string()),
  excluded: z.array(z.string()),
  note: z.string(),
})
export type QuoteDraft = z.infer<typeof quoteDraftSchema>

/** A draft worth keeping: something typed or ticked beyond the starting values. */
export function draftHasContent(
  values: EstimateDraft | QuoteDraft,
  start: EstimateDraft | QuoteDraft,
) {
  return JSON.stringify(values) !== JSON.stringify(start)
}

const ESTIMATE_ACTIONS = ['write_estimate', 'updated_estimate']
const QUOTE_ACTIONS = ['write_quote', 'revise_quote']

/**
 * The task with a draft waiting on this device, when the stage still offers it: the list says
 * "Draft", the now card "Estimate started, not sent", and the bar "Carry on with the estimate".
 */
export function draftOf(
  e: {
    id: string
    estimates?: { id: string; sent_at: string }[]
    quotes?: { id: string; version: number }[]
  },
  view: { primary: string | null; others: string[] },
): DraftKind | null {
  const offered = (keys: string[]) =>
    keys.some((k) => view.primary === k || view.others.includes(k))
  const estimate = [...(e.estimates ?? [])].sort(
    (a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at),
  )[0]
  if (offered(ESTIMATE_ACTIONS) && hasDraft('estimate', e.id, estimate?.id ?? null))
    return 'estimate'
  const quote = [...(e.quotes ?? [])].sort((a, b) => b.version - a.version)[0]
  if (offered(QUOTE_ACTIONS) && hasDraft('quote', e.id, quote?.id ?? null)) return 'quote'
  return null
}

/**
 * The action that carries on a waiting draft, at any stage that offers it as the primary or among
 * the others (so "Choose the next step" with an estimate started offers "Carry on with the
 * estimate" in the bar). Null without a draft.
 */
export function draftAction(
  view: { primary: string | null; others: string[] },
  draft: DraftKind | null,
): string | null {
  if (!draft) return null
  const keys = draft === 'estimate' ? ESTIMATE_ACTIONS : QUOTE_ACTIONS
  return [view.primary, ...view.others].find((k): k is string => !!k && keys.includes(k)) ?? null
}

/** The action's title while its draft waits: "Carry on with the estimate". */
export function draftTitle(key: string, draft: DraftKind | null): string | null {
  if (draft === 'estimate' && ESTIMATE_ACTIONS.includes(key)) return 'Carry on with the estimate'
  if (draft === 'quote' && QUOTE_ACTIONS.includes(key)) return 'Carry on with the quote'
  return null
}
