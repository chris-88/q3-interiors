import { z } from 'zod'
import type { FormDefinition } from './types'

/** Zod mirror of `FormDefinition`, used to read stored versions back from the database. */
const option = z.object({ value: z.string(), label: z.string() })

const base = {
  id: z.string(),
  label: z.string(),
  help: z.string().optional(),
  required: z.boolean(),
  visibleWhen: z.object({ field: z.string(), in: z.array(z.string()) }).optional(),
}

const field = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.enum(['text', 'textarea', 'email', 'tel']),
    minLength: z.number().optional(),
    maxLength: z.number(),
    autoComplete: z.string().optional(),
    placeholder: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal('single'), options: z.array(option) }),
  z.object({ ...base, type: z.literal('multi'), options: z.array(option) }),
])

export const formDefinitionSchema: z.ZodType<FormDefinition> = z.object({
  formId: z.string(),
  version: z.number().int(),
  title: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      fields: z.array(field),
    }),
  ),
})
