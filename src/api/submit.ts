import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import type { AnswerValue } from '@/forms/types'
import type { Attribution } from '@/lib/attribution'
import { supabase } from '@/lib/supabase'
import { ApiError, toApiError } from './errors'

export type SubmitEnquiryInput = {
  idempotencyKey: string
  formId: string
  formVersion: number
  answers: Record<string, AnswerValue>
  marketingOptIn: boolean
  attribution: Attribution | null
}

const referenceSchema = z.string().regex(/^Q3-[A-Z0-9]{6}$/)

/** Saves an enquiry through `submit_enquiry`. Resolves to the customer-facing reference. */
export async function submitEnquiry(input: SubmitEnquiryInput): Promise<string> {
  const { data, error } = await supabase.rpc('submit_enquiry', {
    p_idempotency_key: input.idempotencyKey,
    p_form_id: input.formId,
    p_form_version: input.formVersion,
    p_answers: input.answers,
    p_marketing_opt_in: input.marketingOptIn,
    p_attribution: input.attribution,
  })
  if (error) throw toApiError(error)
  const parsed = referenceSchema.safeParse(data)
  if (!parsed.success) throw new ApiError('Unexpected response from submit_enquiry')
  return parsed.data
}

export function useSubmitEnquiry() {
  // No automatic retry: the customer sees the failure and retries with the same key.
  return useMutation({ mutationFn: submitEnquiry, retry: false })
}
