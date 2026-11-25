import { useQuery } from '@tanstack/react-query'
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
  ad_variants: z.array(variantSchema),
})

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
  }),
)

export type AdListItem = z.infer<typeof listSchema>[number]

export function useAds() {
  return useQuery({
    queryKey: ['ads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ads')
        .select('id, name, status, created_at, ad_versions(version)')
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
          'id, name, status, created_at, created_by_name, campaign_creatives(label, slug, campaigns(name, slug, utm_source, utm_medium, landing_route)), ad_versions(id, version, caption, headline, button_label, notes, created_at, ad_variants(id, size, width, height, html_path, export_path, export_bytes))',
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
