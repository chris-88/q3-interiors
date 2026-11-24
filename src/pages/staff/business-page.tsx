import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  businessFormSchema,
  useBusinessDetails,
  useSaveBusinessDetails,
  type BusinessFormInput,
  type BusinessFormValues,
  type BusinessRow,
} from '@/api/business'
import { AdminOnly, BackToSettings, SettingsCard } from '@/components/staff/settings-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const FIELDS: {
  name: keyof BusinessFormInput
  label: string
  hint: string
  type?: 'email' | 'tel'
  long?: boolean
}[] = [
  {
    name: 'trading_name',
    label: 'Trading name',
    hint: 'The name customers know. Used in the privacy notice and the news-and-offers box.',
  },
  {
    name: 'legal_name',
    label: 'Legal name',
    hint: 'The registered business name, responsible for customers’ details (privacy notice).',
  },
  {
    name: 'postal_address',
    label: 'Postal address',
    hint: 'Shown in the privacy notice.',
    long: true,
  },
  {
    name: 'contact_phone',
    label: 'Contact phone',
    hint: 'Shown in the footer, and given to customers who need to ring (late changes, problems).',
    type: 'tel',
  },
  {
    name: 'contact_email',
    label: 'Contact email',
    hint: 'Shown in the footer and when something goes wrong.',
    type: 'email',
  },
  {
    name: 'service_area',
    label: 'Service area',
    hint: 'Plain words, for example “Dublin and north Kildare”. Shown in the footer.',
  },
  {
    name: 'privacy_contact',
    label: 'Privacy contact',
    hint: 'Where people send requests to see, correct or delete their details (an email or postal address).',
  },
]

function BusinessForm({ initial }: { initial: BusinessRow }) {
  const save = useSaveBusinessDetails()
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<BusinessFormInput, unknown, BusinessFormValues>({
    resolver: zodResolver(businessFormSchema),
    defaultValues: Object.fromEntries(
      FIELDS.map((f) => [f.name, initial[f.name] ?? '']),
    ) as BusinessFormInput,
  })
  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        save.mutate(values, {
          onSuccess: () => reset(values as BusinessFormInput, { keepValues: true }),
        }),
      )}
    >
      <FieldGroup>
        <p className="text-muted-foreground text-sm">
          Leave a box empty until it is confirmed: empty details are simply not shown on the
          website.
        </p>
        {FIELDS.map((f) => {
          const id = `business-${f.name}`
          const error = errors[f.name]?.message
          const props = {
            id,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': `${id}-hint${error ? ` ${id}-error` : ''}`,
            ...register(f.name),
          }
          return (
            <Field key={f.name} data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
              {f.long ? (
                <Textarea rows={3} className="text-base" {...props} />
              ) : (
                <Input
                  type={f.type ?? 'text'}
                  inputMode={f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : undefined}
                  className="h-12 text-base"
                  {...props}
                />
              )}
              <FieldDescription id={`${id}-hint`}>{f.hint}</FieldDescription>
              {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
            </Field>
          )
        })}
        {save.isError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              Not saved.{' '}
              {save.error.message === 'not allowed'
                ? 'Only an admin can change these.'
                : 'Please try again.'}
            </AlertDescription>
          </Alert>
        )}
        {save.isSuccess && !isDirty && (
          <output className="block text-sm">Saved. The website shows the new details now.</output>
        )}
        <Button type="submit" size="lg" className="h-12 px-6 text-base" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save details'}
        </Button>
      </FieldGroup>
    </form>
  )
}

export function BusinessPage() {
  const details = useBusinessDetails()
  return (
    <AdminOnly>
      <div className="flex flex-col gap-4">
        <BackToSettings />
        <h1 className="text-section text-ink font-bold">Business details</h1>
        <SettingsCard title="What customers see" id="business-heading">
          {details.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : details.isError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>Could not load the details. Please try again.</AlertDescription>
            </Alert>
          ) : (
            <BusinessForm initial={details.data} />
          )}
        </SettingsCard>
      </div>
    </AdminOnly>
  )
}
