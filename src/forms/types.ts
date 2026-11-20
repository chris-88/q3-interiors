/**
 * The form schema format. A published form version is plain JSON-compatible data: the client
 * renders it, Zod validation is derived from it, and the same object is stored in the
 * `form_versions` table so `submit_enquiry` can validate against it and staff can read old
 * answers through the version they were given in.
 *
 * Keep this file free of runtime imports: `scripts/form-sql.ts` imports the form files directly
 * under Node's type stripping.
 */

export type Option = {
  /** Stable value stored in the answers. Never rename; add a new option instead. */
  value: string
  label: string
}

/** Show the field only when another field's answer is one of `in`. */
export type VisibleWhen = {
  field: string
  in: string[]
}

type FieldBase = {
  /** Stable answer key. Never reuse an ID for a different question. */
  id: string
  label: string
  help?: string
  required: boolean
  visibleWhen?: VisibleWhen
}

export type TextField = FieldBase & {
  /** `email` and `tel` carry their own format check (see `formats.ts`). */
  type: 'text' | 'textarea' | 'email' | 'tel'
  minLength?: number
  maxLength: number
  autoComplete?: string
  placeholder?: string
}

export type SingleChoiceField = FieldBase & {
  type: 'single'
  options: Option[]
}

export type MultiChoiceField = FieldBase & {
  type: 'multi'
  options: Option[]
}

export type FormField = TextField | SingleChoiceField | MultiChoiceField

export type FormStep = {
  id: string
  title: string
  description?: string
  fields: FormField[]
}

export type FormDefinition = {
  formId: string
  version: number
  title: string
  steps: FormStep[]
}

/** Answers keyed by field ID. Text fields hold a string, multi-choice fields an array. */
export type AnswerValue = string | string[]
export type Answers = Record<string, AnswerValue | undefined>
