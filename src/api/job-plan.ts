// The job plan's reads and writes (staff only; migration 20261201100000_job_plan). Reads are plain
// table reads under RLS, joined here; every write is one of the security-definer functions.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseRows } from '@/lib/tolerant'
import type { PlanLine, PlanStage, Product, Tradesperson } from '@/lib/job-plan'
import { toApiError } from './errors'

const stageSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.coerce.number(),
  done_at: z.string().nullable().default(null),
  tradesperson_id: z.string().nullable().default(null),
}) satisfies z.ZodType<PlanStage>

const lineSchema = z.object({
  id: z.string(),
  stage_id: z.string(),
  product_id: z.string().nullable().default(null),
  name: z.string(),
  quantity: z.coerce.number(),
  unit: z.string(),
  price_cents: z.coerce.number(),
  got_at: z.string().nullable().default(null),
  position: z.coerce.number(),
}) satisfies z.ZodType<PlanLine>

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  price_cents: z.coerce.number(),
  supplier: z.string().nullable().default(null),
  archived_at: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  supplier_sku: z.string().nullable().default(null),
  source_url: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  supplier_price_cents: z.coerce.number().nullable().default(null),
  price_edited_at: z.string().nullable().default(null),
  uses: z.coerce.number().default(0),
  total: z.coerce.number().default(0),
}) satisfies z.ZodType<Product & { total: number }>

const tradespersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  trade: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  archived_at: z.string().nullable().default(null),
}) satisfies z.ZodType<Tradesperson>

const templateSchema = z.object({
  project_type: z.string().nullable().default(null),
  name: z.string(),
})

export type JobPlan = { stages: PlanStage[]; lines: PlanLine[] }

const planKey = (enquiryId: string) => ['job-plan', enquiryId] as const

export function useJobPlan(enquiryId: string, enabled = true) {
  return useQuery({
    queryKey: planKey(enquiryId),
    enabled,
    queryFn: async (): Promise<JobPlan> => {
      const [stages, lines] = await Promise.all([
        supabase
          .from('job_stages')
          .select('id, name, position, done_at, tradesperson_id')
          .eq('enquiry_id', enquiryId)
          .order('position', { ascending: true }),
        supabase
          .from('job_materials')
          .select('id, stage_id, product_id, name, quantity, unit, price_cents, got_at, position')
          .eq('enquiry_id', enquiryId)
          .order('position', { ascending: true }),
      ])
      if (stages.error) throw toApiError(stages.error)
      if (lines.error) throw toApiError(lines.error)
      return {
        stages: parseRows(stageSchema, stages.data, 'plan stages'),
        lines: parseRows(lineSchema, lines.data, 'plan materials'),
      }
    },
  })
}

/** The stage list a new plan starts with for a job type (else the any-job one). */
export function useStageTemplate(projectType: string | null, enabled = true) {
  return useQuery({
    queryKey: ['stage-templates'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stage_templates')
        .select('project_type, name')
        .order('position', { ascending: true })
      if (error) throw toApiError(error)
      return parseRows(templateSchema, data, 'stage templates')
    },
    select: (rows) => {
      const own = rows.filter((r) => r.project_type === projectType)
      return (own.length ? own : rows.filter((r) => r.project_type === null)).map((r) => r.name)
    },
  })
}

/** "mine_used" (the default list), "mine", "used", "all", or a supplier's slug ("goodwins"). */
export type ProductFilter = string

async function findProducts(
  query: string,
  filter: ProductFilter,
  limit: number,
  offset: number,
  archived = false,
) {
  const { data, error } = await supabase.rpc('find_products', {
    p_query: query,
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
    p_archived: archived,
  })
  if (error) throw toApiError(error)
  return parseRows(productSchema, data, 'products')
}

/**
 * What "Add item" offers for what he has typed: searched on the server (every word, any order,
 * or the SKU), used-on-a-job first, then his own, then the catalogue. Nothing under 2 letters.
 */
export function useProductSearch(query: string) {
  const q = query.trim().replace(/\s+/g, ' ')
  return useQuery({
    queryKey: ['products', 'search', q],
    enabled: q.length >= 2,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    queryFn: () => findProducts(q, 'all', 6, 0),
  })
}

const PAGE = 50

/** Settings > Product list: a page at a time, filtered and searched on the server. */
export function useProductBrowse(filter: ProductFilter, query: string, archived: boolean) {
  const q = query.trim().replace(/\s+/g, ' ')
  return useInfiniteQuery({
    queryKey: ['products', 'browse', filter, q, archived],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => findProducts(q, filter, PAGE, pageParam, archived),
    getNextPageParam: (last, pages) => {
      const seen = pages.reduce((n, p) => n + p.length, 0)
      const total = last[0]?.total ?? 0
      return last.length === PAGE && seen < total ? seen : undefined
    },
  })
}

export function useTradespeople(enabled = true) {
  return useQuery({
    queryKey: ['tradespeople'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tradespeople')
        .select('id, name, trade, phone, archived_at')
        .order('name', { ascending: true })
      if (error) throw toApiError(error)
      return parseRows(tradespersonSchema, data, 'tradespeople')
    },
  })
}

/** Call a plan function; afterwards the plan, the product list and the people are read again. */
async function call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw toApiError(error)
  return data as T
}

function usePlanMutation<I, O = unknown>(enquiryId: string | null, run: (input: I) => Promise<O>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: async () => {
      await Promise.all([
        enquiryId ? client.invalidateQueries({ queryKey: planKey(enquiryId) }) : null,
        enquiryId ? client.invalidateQueries({ queryKey: ['enquiries', enquiryId] }) : null,
        client.invalidateQueries({ queryKey: ['products'] }),
        client.invalidateQueries({ queryKey: ['tradespeople'] }),
      ])
    },
  })
}

export const useStartPlan = (enquiryId: string) =>
  usePlanMutation(enquiryId, () => call<number>('start_job_plan', { p_enquiry_id: enquiryId }))

export const useAddStage = (enquiryId: string) =>
  usePlanMutation(enquiryId, (name: string) =>
    call<string>('add_job_stage', { p_enquiry_id: enquiryId, p_name: name }),
  )

export const useRenameStage = (enquiryId: string) =>
  usePlanMutation(enquiryId, (i: { stageId: string; name: string }) =>
    call('rename_job_stage', { p_stage_id: i.stageId, p_name: i.name }),
  )

export const useMoveStage = (enquiryId: string) =>
  usePlanMutation(enquiryId, (i: { stageId: string; by: -1 | 1 }) =>
    call('move_job_stage', { p_stage_id: i.stageId, p_by: i.by }),
  )

export const useRemoveStage = (enquiryId: string) =>
  usePlanMutation(enquiryId, (stageId: string) => call('remove_job_stage', { p_stage_id: stageId }))

export const useStageDone = (enquiryId: string) =>
  usePlanMutation(enquiryId, (i: { stageId: string; done: boolean }) =>
    call('set_job_stage_done', { p_stage_id: i.stageId, p_done: i.done }),
  )

export const useStageTradesperson = (enquiryId: string) =>
  usePlanMutation(enquiryId, (i: { stageId: string; tradespersonId: string | null }) =>
    call('set_job_stage_tradesperson', {
      p_stage_id: i.stageId,
      p_tradesperson_id: i.tradespersonId,
    }),
  )

export type TradespersonInput = { name: string; trade: string; phone: string }

export const useAddTradesperson = (enquiryId: string | null = null) =>
  usePlanMutation(enquiryId, (i: TradespersonInput) =>
    call<string>('add_tradesperson', { p_name: i.name, p_trade: i.trade, p_phone: i.phone }),
  )

export const useUpdateTradesperson = () =>
  usePlanMutation(null, (i: TradespersonInput & { id: string }) =>
    call('update_tradesperson', {
      p_id: i.id,
      p_name: i.name,
      p_trade: i.trade,
      p_phone: i.phone,
    }),
  )

export const useArchiveTradesperson = () =>
  usePlanMutation(null, (i: { id: string; archived: boolean }) =>
    call('archive_tradesperson', { p_id: i.id, p_archived: i.archived }),
  )

export type ProductInput = { name: string; unit: string; priceCents: number; supplier: string }

export const useAddProduct = (enquiryId: string | null = null) =>
  usePlanMutation(enquiryId, (i: ProductInput) =>
    call<string>('add_product', {
      p_name: i.name,
      p_unit: i.unit,
      p_price_cents: i.priceCents,
      p_supplier: i.supplier,
    }),
  )

export const useUpdateProduct = () =>
  usePlanMutation(null, (i: ProductInput & { id: string }) =>
    call('update_product', {
      p_id: i.id,
      p_name: i.name,
      p_unit: i.unit,
      p_price_cents: i.priceCents,
      p_supplier: i.supplier,
    }),
  )

export const useArchiveProduct = () =>
  usePlanMutation(null, (i: { id: string; archived: boolean }) =>
    call('archive_product', { p_id: i.id, p_archived: i.archived }),
  )

export const useAddLine = (enquiryId: string) =>
  usePlanMutation(enquiryId, (i: { stageId: string; productId: string }) =>
    call<string>('add_job_material', { p_stage_id: i.stageId, p_product_id: i.productId }),
  )

export const useUpdateLine = (enquiryId: string) =>
  usePlanMutation(
    enquiryId,
    (i: { lineId: string; quantity: number; unit: string; priceCents: number }) =>
      call('update_job_material', {
        p_line_id: i.lineId,
        p_quantity: i.quantity,
        p_unit: i.unit,
        p_price_cents: i.priceCents,
      }),
  )

export const useLineGot = (enquiryId: string) =>
  usePlanMutation(enquiryId, (i: { lineId: string; got: boolean }) =>
    call('set_job_material_got', { p_line_id: i.lineId, p_got: i.got }),
  )

export const useRemoveLine = (enquiryId: string) =>
  usePlanMutation(enquiryId, (lineId: string) => call('remove_job_material', { p_line_id: lineId }))
