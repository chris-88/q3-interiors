import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import {
  isValidPercent,
  PRICE_MAX,
  PRICE_MIN,
  WORK_MAX,
  WORK_MIN,
} from '../../supabase/functions/_shared/estimate.ts'
import { toApiError } from './errors'

/** An estimate as staff read it (RLS: active staff only). */
export const estimateSchema = z.object({
  id: z.string(),
  booking_id: z.string().nullable().default(null),
  price_eur: z.coerce.number(),
  plus_minus_percent: z.coerce.number(),
  low_eur: z.coerce.number(),
  high_eur: z.coerce.number(),
  work_looked_at: z.string(),
  caveats: z.string().default(''),
  sent_at: z.string(),
  valid_until: z.string(),
  quote_requested_at: z.string().nullable().default(null),
  created_by_name: z.string().nullable().default(null),
})

export type Estimate = z.infer<typeof estimateSchema>

export const ESTIMATE_COLUMNS =
  'estimates (id, booking_id, price_eur, plus_minus_percent, low_eur, high_eur, work_looked_at, caveats, sent_at, valid_until, quote_requested_at, created_by_name)'

/** "9500", "9,500" and "€9,500" are all 9500; anything else is null. */
export function parsePrice(text: string): number | null {
  const clean = text.replace(/[€,\s]/g, '')
  if (!/^\d+$/.test(clean)) return null
  return Number(clean)
}

/** The form, checked the way the server checks it (send_estimate). */
export const estimateFormSchema = z.object({
  price: z.string().transform((v, ctx) => {
    const n = parsePrice(v)
    if (n === null || n < PRICE_MIN || n > PRICE_MAX) {
      ctx.addIssue({
        code: 'custom',
        message: `Enter the price in whole euro, at least €${PRICE_MIN}.`,
      })
      return z.NEVER
    }
    return n
  }),
  percent: z.coerce
    .number()
    .refine(isValidPercent, 'Choose a plus-or-minus from 0 to 30 in half steps.'),
  work: z
    .string()
    .trim()
    .min(WORK_MIN, 'Say what work you looked at.')
    .max(WORK_MAX, `Keep it under ${WORK_MAX} characters.`),
})

export type EstimateForm = z.input<typeof estimateFormSchema>

/** Send an estimate on a confirmed site visit (`send_estimate`, active staff). */
export function useSendEstimate(enquiryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      bookingId: string
      price: number
      percent: number
      work: string
    }) => {
      const { data, error } = await supabase.rpc('send_estimate', {
        p_booking_id: input.bookingId,
        p_price: input.price,
        p_percent: input.percent,
        p_work: input.work,
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
