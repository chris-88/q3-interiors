import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { call, InvalidLinkError } from './booking'

/**
 * "Get my quote" from the estimate email, through the `public-booking` function with the
 * enquiry's access token. Reading the page records nothing; only the button posts the yes, so a
 * mail scanner that opens the link cannot answer for the customer.
 */
const estimateSchema = z.object({
  low: z.number(),
  high: z.number(),
  // The ticked items and the note; older function responses had only workLookedAt.
  workItems: z.array(z.string()).default([]),
  note: z.string().nullable().default(null),
  workLookedAt: z.string().nullable().optional(),
  sentAt: z.string(),
  validUntil: z.string(),
  quoteRequested: z.boolean(),
})

export type CustomerEstimate = z.infer<typeof estimateSchema>

const key = (token: string, estimateId: string) => ['estimate', token, estimateId]

export function useCustomerEstimate(token: string, estimateId: string) {
  return useQuery({
    queryKey: key(token, estimateId),
    queryFn: () => call({ action: 'estimate', token, estimateId }, estimateSchema),
    retry: (count, error) => !(error instanceof InvalidLinkError) && count < 2,
  })
}

export function useRequestQuote(token: string, estimateId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      call(
        { action: 'request_quote', token, estimateId },
        z.object({ status: z.literal('requested') }),
      ),
    onSuccess: () =>
      queryClient.setQueryData<CustomerEstimate>(key(token, estimateId), (old) =>
        old ? { ...old, quoteRequested: true } : old,
      ),
  })
}
