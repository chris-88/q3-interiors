import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { SLUG } from '@/lib/campaigns'
import { toApiError } from './errors'

const creativeSchema = z.object({
  id: z.string(),
  label: z.string(),
  slug: z.string(),
  archived_at: z.string().nullable(),
})

const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  utm_source: z.string(),
  utm_medium: z.string(),
  landing_route: z.enum(['/', '/enquire']),
  notes: z.string().nullable(),
  archived_at: z.string().nullable(),
  link_used_at: z.string().nullable(),
  created_at: z.string(),
  campaign_creatives: z.array(creativeSchema),
})

export type Campaign = z.infer<typeof campaignSchema>
export type Creative = z.infer<typeof creativeSchema>

const slugField = (what: string) =>
  z
    .string()
    .trim()
    .min(2, `Enter a ${what}.`)
    .max(60, 'Use at most 60 characters.')
    .regex(SLUG, 'Lower-case letters, digits and single hyphens only, like spring-kitchens.')

export const campaignFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(80, 'Use at most 80 characters.'),
  slug: slugField('link name'),
  utm_source: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+([_-][a-z0-9]+)*$/, 'Lower-case, like instagram.')
    .max(40),
  utm_medium: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+([_-][a-z0-9]+)*$/, 'Lower-case, like paid_social.')
    .max(40),
  landing_route: z.enum(['/', '/enquire']),
  notes: z
    .string()
    .trim()
    .max(1000, 'Use at most 1000 characters.')
    .transform((v) => (v === '' ? null : v)),
})
export type CampaignFormInput = z.input<typeof campaignFormSchema>
export type CampaignFormValues = z.output<typeof campaignFormSchema>

const spendSchema = z.object({
  id: z.string(),
  campaign_id: z.string(),
  spent_on: z.string(),
  amount_cents: z.number().int(),
  note: z.string().nullable(),
  created_by_name: z.string().nullable(),
})
export type SpendEntry = z.infer<typeof spendSchema>

function message(error: { message: string; code?: string }) {
  if (error.code === '23505')
    return toApiError({
      message: 'That link name is already used by another campaign.',
      code: error.code,
    })
  if (error.message.includes('slug in use'))
    return toApiError({
      message: 'Links with this name are already out, so it cannot change.',
      code: '22023',
    })
  return toApiError(error)
}

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: async (): Promise<Campaign[]> => {
      const { data, error } = await supabase
        .from('campaigns')
        .select(
          'id, name, slug, utm_source, utm_medium, landing_route, notes, archived_at, link_used_at, created_at, campaign_creatives(id, label, slug, archived_at)',
        )
        .order('created_at', { ascending: false })
      if (error) throw toApiError(error)
      return z.array(campaignSchema).parse(data)
    },
  })
}

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['campaigns'] })
  void qc.invalidateQueries({ queryKey: ['campaign-costs'] })
  void qc.invalidateQueries({ queryKey: ['checklist'] })
}

export function useSaveCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id?: string
      values: Partial<CampaignFormValues> & { archived_at?: string | null }
    }) => {
      const now = new Date().toISOString()
      const { data, error } = id
        ? await supabase
            .from('campaigns')
            .update({ ...values, updated_at: now })
            .eq('id', id)
            .select('id')
        : await supabase.from('campaigns').insert(values).select('id')
      if (error) throw message(error)
      if (!data || data.length === 0)
        throw toApiError({ message: 'Only an admin can change campaigns.', code: '42501' })
      return (data[0] as { id: string }).id
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useAddCreative() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { campaign_id: string; label: string; slug: string }) => {
      const { error } = await supabase.from('campaign_creatives').insert(input)
      if (error)
        throw error.code === '23505'
          ? toApiError({ message: 'That creative is already listed.', code: error.code })
          : message(error)
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useArchiveCreative() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase
        .from('campaign_creatives')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id)
      if (error) throw toApiError(error)
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useMarkLinkUsed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campaignId: string) => {
      const { error } = await supabase.rpc('mark_campaign_link_used', { p_campaign_id: campaignId })
      if (error) throw toApiError(error)
    },
    onSuccess: () => invalidate(qc),
  })
}

export function useSpend(campaignId: string) {
  return useQuery({
    queryKey: ['campaign-spend', campaignId],
    queryFn: async (): Promise<SpendEntry[]> => {
      const { data, error } = await supabase
        .from('campaign_spend')
        .select('id, campaign_id, spent_on, amount_cents, note, created_by_name')
        .eq('campaign_id', campaignId)
        .order('spent_on', { ascending: false })
      if (error) throw toApiError(error)
      return z.array(spendSchema).parse(data)
    },
  })
}

export function useAddSpend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      campaign_id: string
      spent_on: string
      amount_cents: number
      note: string | null
      created_by_name: string
    }) => {
      const { error } = await supabase.from('campaign_spend').insert(input)
      if (error) throw toApiError(error)
    },
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: ['campaign-spend', input.campaign_id] })
      void qc.invalidateQueries({ queryKey: ['campaign-costs'] })
    },
  })
}

export function useDeleteSpend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entry: SpendEntry) => {
      const { error } = await supabase.from('campaign_spend').delete().eq('id', entry.id)
      if (error) throw toApiError(error)
    },
    onSuccess: (_d, entry) => {
      void qc.invalidateQueries({ queryKey: ['campaign-spend', entry.campaign_id] })
      void qc.invalidateQueries({ queryKey: ['campaign-costs'] })
    },
  })
}

const costSchema = z.object({
  campaign: z.string(),
  name: z.string(),
  spend_cents: z.coerce.number(),
  spend_entries: z.coerce.number(),
})

/** Spend per campaign in the range (admins only; staff never ask). */
export function useCampaignCosts(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ['campaign-costs', from, to],
    enabled: enabled && from !== '' && to !== '' && from <= to,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('campaign_costs', { p_from: from, p_to: to })
      if (error) throw toApiError(error)
      return z.array(costSchema).parse(data)
    },
  })
}
