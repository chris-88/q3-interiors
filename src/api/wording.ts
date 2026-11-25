import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseRows } from '@/lib/tolerant'
import {
  WORDING,
  type Wording,
  type WordingKey,
} from '../../supabase/functions/_shared/messages.ts'
import { toApiError } from './errors'

/** The seeded "what to prepare" text per appointment type, for "reset to default". */
export const PREPARE_DEFAULTS: Record<string, string> = {
  phone_consultation:
    'Have a rough idea of the rooms involved and any measurements or photos you already have.',
  site_visit:
    'Make sure we can get into the rooms involved. Have any plans or ideas you have collected to hand.',
}
export const PREPARE_MAX = 400

/** The visit disclaimer for public pages: the reworded text, or the default. */
export function usePublicVisitDisclaimer(): string {
  const query = useQuery({
    queryKey: ['public-wording'],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('public_wording')
      if (error) throw toApiError(error)
      return z.object({ visit_disclaimer: z.string().nullable() }).parse(data)
    },
  })
  return query.data?.visit_disclaimer ?? WORDING.visit_disclaimer.default
}

export function useWordingOverrides() {
  return useQuery({
    queryKey: ['wording'],
    queryFn: async (): Promise<Wording> => {
      const { data, error } = await supabase.from('message_blocks').select('key, body')
      if (error) throw toApiError(error)
      const rows = parseRows(z.object({ key: z.string(), body: z.string() }), data, 'wording')
      return Object.fromEntries(rows.filter((r) => r.key in WORDING).map((r) => [r.key, r.body]))
    },
  })
}

export function useSaveWording() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, body, by }: { key: WordingKey; body: string; by: string }) => {
      const { data, error } = await supabase
        .from('message_blocks')
        .upsert({
          key,
          body: body.trim(),
          updated_at: new Date().toISOString(),
          updated_by_name: by,
        })
        .select('key')
      if (error) throw toApiError(error)
      if (!data || data.length === 0) throw toApiError({ message: 'not allowed', code: '42501' })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wording'] })
      void queryClient.invalidateQueries({ queryKey: ['public-wording'] })
    },
  })
}

export function useResetWording() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (key: WordingKey) => {
      const { error } = await supabase.from('message_blocks').delete().eq('key', key)
      if (error) throw toApiError(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wording'] })
      void queryClient.invalidateQueries({ queryKey: ['public-wording'] })
    },
  })
}

export function useSavePrepare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { data, error } = await supabase
        .from('appointment_types')
        .update({ what_to_prepare: text.trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
      if (error) throw toApiError(error)
      if (!data || data.length === 0) throw toApiError({ message: 'not allowed', code: '42501' })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointment_types'] }),
  })
}
