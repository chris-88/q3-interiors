import type { FormDefinition } from './types.ts'
import { enquiryV1 } from './enquiry/v1.ts'

/**
 * Every published form version, oldest first. Append only: a version listed here is stored in
 * `form_versions`, and the database refuses to change it. `npm run forms:sql` regenerates
 * `supabase/forms/published.sql` from this list.
 */
export const publishedForms: FormDefinition[] = [enquiryV1]

export function findPublishedForm(formId: string, version: number): FormDefinition | undefined {
  return publishedForms.find((form) => form.formId === formId && form.version === version)
}
