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
