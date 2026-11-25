import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { parseOne } from '@/lib/tolerant'
import { toApiError } from './errors'

/** The brand name, used in the header and wherever the business has not set a trading name. */
export const BRAND_NAME = 'Q3 Interiors'

const text = z.string().nullable()

export const publicBusinessSchema = z.object({
  trading_name: z.string(),
  legal_name: text,
  postal_address: text,
  contact_phone: text,
  contact_email: text,
  service_area: text,
  privacy_contact: text,
  privacy_reviewed: z.boolean(),
  retention_months: z.number().int().nullable().default(null),
})

export type PublicBusiness = z.infer<typeof publicBusinessSchema>

/** Shown until the server answers, and to a first-time visitor when it cannot: nothing claimed. */
export const EMPTY_BUSINESS: PublicBusiness = {
  trading_name: BRAND_NAME,
  legal_name: null,
  postal_address: null,
  contact_phone: null,
  contact_email: null,
  service_area: null,
  privacy_contact: null,
  privacy_reviewed: false,
  retention_months: null,
}

const CACHE_KEY = 'q3.business.v1'

/** The last details this browser saw, so contact details still show when the backend is down. */
export function readCachedBusiness(): PublicBusiness | undefined {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return undefined
    const parsed = publicBusinessSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function writeCachedBusiness(value: PublicBusiness) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    // Private mode or storage blocked: the page still works, just without the fallback copy.
  }
}

/**
 * Public business details. Always returns something usable: the server's answer, else the last
 * copy this browser saw, else nothing filled in.
 */
export function usePublicBusiness(): PublicBusiness {
  const cached = readCachedBusiness()
  const query = useQuery({
    queryKey: ['public-business'],
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<PublicBusiness> => {
      const { data, error } = await supabase.rpc('public_business_details')
      if (error) throw toApiError(error)
      const parsed = publicBusinessSchema.parse(data)
      writeCachedBusiness(parsed)
      return parsed
    },
  })
  return query.data ?? cached ?? EMPTY_BUSINESS
}

/** "087 123 4567 or hello@…" when either is set, else null. */
export function contactLine(b: PublicBusiness): string | null {
  const parts = [b.contact_phone, b.contact_email].filter((v): v is string => Boolean(v))
  return parts.length ? parts.join(' or ') : null
}

// ---------------------------------------------------------------------------------------------
// Admin editing
// ---------------------------------------------------------------------------------------------

const optional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))

export const businessFormSchema = z.object({
  trading_name: z
    .string()
    .trim()
    .min(1, 'Enter the trading name.')
    .max(80, 'Use at most 80 characters.'),
  legal_name: optional(160, 'Use at most 160 characters.').refine(
    (v) => v === null || v.length >= 2,
    'Too short.',
  ),
  postal_address: optional(300, 'Use at most 300 characters.').refine(
    (v) => v === null || v.length >= 5,
    'Enter the full address.',
  ),
  contact_phone: optional(40, 'Use at most 40 characters.').refine(
    (v) => v === null || /^[0-9+() .-]{5,}$/.test(v),
    'Use digits, spaces and + ( ) - only.',
  ),
  contact_email: optional(254, 'Too long.').refine(
    (v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
    'Enter a valid email address.',
  ),
  service_area: optional(200, 'Use at most 200 characters.').refine(
    (v) => v === null || v.length >= 2,
    'Too short.',
  ),
  privacy_contact: optional(254, 'Too long.').refine(
    (v) => v === null || v.length >= 5,
    'Too short.',
  ),
})

export type BusinessFormInput = z.input<typeof businessFormSchema>
export type BusinessFormValues = z.output<typeof businessFormSchema>

const businessRowSchema = publicBusinessSchema
  .omit({ privacy_reviewed: true, retention_months: true })
  .extend({ privacy_reviewed_at: z.string().nullable(), updated_at: z.string() })

export type BusinessRow = z.infer<typeof businessRowSchema>

export function useBusinessDetails() {
  return useQuery({
    queryKey: ['business-details'],
    queryFn: async (): Promise<BusinessRow> => {
      const { data, error } = await supabase
        .from('business_details')
        .select(
          'trading_name, legal_name, postal_address, contact_phone, contact_email, service_area, privacy_contact, privacy_reviewed_at, updated_at',
        )
        .single()
      if (error) throw toApiError(error)
      return parseOne(businessRowSchema, data, 'the business details')
    },
  })
}

export function useSaveBusinessDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      values: Partial<BusinessFormValues> & { privacy_reviewed_at?: string | null },
    ) => {
      const { data, error } = await supabase
        .from('business_details')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', true)
        .select('updated_at')
      if (error) throw toApiError(error)
      // RLS turns a refused update into "no rows": say so instead of pretending it saved.
      if (!data || data.length === 0) throw toApiError({ message: 'not allowed', code: '42501' })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-details'] })
      void queryClient.invalidateQueries({ queryKey: ['public-business'] })
      void queryClient.invalidateQueries({ queryKey: ['checklist'] })
    },
  })
}
