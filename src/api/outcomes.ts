import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { OutcomeInput } from '@/lib/outcome'
import { supabase } from '@/lib/supabase'
import { toApiError } from './errors'

/**
 * Record, correct or clear an enquiry's outcome (`record_enquiry_outcome`, active staff only).
 * Takes input already validated by `outcomeInputSchema`; the server checks it again.
 */
export function useRecordOutcome(enquiryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: OutcomeInput) => {
      const v = input
      const { error } = await supabase.rpc('record_enquiry_outcome', {
        p_enquiry_id: enquiryId,
        p_stage: v.stage,
        p_amount: v.stage === 'quoted' || v.stage === 'won' ? v.amount : null,
        p_on: v.stage === 'quoted' || v.stage === 'won' ? v.on : null,
        p_reason: v.stage === 'lost' ? v.reason : null,
        p_note: v.stage === 'none' ? null : v.note || null,
      })
      if (error) throw toApiError(error)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['enquiries'] }),
  })
}
