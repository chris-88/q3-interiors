import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { formDefinitionSchema } from '@/forms/definition-schema'
import type { FormDefinition } from '@/forms/types'
import { supabase } from '@/lib/supabase'
import { openEnum, parseOne, parseRows, type Open } from '@/lib/tolerant'
import { toApiError } from './errors'
import { ESTIMATE_COLUMNS, estimateSchema } from './estimates'

export const ENQUIRY_STATUSES = ['new', 'in_review', 'contacted', 'unsuitable'] as const
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number]

export const STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  in_review: 'In review',
  contacted: 'Contacted',
  unsuitable: 'Unsuitable',
}

/** The label for a status, or the raw value for one a newer release added. */
export function statusLabel(status: Open<EnquiryStatus>): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status
}

// Open: a status added by a newer release must not break the list (see lib/tolerant.ts).
const statusSchema = openEnum(ENQUIRY_STATUSES)
const answersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]))

const summaryBookingSchema = z
  .object({
    starts_at: z.string(),
    confirmed_at: z.string().nullable(),
    state: z.string(),
    // The type's mode (call or visit) for the list line; absent from older reads.
    appointment_types: z.object({ mode: z.string() }).nullable().default(null),
  })
  .transform(({ appointment_types, ...b }) => ({ ...b, mode: appointment_types?.mode ?? null }))

const enquirySummarySchema = z.object({
  id: z.string(),
  reference: z.string(),
  status: statusSchema,
  form_id: z.string(),
  form_version: z.number(),
  answers: answersSchema,
  submitted_at: z.string(),
  contact_requested_at: z.string().nullable(),
  added_after_booking_at: z.string().nullable().default(null),
  // Slice 7: the commercial stage, and the appointments behind "awaiting quote".
  outcome: openEnum(['quoted', 'won', 'lost']).nullable().default(null),
  // The figures and reason behind the list line ("Quoted €18,450", "Lost: Price").
  quote_amount: z.coerce.number().nullable().default(null),
  outcome_value: z.coerce.number().nullable().default(null),
  // Any string: retired reasons (project_cancelled) and ones a newer release adds.
  outcome_reason: z.string().nullable().default(null),
  bookings: z
    .array(z.unknown())
    .default([])
    .transform((rows) => parseRows(summaryBookingSchema, rows, 'appointments')),
  // Estimates after a site visit (the newest is the current one); absent before 2026-11-29.
  estimates: z
    .array(z.unknown())
    .default([])
    .transform((rows) => parseRows(estimateSchema, rows, 'estimates')),
})

export type EnquirySummary = z.infer<typeof enquirySummarySchema>

const attributionSchema = z.object({
  tracking: openEnum(['tagged', 'unknown']),
  utm_source: z.string().nullable(),
  utm_medium: z.string().nullable(),
  utm_campaign: z.string().nullable(),
  utm_content: z.string().nullable(),
  utm_term: z.string().nullable(),
  click_id_present: z.boolean().nullable(),
  landing_path: z.string().nullable(),
  first_seen_at: z.string().nullable(),
})

export type EnquiryAttribution = z.infer<typeof attributionSchema>

const eventSchema = z.object({
  id: z.number(),
  // Any string: kinds added by newer releases render as a generic history line.
  kind: z.string(),
  detail: z.string().nullable(),
  from_status: statusSchema.nullable(),
  to_status: statusSchema.nullable(),
  reason: z.string().nullable(),
  actor_name: z.string().nullable(),
  created_at: z.string(),
})

export type EnquiryEvent = z.infer<typeof eventSchema>

/** History entries parsed one by one: one this build cannot read is left out, not fatal. */
const eventsSchema = z
  .array(z.unknown())
  .transform((rows) => parseRows(eventSchema, rows, 'enquiry history'))

const enquiryDetailSchema = enquirySummarySchema.extend({
  status_reason: z.string().nullable(),
  marketing_opt_in: z.boolean(),
  marketing_opt_in_at: z.string().nullable(),
  updated_at: z.string(),
  site_details: answersSchema.nullable(),
  site_details_form_version: z.number().nullable(),
  prepare_details: answersSchema.nullable().default(null),
  prepare_form_version: z.number().nullable().default(null),
  chase_flagged_at: z.string().nullable().default(null),
  chase_note: z.string().nullable().default(null),
  chase_flagged_by_name: z.string().nullable().default(null),
  contact_requested_at: z.string().nullable(),
  contact_request_reason: z.string().nullable(),
  quote_date: z.string().nullable().default(null),
  won_date: z.string().nullable().default(null),
  outcome_note: z.string().nullable(),
  // The website project the enquiry started from (a slug), if any; absent before 2026-11-28.
  inspiration: z.string().nullable().default(null),
  // One-to-one embed: PostgREST returns an object (or null) because enquiry_id is the key.
  enquiry_attribution: attributionSchema.nullable(),
  enquiry_events: eventsSchema,
})

export type EnquiryDetail = z.infer<typeof enquiryDetailSchema>

const SUMMARY_COLUMNS = `id, reference, status, form_id, form_version, answers, submitted_at, contact_requested_at, added_after_booking_at, outcome, quote_amount, outcome_value, outcome_reason, bookings (starts_at, confirmed_at, state, appointment_types (mode)), ${ESTIMATE_COLUMNS}`

export function useEnquiries() {
  return useQuery({
    queryKey: ['enquiries'],
    queryFn: async (): Promise<EnquirySummary[]> => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(SUMMARY_COLUMNS)
        .order('submitted_at', { ascending: false })
        .limit(200)
      if (error) throw toApiError(error)
      return parseRows(enquirySummarySchema, data, 'enquiries')
    },
  })
}

export function useEnquiry(id: string) {
  return useQuery({
    queryKey: ['enquiries', id],
    queryFn: async (): Promise<EnquiryDetail | null> => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(
          `${SUMMARY_COLUMNS}, status_reason, marketing_opt_in, marketing_opt_in_at, updated_at,
           site_details, site_details_form_version, contact_request_reason,
           prepare_details, prepare_form_version, chase_flagged_at, chase_note, chase_flagged_by_name,
           outcome_note, quote_date, won_date, inspiration,
           enquiry_attribution (tracking, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
             click_id_present, landing_path, first_seen_at),
           enquiry_events (id, kind, from_status, to_status, reason, detail, actor_name, created_at)`,
        )
        .eq('id', id)
        .order('created_at', { referencedTable: 'enquiry_events', ascending: false })
        .maybeSingle()
      if (error) throw toApiError(error)
      return data === null ? null : parseOne(enquiryDetailSchema, data, 'this enquiry')
    },
  })
}

/** Every published form version, keyed `formId@version`. Staff only (RLS). */
export function useFormVersions() {
  return useQuery({
    queryKey: ['form_versions'],
    staleTime: Infinity,
    queryFn: async (): Promise<Map<string, FormDefinition>> => {
      const { data, error } = await supabase
        .from('form_versions')
        .select('form_id, version, schema')
      if (error) throw toApiError(error)
      // A version this build cannot read is left out; its enquiries fall back to plain answers.
      const rows = parseRows(
        z.object({ form_id: z.string(), version: z.number(), schema: formDefinitionSchema }),
        data,
        'form versions',
      )
      return new Map(rows.map((row) => [`${row.form_id}@${row.version}`, row.schema]))
    },
  })
}

export type SetStatusInput = { id: string; status: EnquiryStatus; reason: string | null }

export function useSetEnquiryStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status, reason }: SetStatusInput) => {
      const { error } = await supabase.rpc('set_enquiry_status', {
        p_enquiry_id: id,
        p_status: status,
        p_reason: reason,
      })
      if (error) throw toApiError(error)
    },
    onSuccess: (_data, { id }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['enquiries', id] }),
        queryClient.invalidateQueries({ queryKey: ['enquiries'], exact: true }),
      ]),
  })
}

export const NOTE_MAX = 1000

/** What a note may be: 1 to 1,000 characters after trimming (the server checks the same). */
export const noteSchema = z
  .string()
  .trim()
  .min(1, 'Write the note first.')
  .max(NOTE_MAX, 'Keep the note under 1,000 characters.')

/** Add a staff note to an enquiry's history (`add_enquiry_note`, active staff only). */
export function useAddNote(enquiryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (note: string) => {
      const { error } = await supabase.rpc('add_enquiry_note', {
        p_enquiry_id: enquiryId,
        p_note: note,
      })
      if (error) throw toApiError(error)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['enquiries', enquiryId] }),
  })
}

const photoRowSchema = z.object({
  id: z.string(),
  object_path: z.string(),
  width: z.number(),
  height: z.number(),
  // bytea comes back from PostgREST as "\\x" + hex.
  thumb_jpeg: z.string(),
  uploaded_at: z.string(),
})

export type EnquiryPhoto = {
  id: string
  path: string
  width: number
  height: number
  thumbUrl: string
  uploadedAt: string
}

function hexToBase64(hex: string): string {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex
  let binary = ''
  for (let i = 0; i + 1 < clean.length; i += 2)
    binary += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16))
  return btoa(binary)
}

/** Photos a customer added after booking (stored ones only, by RLS). Staff only. */
export function useEnquiryPhotos(enquiryId: string) {
  return useQuery({
    queryKey: ['enquiries', enquiryId, 'photos'],
    queryFn: async (): Promise<EnquiryPhoto[]> => {
      const { data, error } = await supabase
        .from('enquiry_photos')
        .select('id, object_path, width, height, thumb_jpeg, uploaded_at')
        .eq('enquiry_id', enquiryId)
        .order('created_at', { ascending: true })
      if (error) throw toApiError(error)
      return parseRows(photoRowSchema, data, 'photos').map((row) => ({
        id: row.id,
        path: row.object_path,
        width: row.width,
        height: row.height,
        thumbUrl: `data:image/jpeg;base64,${hexToBase64(row.thumb_jpeg)}`,
        uploadedAt: row.uploaded_at,
      }))
    },
  })
}

/** The full-size photo, read from the private bucket with the staff session. */
export function useEnquiryPhotoFile(path: string | null) {
  return useQuery({
    queryKey: ['enquiry-photo-file', path],
    enabled: path !== null,
    staleTime: Infinity,
    queryFn: async (): Promise<Blob> => {
      const { data, error } = await supabase.storage.from('enquiry-photos').download(path ?? '')
      if (error) throw toApiError({ message: error.message })
      return data
    },
  })
}
