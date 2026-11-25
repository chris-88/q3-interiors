import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import type { Route } from '@/lib/journey'
import { supabase } from '@/lib/supabase'
import { toApiError } from './errors'

const publicTypesSchema = z.array(
  z.object({
    id: z.string(),
    mode: z.enum(['phone', 'on_site']),
    duration_minutes: z.number().int().positive(),
  }),
)

export type PublicAppointmentType = z.infer<typeof publicTypesSchema>[number]

/**
 * The active appointment types' modes and lengths, for the landing choices (anon may call
 * `public_appointment_types()`; it returns nothing else). Undefined while loading or when the
 * server cannot be reached: the choices then show without a length rather than a guessed one.
 */
export function usePublicAppointmentTypes() {
  return useQuery({
    queryKey: ['public-appointment-types'],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<PublicAppointmentType[]> => {
      const { data, error } = await supabase.rpc('public_appointment_types')
      if (error) throw toApiError(error)
      return publicTypesSchema.parse(data)
    },
  })
}

/** The length of the first active type for a route, if known. */
export function minutesFor(
  types: PublicAppointmentType[] | undefined,
  route: Route,
): number | null {
  return types?.find((t) => t.mode === route)?.duration_minutes ?? null
}
