import type { FormDefinition, FormField } from '../types.ts'
import { enquiryV2 } from './v2.ts'

/**
 * Enquiry form, version 3 (2026-11-28). PUBLISHED: stored in `form_versions`; do not edit it,
 * add a v4.
 *
 * Exactly v2 plus one project type, "Workplace fit-out" (`workplace`, no follow-up question),
 * placed before "Something else" for enquiries from the website's workplace projects. Every
 * field id and option value of v2 keeps its meaning, so enquiries, staff screens, emails and the
 * report read v2 and v3 the same way. Built from v2 (itself immutable) so the one difference is
 * visible here; `published.test.ts` pins the resulting object.
 */
const WORKPLACE = { value: 'workplace', label: 'Workplace fit-out' }

function withWorkplace(field: FormField): FormField {
  if (field.id !== 'project_type' || field.type !== 'single') return field
  const options = field.options.flatMap((option) =>
    option.value === 'other' ? [WORKPLACE, option] : [option],
  )
  return { ...field, options }
}

export const enquiryV3: FormDefinition = {
  ...enquiryV2,
  version: 3,
  steps: enquiryV2.steps.map((step) => ({ ...step, fields: step.fields.map(withWorkplace) })),
}

/** The version new enquiries are made with. */
export const currentEnquiryForm: FormDefinition = enquiryV3
