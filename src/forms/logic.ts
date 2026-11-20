import { z } from 'zod'
import type { AnswerValue, Answers, FormDefinition, FormField } from './types'

/**
 * Format checks shared with `submit_enquiry` in the database. If you change one, change the
 * matching regex in the migration too.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PHONE_PATTERN = /^\+?[0-9 ()-]{7,30}$/
const MIN_PHONE_DIGITS = 7

export function allFields(form: FormDefinition): FormField[] {
  return form.steps.flatMap((step) => step.fields)
}

export function isVisible(field: FormField, answers: Answers): boolean {
  if (!field.visibleWhen) return true
  const controlling = answers[field.visibleWhen.field]
  if (typeof controlling !== 'string') return false
  return field.visibleWhen.in.includes(controlling)
}

export function visibleFields(fields: FormField[], answers: Answers): FormField[] {
  return fields.filter((field) => isVisible(field, answers))
}

function isEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  return value.trim() === ''
}

function fieldSchema(field: FormField): z.ZodType<AnswerValue | undefined> {
  switch (field.type) {
    case 'single': {
      const values = field.options.map((option) => option.value)
      const choice = z
        .string()
        .refine((value) => values.includes(value), 'Choose one of the options.')
      return field.required
        ? z.string({ error: 'Choose an option.' }).min(1, 'Choose an option.').pipe(choice)
        : choice.optional()
    }
    case 'multi': {
      const values = field.options.map((option) => option.value)
      const list = z
        .array(z.string())
        .refine((items) => items.every((item) => values.includes(item)), 'Choose from the options.')
        .refine((items) => new Set(items).size === items.length, 'Choose each option once.')
      return field.required
        ? z
            .array(z.string(), { error: 'Choose at least one.' })
            .min(1, 'Choose at least one.')
            .pipe(list)
        : list.optional()
    }
    default: {
      let text = z
        .string()
        .trim()
        .max(field.maxLength, `Keep this under ${field.maxLength} characters.`)
      if (field.minLength) {
        text = text.min(
          field.minLength,
          `Please add a little more (at least ${field.minLength} characters).`,
        )
      }
      let checked: z.ZodType<string, string> = text
      if (field.type === 'email') {
        checked = text.refine(
          (value) => EMAIL_PATTERN.test(value),
          'Enter an email address like name@example.com.',
        )
      } else if (field.type === 'tel') {
        checked = text.refine(
          (value) =>
            PHONE_PATTERN.test(value) && value.replace(/\D/g, '').length >= MIN_PHONE_DIGITS,
          'Enter a phone number, e.g. 087 123 4567.',
        )
      }
      if (field.required) {
        return z
          .string({ error: 'This is required.' })
          .trim()
          .min(1, 'This is required.')
          .pipe(checked)
      }
      // An optional text field left blank is valid and is dropped by `cleanAnswers`.
      return z.union([z.string().trim().length(0), checked]).optional()
    }
  }
}

/**
 * Zod schema for the visible subset of `fields`, given the answers so far. Hidden fields are not
 * validated (and are dropped before submission), so a conditional question never blocks a
 * customer who cannot see it.
 */
export function buildAnswerSchema(fields: FormField[], answers: Answers) {
  const shape: Record<string, z.ZodType<AnswerValue | undefined>> = {}
  for (const field of visibleFields(fields, answers)) {
    shape[field.id] = fieldSchema(field)
  }
  return z.object(shape)
}

export type FieldErrors = Record<string, string>

/** Validate the visible fields among `fields`. Returns an empty object when everything passes. */
export function validateFields(fields: FormField[], answers: Answers): FieldErrors {
  const result = buildAnswerSchema(fields, answers).safeParse(answers)
  if (result.success) return {}
  const errors: FieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message
  }
  return errors
}

/**
 * The answers to submit: visible, non-empty fields only, text trimmed, keyed by field ID in form
 * order. Unknown keys and answers to questions that are now hidden are dropped.
 */
export function cleanAnswers(form: FormDefinition, answers: Answers): Record<string, AnswerValue> {
  const cleaned: Record<string, AnswerValue> = {}
  for (const field of visibleFields(allFields(form), answers)) {
    const value = answers[field.id]
    if (value === undefined || isEmpty(value)) continue
    cleaned[field.id] = Array.isArray(value) ? [...value] : value.trim()
  }
  return cleaned
}

/** A human-readable rendering of one answer, using the labels of the given form version. */
export function formatAnswer(field: FormField, value: AnswerValue | undefined): string | null {
  if (value === undefined || isEmpty(value)) return null
  if (field.type === 'single') {
    const option = field.options.find((o) => o.value === value)
    return option ? option.label : String(value)
  }
  if (field.type === 'multi') {
    const items = Array.isArray(value) ? value : [value]
    return items
      .map((item) => field.options.find((o) => o.value === item)?.label ?? item)
      .join(', ')
  }
  return Array.isArray(value) ? value.join(', ') : value
}

export function findField(form: FormDefinition, id: string): FormField | undefined {
  return allFields(form).find((field) => field.id === id)
}
