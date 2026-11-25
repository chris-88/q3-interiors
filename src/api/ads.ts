import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { toApiError } from './errors'

export const AD_STATUS_LABELS = {
  new: 'New',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  archived: 'Archived',
} as const

const status = z.enum(['new', 'changes_requested', 'approved', 'archived'])

const variantSchema = z.object({
  id: z.string(),
  size: z.enum(['portrait', 'vertical', 'square']),
  width: z.number(),
  height: z.number(),
  html_path: z.string(),
  export_path: z.string(),
  export_bytes: z.number().nullable(),
})

const versionSchema = z.object({
  id: z.string(),
  version: z.number(),
  caption: z.string(),
  headline: z.string().nullable(),
  button_label: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  approved_at: z.string().nullable().default(null),
  approved_by_name: z.string().nullable().default(null),
  ad_variants: z.array(variantSchema),
})

export const REQUEST_SIZES = {
  both: 'Both sizes',
  portrait: 'Feed 4:5',
  vertical: 'Stories and Reels 9:16',
  square: 'Square',
} as const

const requestSchema = z.object({
  id: z.string(),
  version_id: z.string(),
  size: z.enum(['both', 'portrait', 'vertical', 'square']),
  body: z.string(),
  state: z.enum(['open', 'done', 'withdrawn']),
  done_in_version: z.number().nullable(),
  created_by: z.string().nullable(),
  created_by_name: z.string(),
  created_at: z.string(),
})

export type AdRequest = z.infer<typeof requestSchema>

const creativeSchema = z
  .object({
    label: z.string(),
    slug: z.string(),
    campaigns: z
      .object({
        name: z.string(),
        slug: z.string(),
        utm_source: z.string(),
        utm_medium: z.string(),
        landing_route: z.enum(['/', '/enquire']),
      })
      .nullable(),
  })
  .nullable()

const adSchema = z.object({
  id: z.string(),
  name: z.string(),
  status,
  created_at: z.string(),
  created_by_name: z.string().nullable(),
  campaign_creatives: creativeSchema,
  ad_versions: z.array(versionSchema),
  ad_requests: z.array(requestSchema).default([]),
})

export type Ad = z.infer<typeof adSchema>
export type AdVersion = z.infer<typeof versionSchema>
export type AdVariant = z.infer<typeof variantSchema>

const listSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    status,
    created_at: z.string(),
    ad_versions: z.array(z.object({ version: z.number() })),
    ad_requests: z.array(z.object({ state: z.string() })).default([]),
  }),
)

export type AdListItem = z.infer<typeof listSchema>[number]

export function useAds() {
  return useQuery({
    queryKey: ['ads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ads')
        .select('id, name, status, created_at, ad_versions(version), ad_requests(state)')
        .order('created_at', { ascending: false })
      if (error) throw toApiError(error)
      return listSchema.parse(data)
    },
  })
}

export function useAd(id: string) {
  return useQuery({
    queryKey: ['ad', id],
    queryFn: async (): Promise<Ad | null> => {
      const { data, error } = await supabase
        .from('ads')
        .select(
          'id, name, status, created_at, created_by_name, campaign_creatives(label, slug, campaigns(name, slug, utm_source, utm_medium, landing_route)), ad_versions(id, version, caption, headline, button_label, notes, created_at, approved_at, approved_by_name, ad_variants(id, size, width, height, html_path, export_path, export_bytes)), ad_requests(id, version_id, size, body, state, done_in_version, created_by, created_by_name, created_at)',
        )
        .eq('id', id)
        .maybeSingle()
      if (error) throw toApiError(error)
      return data === null ? null : adSchema.parse(data)
    },
  })
}

/** The newest version of an ad (part B adds more). */
export function latestVersion(ad: Ad): AdVersion | null {
  return [...ad.ad_versions].sort((a, b) => b.version - a.version)[0] ?? null
}

/** A file from the private `ads` bucket, read with the staff member's own session. */
export function useAdHtml(path: string | undefined) {
  return useQuery({
    queryKey: ['ad-file', path],
    enabled: path !== undefined,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('ads').download(path ?? '')
      if (error) throw toApiError({ message: error.message })
      return data.text()
    },
  })
}

export async function downloadAdFile(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from('ads').download(path)
  if (error) throw toApiError({ message: error.message })
  return data
}

/** How many ads wait for review (status new): one count query, refreshed when the tab regains focus. */
export function useAdsWaitingCount() {
  return useQuery({
    queryKey: ['ads-waiting'],
    staleTime: 0,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('ads')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new')
      if (error) throw toApiError(error)
      return count ?? 0
    },
  })
}

/** Plain words for the server's refusals. */
export function adErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not allowed')) return 'Only an admin can do that.'
  if (message.includes('open requests')) return 'There are open change requests on this version.'
  if (message.includes('not the current version'))
    return 'A newer version has been published. Reload the page.'
  if (message.includes('archived')) return 'This ad is archived.'
  if (message.includes('request length')) return 'Write between 3 and 1,000 characters.'
  if (message.includes('request not open')) return 'That request is no longer open.'
  return 'That did not work. Please try again.'
}

function useAdMutation<T>(fn: (input: T) => Promise<void>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ad'] })
      void qc.invalidateQueries({ queryKey: ['ads'] })
      void qc.invalidateQueries({ queryKey: ['ads-waiting'] })
    },
  })
}

export const REQUEST_MAX = 1000

export function useRequestChange() {
  return useAdMutation(async (input: { adId: string; body: string; size: AdRequest['size'] }) => {
    const { error } = await supabase.rpc('request_ad_change', {
      p_ad_id: input.adId,
      p_body: input.body,
      p_size: input.size,
    })
    if (error) throw toApiError(error)
  })
}

export function useWithdrawRequest() {
  return useAdMutation(async (requestId: string) => {
    const { error } = await supabase.rpc('withdraw_ad_request', { p_request_id: requestId })
    if (error) throw toApiError(error)
  })
}

export function useApproveAd() {
  return useAdMutation(async (input: { adId: string; version: number; despiteOpen: boolean }) => {
    const { error } = await supabase.rpc('approve_ad', {
      p_ad_id: input.adId,
      p_version: input.version,
      p_despite_open: input.despiteOpen,
    })
    if (error) throw toApiError(error)
  })
}

export function useArchiveAd() {
  return useAdMutation(async (input: { adId: string; archived: boolean }) => {
    const { error } = await supabase.rpc('archive_ad', {
      p_ad_id: input.adId,
      p_archived: input.archived,
    })
    if (error) throw toApiError(error)
  })
}
