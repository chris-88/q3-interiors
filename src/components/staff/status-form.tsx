import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ENQUIRY_STATUSES,
  STATUS_LABELS,
  useSetEnquiryStatus,
  type EnquiryStatus,
} from '@/api/enquiries'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

export const statusChangeSchema = z
  .object({
    status: z.enum(ENQUIRY_STATUSES),
    reason: z.string().trim().max(500, 'Keep this under 500 characters.'),
  })
  .refine((value) => value.status !== 'unsuitable' || value.reason.length > 0, {
    path: ['reason'],
    message: 'Say why this enquiry is unsuitable.',
  })

type StatusChange = z.input<typeof statusChangeSchema>

export function StatusForm({ enquiryId, current }: { enquiryId: string; current: EnquiryStatus }) {
  const setStatus = useSetEnquiryStatus()
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<StatusChange>({
    resolver: zodResolver(statusChangeSchema),
    values: { status: current, reason: '' },
  })
  const status = useWatch({ control, name: 'status' })
  const unchanged = status === current

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        setStatus.mutate(
          { id: enquiryId, status: values.status, reason: values.reason.trim() || null },
          { onSuccess: () => reset({ status: values.status, reason: '' }) },
        ),
      )}
    >
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="status">Status</FieldLabel>
          <NativeSelect id="status" className="w-full" {...register('status')}>
            {ENQUIRY_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STATUS_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={errors.reason ? true : undefined}>
          <FieldLabel htmlFor="reason">
            {status === 'unsuitable' ? 'Reason' : 'Note (optional)'}
          </FieldLabel>
          <Textarea
            id="reason"
            rows={2}
            className="text-base"
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? 'reason-error' : undefined}
            {...register('reason')}
          />
          {errors.reason && <FieldError id="reason-error">{errors.reason.message}</FieldError>}
        </Field>
        {setStatus.isError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>The status was not saved. Try again.</AlertDescription>
          </Alert>
        )}
        <Button
          type="submit"
          className="h-10 self-start px-4"
          disabled={setStatus.isPending || unchanged}
        >
          {setStatus.isPending ? 'Saving…' : 'Update status'}
        </Button>
      </FieldGroup>
    </form>
  )
}
