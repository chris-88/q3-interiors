import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { openEnum, parseOne, parseRows } from '@/lib/tolerant'
import { toApiError } from './errors'

export const AD_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  archived: 'Archived',
}

export const adStatusLabel = (status: string) => AD_STATUS_LABELS[status] ?? status

// Open enums and row-by-row lists: values added by a newer release must not break the pages.
const status = openEnum(['new', 'changes_requested', 'approved', 'archived'])

const variantSchema = z.object({
  id: z.string(),
  // Closed on purpose: a size this build cannot frame is left out of the list (row by row).
  size: z.enum(['portrait', 'vertical', 'square']),
  width: z.number(),
  height: z.number(),
  html_path: z.string(),
  export_path: z.string(),
  export_bytes: z.number().nullable(),
  /** image: a PNG (still ad); video: an MP4 with its loop length and a poster PNG. */
  export_type: openEnum(['image', 'video']).default('image'),
  duration_ms: z.number().nullable().default(null),
  poster_path: z.string().nullable().default(null),
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
  /** Where the ad points, with its tags (null before links were stored). */
  link_url: z.string().nullable().default(null),
  ad_variants: z.array(z.unknown()).transform((rows) => parseRows(variantSchema, rows, 'ad sizes')),
})

export const REQUEST_SIZES = {
  both: 'Both sizes',
  portrait: 'Feed 4:5',
  vertical: 'Stories and Reels 9:16',
  square: 'Square',
} as const

export const requestSizeLabel = (size: string) =>
  (REQUEST_SIZES as Record<string, string>)[size] ?? size

const requestSchema = z.object({
  id: z.string(),
  version_id: z.string(),
  size: openEnum(['both', 'portrait', 'vertical', 'square']),
  body: z.string(),
  state: openEnum(['open', 'done', 'withdrawn']),
  done_in_version: z.number().nullable(),
  created_by: z.string().nullable(),
  created_by_name: z.string(),
  created_at: z.string(),
})

export type AdRequest = z.infer<typeof requestSchema>

const eventSchema = z.object({
  kind: z.string(),
  version: z.number().nullable(),
  detail: z.string().nullable(),
  actor_name: z.string().nullable(),
  created_at: z.string(),
})

export type AdEvent = z.infer<typeof eventSchema>

const EVENT_LABELS: Record<string, string> = {
  published: 'Published',
  requested: 'Change asked for',
  withdrawn: 'Request withdrawn',
  approved: 'Approved',
  archived: 'Archived',
  unarchived: 'Brought back from the archive',
  request_done: 'Request done',
}

/** Plain words for a history entry; a kind from a newer release reads "Update recorded". */
export const adEventLabel = (kind: string) => EVENT_LABELS[kind] ?? 'Update recorded'

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
      .nullable()
      // A campaign this build cannot build a link for: the ad shows without the link.
      .catch(null),
  })
  .nullable()

const adSchema = z.object({
  id: z.string(),
  name: z.string(),
  status,
  created_at: z.string(),
  created_by_name: z.string().nullable(),
  set_name: z.string().nullable().default(null),
  set_position: z.number().nullable().default(null),
  campaign_creatives: creativeSchema,
  ad_versions: z
    .array(z.unknown())
    .transform((rows) => parseRows(versionSchema, rows, 'ad versions')),
  ad_requests: z
    .array(z.unknown())
    .default([])
    .transform((rows) => parseRows(requestSchema, rows, 'ad change requests')),
  ad_events: z
    .array(z.unknown())
    .default([])
    .transform((rows) => parseRows(eventSchema, rows, 'ad history')),
})

export type Ad = z.infer<typeof adSchema>
export type AdVersion = z.infer<typeof versionSchema>
export type AdVariant = z.infer<typeof variantSchema>

const thumbVariantSchema = z.object({
  size: z.string(),
  export_type: z.string().default('image'),
  export_path: z.string(),
  poster_path: z.string().nullable().default(null),
})

const listItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status,
  created_at: z.string(),
  set_name: z.string().nullable().default(null),
  set_position: z.number().nullable().default(null),
  ad_versions: z.array(
    z.object({
      version: z.number(),
      ad_variants: z
        .array(z.unknown())
        .default([])
        .transform((rows) => parseRows(thumbVariantSchema, rows, 'ad sizes')),
    }),
  ),
  ad_requests: z.array(z.object({ state: z.string() })).default([]),
})

export type AdListItem = z.infer<typeof listItemSchema>

export function useAds() {
  return useQuery({
    queryKey: ['ads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ads')
        .select(
          'id, name, status, created_at, set_name, set_position, ad_versions(version, ad_variants(size, export_type, export_path, poster_path)), ad_requests(state)',
        )
        .order('created_at', { ascending: false })
      if (error) throw toApiError(error)
      return parseRows(listItemSchema, data, 'ads')
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
          'id, name, status, created_at, created_by_name, set_name, set_position, campaign_creatives(label, slug, campaigns(name, slug, utm_source, utm_medium, landing_route)), ad_versions(id, version, caption, headline, button_label, notes, link_url, created_at, approved_at, approved_by_name, ad_variants(id, size, width, height, html_path, export_path, export_bytes, export_type, duration_ms, poster_path)), ad_requests(id, version_id, size, body, state, done_in_version, created_by, created_by_name, created_at), ad_events(kind, version, detail, actor_name, created_at)',
        )
        .eq('id', id)
        .maybeSingle()
      if (error) throw toApiError(error)
      return data === null ? null : parseOne(adSchema, data, 'this ad')
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

/**
 * A poster, still or video from the private bucket as an object URL for <img> or <video>, read
 * with the staff session (no public or signed URL ever leaves the bucket). Revoked on unmount.
 */
export function useAdFileUrl(path: string | null | undefined) {
  const client = useQueryClient()
  revokeWhenDropped(client)
  const file = useQuery({
    queryKey: ['ad-blob', path],
    enabled: Boolean(path),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: async () => URL.createObjectURL(await downloadAdFile(path ?? '')),
  })
  return {
    url: file.data ?? null,
    isError: file.isError,
    isPending: Boolean(path) && file.isPending,
  }
}

// Each object URL lives as long as its cache entry: revoked when the cache drops it (5 minutes
// after the last screen using it closed), so files are not held for the whole session.
const watched = new WeakSet<QueryClient>()
function revokeWhenDropped(client: QueryClient) {
  if (watched.has(client)) return
  watched.add(client)
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed' || event.query.queryKey[0] !== 'ad-blob') return
    const url = event.query.state.data
    if (typeof url === 'string') URL.revokeObjectURL(url)
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
