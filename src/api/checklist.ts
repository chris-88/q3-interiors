import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseOne } from '@/lib/tolerant'
import { checklistDataSchema, type ManualKey } from '@/lib/checklist'
import { toApiError } from './errors'

export function useChecklist() {
  return useQuery({
    queryKey: ['checklist'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('go_live_checklist')
      if (error) throw toApiError(error)
      return parseOne(checklistDataSchema, data, 'the go-live checklist')
    },
  })
}

const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['checklist'] })
  void qc.invalidateQueries({ queryKey: ['public-business'] })
  void qc.invalidateQueries({ queryKey: ['business-details'] })
}

export function useTick() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, on, by }: { key: ManualKey; on: boolean; by: string }) => {
      const { error } = on
        ? await supabase.from('setup_ticks').insert({ key, ticked_by_name: by })
        : await supabase.from('setup_ticks').delete().eq('key', key)
      if (error && error.code !== '23505') throw toApiError(error)
    },
    onSuccess: () => refresh(qc),
  })
}

export function useMarkTestCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clear: boolean) => {
      const { error } = await supabase.rpc('mark_test_calendar', { p_clear: clear })
      if (error) throw toApiError(error)
    },
    onSuccess: () => refresh(qc),
  })
}

export function useSetPrivacyReviewed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (reviewed: boolean) => {
      const { data, error } = await supabase
        .from('business_details')
        .update({
          privacy_reviewed_at: reviewed ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true)
        .select('updated_at')
      if (error) throw toApiError(error)
      if (!z.array(z.unknown()).parse(data).length)
        throw toApiError({ message: 'not allowed', code: '42501' })
    },
    onSuccess: () => refresh(qc),
  })
}
