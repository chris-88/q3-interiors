import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseRows } from '@/lib/tolerant'
import {
  isValidPercent,
  PRICE_MAX,
  PRICE_MIN,
  WORK_MAX,
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
  // The ticked items as sent (empty before 2026-11-29's tick-list); the note may be absent.
  work_items: z.array(z.string()).default([]),
  work_looked_at: z.string().nullable().default(null),
  caveats: z.string().default(''),
  sent_at: z.string(),
  valid_until: z.string(),
  quote_requested_at: z.string().nullable().default(null),
  created_by_name: z.string().nullable().default(null),
  // What it followed (absent before 2026-11-29: a site visit). Unknown values read as a visit.
  after: z
    .string()
    .default('visit')
    .transform((v) => (v === 'call' ? ('call' as const) : ('visit' as const))),
})

export type Estimate = z.infer<typeof estimateSchema>

export const ESTIMATE_COLUMNS =
  'estimates (id, booking_id, price_eur, plus_minus_percent, low_eur, high_eur, work_items, work_looked_at, caveats, sent_at, valid_until, quote_requested_at, created_by_name, after)'

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
  // The optional "Anything else" note; an estimate needs a ticked item or a note.
  work: z.string().trim().max(WORK_MAX, `Keep it under ${WORK_MAX} characters.`),
})

export type EstimateForm = z.input<typeof estimateFormSchema>

/**
 * Send an estimate (`send_estimate`, active staff): on a confirmed site visit, on a call that was
 * attended, or (no booking) on an enquiry whose call was held early.
 */
export function useSendEstimate(enquiryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      bookingId: string | null
      price: number
      percent: number
      work: string
      items: string[]
    }) => {
      const { data, error } = await supabase.rpc('send_estimate', {
        p_booking_id: input.bookingId,
        p_price: input.price,
        p_percent: input.percent,
        p_work: input.work,
        p_items: input.items,
        ...(input.bookingId ? {} : { p_enquiry_id: enquiryId }),
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

// ---------------------------------------------------------------------------------------------
// The tick-list of work items, by project type (null = any job)
// ---------------------------------------------------------------------------------------------

export const WORK_ITEM_MIN = 2
export const WORK_ITEM_MAX = 60

export type WorkItemKind = 'included' | 'excluded'

const workItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  project_type: z.string().nullable(),
  // included: the work (estimate and quote); excluded: the quote's "What's not included".
  kind: z
    .string()
    .default('included')
    .transform((v) => (v === 'excluded' ? ('excluded' as const) : ('included' as const))),
})

export type WorkItem = z.infer<typeof workItemSchema>

/** The items still offered (not removed), in the order they were added. Staff only (RLS). */
export function useWorkItems() {
  return useQuery({
    queryKey: ['estimate-work-items'],
    queryFn: async (): Promise<WorkItem[]> => {
      const { data, error } = await supabase
        .from('estimate_work_items')
        .select('id, label, project_type, kind')
        .is('archived_at', null)
        .order('position', { ascending: true })
      if (error) throw toApiError(error)
      return parseRows(workItemSchema, data, 'work items')
    },
  })
}

/**
 * What the form offers for a project type: that type's items, then the "any job" ones whose
 * label is not already there (case ignored).
 */
export function offeredItems(
  all: WorkItem[],
  projectType: string | null,
  kind: WorkItemKind = 'included',
): WorkItem[] {
  const items = all.filter((i) => (i.kind ?? 'included') === kind)
  const own = projectType ? items.filter((i) => i.project_type === projectType) : []
  const seen = new Set(own.map((i) => i.label.toLowerCase()))
  const any = items.filter((i) => i.project_type === null && !seen.has(i.label.toLowerCase()))
  return [...own, ...any]
}

/** A label as staff typed it, tidied the way the server stores it, or null if it cannot be one. */
export function tidyWorkItem(text: string): string | null {
  const label = text.trim().replace(/\s+/g, ' ')
  return label.length >= WORK_ITEM_MIN && label.length <= WORK_ITEM_MAX ? label : null
}

function useWorkItemMutation<T>(fn: (input: T) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['estimate-work-items'] }),
  })
}

/** Offer a new item next time for this project type (null = any job). */
export function useAddWorkItem() {
  return useWorkItemMutation(
    async (input: { projectType: string | null; label: string; kind?: WorkItemKind }) => {
      const { error } = await supabase.rpc('add_estimate_work_item', {
        p_project_type: input.projectType,
        p_label: input.label,
        ...(input.kind === 'excluded' ? { p_kind: 'excluded' } : {}),
      })
      if (error) throw toApiError(error)
    },
  )
}

/** Stop offering an item; past estimates keep their own copy. */
export function useRemoveWorkItem() {
  return useWorkItemMutation(async (id: string) => {
    const { error } = await supabase.rpc('archive_estimate_work_item', { p_id: id })
    if (error) throw toApiError(error)
  })
}
