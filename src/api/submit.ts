import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import type { AnswerValue } from '@/forms/types'
import type { Attribution } from '@/lib/attribution'
import { supabase } from '@/lib/supabase'
import { ApiError, RateLimitedError, toApiError } from './errors'

export type SubmitEnquiryInput = {
  idempotencyKey: string
  formId: string
  formVersion: number
  answers: Record<string, AnswerValue>
  marketingOptIn: boolean
  attribution: Attribution | null
  /** The hidden honeypot field; anything in it means a bot. */
  trap: string
}

const submittedSchema = z.object({
  reference: z.string().regex(/^Q3-[A-Z0-9]{6}$/),
  // Null when the server treated the submission as a bot (honeypot): a normal-looking reply.
  access_token: z.string().min(20).nullable(),
  expires_at: z.string().nullable(),
})

export type SubmittedEnquiry = { reference: string; accessToken: string | null }

/**
 * Saves an enquiry through `submit_enquiry_with_access`. Resolves to the customer-facing
 * reference and an access token that lets this browser schedule against this enquiry only.
 */
export async function submitEnquiry(input: SubmitEnquiryInput): Promise<SubmittedEnquiry> {
  const { data, error } = await supabase.rpc('submit_enquiry_with_access', {
    p_idempotency_key: input.idempotencyKey,
    p_form_id: input.formId,
    p_form_version: input.formVersion,
    p_answers: input.answers,
    p_marketing_opt_in: input.marketingOptIn,
    p_attribution: input.attribution,
    p_trap: input.trap || null,
  })
  if (error) {
    if (error.code === 'PT429' || error.message === 'rate_limited') throw new RateLimitedError()
    throw toApiError(error)
  }
  const parsed = submittedSchema.safeParse(data)
  if (!parsed.success) throw new ApiError('Unexpected response from submit_enquiry_with_access')
  return { reference: parsed.data.reference, accessToken: parsed.data.access_token }
}

export function useSubmitEnquiry() {
  // No automatic retry: the customer sees the failure and retries with the same key.
  return useMutation({ mutationFn: submitEnquiry, retry: false })
}
