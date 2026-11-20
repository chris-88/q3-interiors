import { z } from 'zod'
import type { Answers } from '@/forms/types'
import { readJson, type SafeStorage } from './storage'

/**
 * The customer's in-progress enquiry, kept in sessionStorage so answers survive going back, a
 * reload, or the in-app browser being backgrounded. It holds the idempotency key for the
 * submission: the key is created on the first submit attempt and kept until the save succeeds,
 * so a double tap, a retry after a network error, or a retry after a reload all reach the same
 * enquiry on the server.
 */

const DRAFT_KEY = 'q3.enquiry.draft'
const SUBMITTED_KEY = 'q3.enquiry.submitted'

const draftSchema = z.object({
  formId: z.string(),
  version: z.number().int(),
  step: z.number().int().min(0),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  marketingOptIn: z.boolean(),
  idempotencyKey: z.uuid().nullable(),
})

export type Draft = z.infer<typeof draftSchema>

export function emptyDraft(formId: string, version: number): Draft {
  return { formId, version, step: 0, answers: {}, marketingOptIn: false, idempotencyKey: null }
}

/** The stored draft for this form version, or a fresh one. */
export function loadDraft(storage: SafeStorage, formId: string, version: number): Draft {
  const parsed = draftSchema.safeParse(readJson(storage, DRAFT_KEY))
  if (!parsed.success || parsed.data.formId !== formId || parsed.data.version !== version) {
    return emptyDraft(formId, version)
  }
  return parsed.data
}

export function saveDraft(storage: SafeStorage, draft: Draft): void {
  storage.set(DRAFT_KEY, JSON.stringify(draft))
}

export function clearDraft(storage: SafeStorage): void {
  storage.remove(DRAFT_KEY)
}

/** Answers without undefined entries, ready to store. */
export function definedAnswers(answers: Answers): Draft['answers'] {
  const out: Draft['answers'] = {}
  for (const [key, value] of Object.entries(answers)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * The idempotency key for submitting this draft. Returns the existing key, or creates one and
 * persists it before the request goes out, so a reload mid-request still retries with it.
 */
export function ensureIdempotencyKey(
  storage: SafeStorage,
  draft: Draft,
  newKey: () => string = () => crypto.randomUUID(),
): { draft: Draft; key: string } {
  if (draft.idempotencyKey) return { draft, key: draft.idempotencyKey }
  const key = newKey()
  const next = { ...draft, idempotencyKey: key }
  saveDraft(storage, next)
  return { draft: next, key }
}

/** After a successful save: forget the draft (and its key) and remember the reference. */
export function completeSubmission(storage: SafeStorage, reference: string): void {
  clearDraft(storage)
  storage.set(SUBMITTED_KEY, JSON.stringify({ reference }))
}

export function readSubmittedReference(storage: SafeStorage): string | null {
  const parsed = z.object({ reference: z.string() }).safeParse(readJson(storage, SUBMITTED_KEY))
  return parsed.success ? parsed.data.reference : null
}

export function clearSubmitted(storage: SafeStorage): void {
  storage.remove(SUBMITTED_KEY)
}
