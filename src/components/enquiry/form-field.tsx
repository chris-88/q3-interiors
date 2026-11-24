import { Controller, type Control } from 'react-hook-form'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { Answers, FormField, Option, TextField } from '@/forms/types'

type Props = {
  field: FormField
  control: Control<Answers>
  error: string | undefined
  onEdit: (id: string) => void
}

export const fieldDomId = (id: string) => `field-${id}`
const helpId = (id: string) => `field-${id}-help`
const errorId = (id: string) => `field-${id}-error`

function describedBy(field: FormField, error: string | undefined): string | undefined {
  const ids = [field.help ? helpId(field.id) : null, error ? errorId(field.id) : null].filter(
    (value): value is string => value !== null,
  )
  return ids.length ? ids.join(' ') : undefined
}

function inputProps(field: TextField) {
  switch (field.type) {
    case 'email':
      return {
        type: 'email',
        inputMode: 'email' as const,
        autoCapitalize: 'none',
        spellCheck: false,
      }
    case 'tel':
      return { type: 'tel', inputMode: 'tel' as const }
    default:
      return { type: 'text', autoCapitalize: field.autoComplete === 'name' ? 'words' : 'sentences' }
  }
}

function OptionalTag({ required }: { required: boolean }) {
  return required ? null : <span className="text-muted-foreground font-normal"> (optional)</span>
}

/** Renders one schema field. Generic over the field type; knows nothing about the enquiry. */
export function FormFieldInput({ field, control, error, onEdit }: Props) {
  const invalid = error !== undefined
  const help = field.help ? (
    <FieldDescription id={helpId(field.id)}>{field.help}</FieldDescription>
  ) : null
  const errorNode = invalid ? <FieldError id={errorId(field.id)}>{error}</FieldError> : null

  if (field.type === 'single' || field.type === 'multi') {
    const legendId = `${fieldDomId(field.id)}-legend`
    return (
      <FieldSet data-field={field.id} data-invalid={invalid || undefined}>
        <FieldLegend id={legendId} variant="label" className="text-base">
          {field.label}
          <OptionalTag required={field.required} />
        </FieldLegend>
        {help}
        <Controller
          name={field.id}
          control={control}
          render={({ field: rhf }) =>
            field.type === 'single' ? (
              <RadioGroup
                aria-labelledby={legendId}
                aria-describedby={describedBy(field, error)}
                aria-invalid={invalid || undefined}
                value={typeof rhf.value === 'string' ? rhf.value : null}
                onValueChange={(value) => {
                  rhf.onChange(value)
                  onEdit(field.id)
                }}
              >
                {field.options.map((option) => (
                  <ChoiceRow key={option.value} fieldId={field.id} option={option}>
                    <RadioGroupItem value={option.value} id={optionId(field.id, option)} />
                  </ChoiceRow>
                ))}
              </RadioGroup>
            ) : (
              // The enclosing fieldset and legend name this group of checkboxes.
              <div className="grid gap-2">
                {field.options.map((option) => {
                  const selected = Array.isArray(rhf.value) ? rhf.value : []
                  return (
                    <ChoiceRow key={option.value} fieldId={field.id} option={option}>
                      <Checkbox
                        id={optionId(field.id, option)}
                        checked={selected.includes(option.value)}
                        aria-invalid={invalid || undefined}
                        onCheckedChange={(checked) => {
                          const next = checked
                            ? [...selected, option.value]
                            : selected.filter((value) => value !== option.value)
                          // Keep schema order regardless of tap order.
                          rhf.onChange(
                            field.options.map((o) => o.value).filter((v) => next.includes(v)),
                          )
                          onEdit(field.id)
                        }}
                      />
                    </ChoiceRow>
                  )
                })}
              </div>
            )
          }
        />
        {errorNode}
      </FieldSet>
    )
  }

  return (
    <Field data-field={field.id} data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={fieldDomId(field.id)} className="text-base">
        <span>
          {field.label}
          <OptionalTag required={field.required} />
        </span>
      </FieldLabel>
      {help}
      <Controller
        name={field.id}
        control={control}
        render={({ field: rhf }) => {
          const common = {
            id: fieldDomId(field.id),
            name: field.id,
            ref: rhf.ref,
            value: typeof rhf.value === 'string' ? rhf.value : '',
            onBlur: rhf.onBlur,
            maxLength: field.maxLength,
            placeholder: field.placeholder,
            autoComplete: field.autoComplete ?? 'off',
            required: field.required,
            'aria-invalid': invalid || undefined,
            'aria-describedby': describedBy(field, error),
          }
          const onChange = (event: { target: { value: string } }) => {
            rhf.onChange(event.target.value)
            onEdit(field.id)
          }
          return field.type === 'textarea' ? (
            <Textarea {...common} onChange={onChange} rows={5} className="min-h-32 text-base" />
          ) : (
            <Input
              {...common}
              {...inputProps(field)}
              onChange={onChange}
              className="h-12 text-base"
            />
          )
        }}
      />
      {errorNode}
    </Field>
  )
}

const optionId = (fieldId: string, option: Option) => `${fieldDomId(fieldId)}-${option.value}`

function ChoiceRow({
  fieldId,
  option,
  children,
}: {
  fieldId: string
  option: Option
  children: React.ReactNode
}) {
  return (
    <FieldLabel htmlFor={optionId(fieldId, option)} className="w-full">
      <Field orientation="horizontal" className="min-h-12 items-center">
        {children}
        <FieldContent>
          <FieldTitle className="text-base font-normal">{option.label}</FieldTitle>
        </FieldContent>
      </Field>
    </FieldLabel>
  )
}
