// Quotes as staff see and send them (send_quote; RLS: active staff only).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { toApiError } from './errors'

export const quoteSchema = z.object({
  id: z.string(),
  estimate_id: z.string().nullable().default(null),
  number: z.string(),
  version: z.coerce.number(),
  price_eur: z.coerce.number(),
  included: z.array(z.string()).default([]),
  excluded: z.array(z.string()).default([]),
  note: z.string().nullable().default(null),
  deposit_percent: z.coerce.number().default(10),
  deposit_eur: z.coerce.number(),
  valid_until: z.string(),
  terms: z.string().default(''),
  sent_at: z.string(),
  created_by_name: z.string().nullable().default(null),
  pdf_path: z.string().nullable().default(null),
  change_requested_at: z.string().nullable().default(null),
  change_request_text: z.string().nullable().default(null),
})

export type Quote = z.infer<typeof quoteSchema>

export const QUOTE_COLUMNS =
  'quotes (id, estimate_id, number, version, price_eur, included, excluded, note, deposit_percent, deposit_eur, valid_until, terms, sent_at, created_by_name, pdf_path, change_requested_at, change_request_text)'

export const QUOTE_NOTE_MAX = 600
export const QUOTE_DEPOSIT_PERCENT = 10

/** The newest version (the current quote), if any. */
export function currentQuote<T extends { version: number }>(quotes: T[] | undefined): T | null {
  return [...(quotes ?? [])].sort((a, b) => b.version - a.version)[0] ?? null
}

/** The deposit on a price, as send_quote stores it (rounded to the euro). */
export const depositOn = (price: number, percent = QUOTE_DEPOSIT_PERCENT) =>
  Math.round((price * percent) / 100)

export function useSendQuote(enquiryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      price: number
      included: string[]
      excluded: string[]
      note: string
      estimateId: string | null
    }) => {
      const { data, error } = await supabase.rpc('send_quote', {
        p_enquiry_id: enquiryId,
        p_price: input.price,
        p_included: input.included,
        p_excluded: input.excluded,
        p_note: input.note.trim() || null,
        p_estimate_id: input.estimateId,
      })
      if (error) throw toApiError(error)
      return z.string().parse(data)
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['enquiries', enquiryId] }),
        queryClient.invalidateQueries({ queryKey: ['enquiries'], exact: true }),
      ]),
  })
}

/** The stored PDF (private bucket, staff read). */
export function useQuotePdf(path: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['quote-pdf', path],
    enabled: enabled && path !== null,
    staleTime: Infinity,
    queryFn: async (): Promise<Blob> => {
      const { data, error } = await supabase.storage.from('quotes').download(path ?? '')
      if (error) throw toApiError({ message: error.message })
      return data
    },
  })
}
