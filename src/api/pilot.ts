import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pilotReportSchema, type PilotReport } from '@/lib/pilot'
import { supabase } from '@/lib/supabase'
import { parseOne } from '@/lib/tolerant'
import { toApiError } from './errors'

/** The pilot measures for an Irish date range. Staff only (the function checks). */
export function usePilotReport(from: string, to: string) {
  return useQuery({
    queryKey: ['pilot-report', from, to],
    enabled: from !== '' && to !== '' && from <= to,
    queryFn: async (): Promise<PilotReport> => {
      const { data, error } = await supabase.rpc('pilot_report', { p_from: from, p_to: to })
      if (error) throw toApiError(error)
      return parseOne(pilotReportSchema, data, 'the pilot measures')
    },
  })
}

/** "Had to chase details": set (with what was missing), change, or clear. */
export function useSetChaseDetails(enquiryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { flagged: boolean; note: string }) => {
      const { error } = await supabase.rpc('set_chase_details', {
        p_enquiry_id: enquiryId,
        p_flagged: input.flagged,
        p_note: input.note,
      })
      if (error) throw toApiError(error)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['enquiries', enquiryId] }),
  })
}
