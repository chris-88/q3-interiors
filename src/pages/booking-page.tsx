import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useParams } from 'react-router'
import {
  InvalidLinkError,
  useAvailability,
  useBook,
  useBookingContext,
  useBookingStatus,
  useRequestContact,
  useSaveSiteDetails,
  type AppointmentTypeOption,
  type BookResult,
  type BookingContext,
  type Slot,
} from '@/api/booking'
import { BookingConfirmed, BookingPending } from '@/components/booking/booking-outcome'
import { SlotPicker } from '@/components/booking/slot-picker'
import { FormFieldInput } from '@/components/enquiry/form-field'
import { PublicLayout } from '@/components/public-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { allFields, cleanAnswers, validateFields } from '@/forms/logic'
import { siteDetailsV1 } from '@/forms/site-details/v1'
import type { Answers } from '@/forms/types'
import { formatClock, formatLongDate } from '@/lib/format'

type Step = 'type' | 'address' | 'slot' | 'confirm'

function Heading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      className="text-2xl font-semibold tracking-tight text-balance outline-none"
    >
      {children}
    </h1>
  )
}

function SavedBanner({ reference }: { reference: string }) {
  return (
    <p className="bg-muted text-muted-foreground mb-6 rounded-lg px-4 py-3 text-sm">
      Enquiry received. Your reference is{' '}
      <span className="text-foreground font-mono">{reference}</span>.
    </p>
  )
}

/** The truthful fallback when we cannot offer times: we contact the customer instead. */
function ContactPath({
  token,
  context,
  reason,
}: {
  token: string
  context: BookingContext
  reason: string
}) {
  const request = useRequestContact(token)
  if (context.contactRequested || request.isSuccess) {
    return (
      <section aria-live="polite">
        <Heading>We will be in touch</Heading>
        <p className="text-muted-foreground mt-2">
          We have your enquiry and will contact you by phone or email to arrange a time. You do not
          need to do anything else.
        </p>
      </section>
    )
  }
  return (
    <section>
      <Heading>We cannot show available times right now</Heading>
      <p className="text-muted-foreground mt-2">{reason}</p>
      <p className="text-muted-foreground mt-2">
        Your enquiry is saved. If you like, we will contact you to arrange a time instead.
      </p>
      {request.isError && (
        <Alert variant="destructive" className="mt-4" role="alert">
          <AlertDescription>That did not go through. Please try again.</AlertDescription>
        </Alert>
      )}
      <Button
        size="lg"
        className="mt-6 h-12 w-full text-base sm:w-auto sm:px-6"
        disabled={request.isPending}
        onClick={() => request.mutate(reason)}
      >
        {request.isPending ? 'Sending…' : 'Ask us to contact me'}
      </Button>
    </section>
  )
}

function TypeStep({
  types,
  selected,
  onChoose,
}: {
  types: AppointmentTypeOption[]
  selected: string | null
  onChoose: (id: string) => void
}) {
  const [value, setValue] = useState<string | null>(selected)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (value) onChoose(value)
      }}
    >
      <Heading>How would you like to talk it through?</Heading>
      <p className="text-muted-foreground mt-2">
        Pick one. Both are free and there is no obligation.
      </p>
      <RadioGroup
        aria-label="Appointment type"
        value={value}
        onValueChange={(v) => setValue(String(v))}
        className="mt-6 gap-3"
      >
        {types.map((type) => (
          <FieldLabel key={type.id} htmlFor={`type-${type.id}`} className="w-full">
            <Field orientation="horizontal" className="items-start">
              <RadioGroupItem value={type.id} id={`type-${type.id}`} className="mt-1" />
              <FieldContent>
                <FieldTitle className="text-base">{type.label}</FieldTitle>
                <FieldDescription>
                  {type.description} About {type.durationMinutes} minutes.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      <Button
        type="submit"
        size="lg"
        className="mt-8 h-12 w-full text-base sm:w-auto sm:px-6"
        disabled={!value}
      >
        Continue
      </Button>
    </form>
  )
}

function AddressStep({
  token,
  initialAddress,
  onDone,
  onBack,
}: {
  token: string
  initialAddress: string | null
  onDone: () => void
  onBack: () => void
}) {
  const save = useSaveSiteDetails(token)
  const fields = allFields(siteDetailsV1)
  const { control, getValues, setError, clearErrors, formState } = useForm<Answers>({
    defaultValues: { site_address: initialAddress ?? '', access_notes: '' },
  })
  const submit = () => {
    const errors = validateFields(fields, getValues())
    clearErrors()
    const ids = Object.keys(errors)
    if (ids.length) {
      for (const id of ids) setError(id, { type: 'validate', message: errors[id] })
      document.getElementById(`field-${ids[0]}`)?.focus()
      return
    }
    const answers = cleanAnswers(siteDetailsV1, getValues())
    save.mutate(Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, String(v)])), {
      onSuccess: onDone,
    })
  }
  const step = siteDetailsV1.steps[0]
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Heading>{step?.title}</Heading>
      {step?.description && <p className="text-muted-foreground mt-2">{step.description}</p>}
      <FieldGroup className="mt-6 gap-8">
        {fields.map((field) => (
          <FormFieldInput
            key={field.id}
            field={field}
            control={control}
            error={formState.errors[field.id]?.message}
            onEdit={(id) => clearErrors(id)}
          />
        ))}
      </FieldGroup>
      {save.isError && (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertDescription>The address was not saved. Check it and try again.</AlertDescription>
        </Alert>
      )}
      <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12 text-base"
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          type="submit"
          size="lg"
          className="h-12 text-base sm:px-6"
          disabled={save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Continue'}
        </Button>
      </div>
    </form>
  )
}

export function BookingPage() {
  const { token = '' } = useParams()
  const context = useBookingContext(token)
  const [step, setStep] = useState<Step>('type')
  const [typeId, setTypeId] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const availability = useAvailability(token, step === 'slot' || step === 'confirm' ? typeId : null)
  const book = useBook(token)
  const latest = context.data?.booking ?? null
  const watching =
    latest !== null && (latest.state === 'reserved' || latest.state === 'calendar_pending')
  const status = useBookingStatus(token, watching)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!watching) return
    const id = window.setTimeout(() => setSlow(true), 30_000)
    return () => window.clearTimeout(id)
  }, [watching])

  if (context.isPending) {
    return (
      <PublicLayout>
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </PublicLayout>
    )
  }
  if (context.isError) {
    return (
      <PublicLayout>
        {context.error instanceof InvalidLinkError ? (
          <>
            <Heading>This link has expired</Heading>
            <p className="text-muted-foreground mt-2">
              Booking links work for 30 days. If you sent us an enquiry, we still have it and will
              contact you.
            </p>
            <Link to="/" className="mt-6 inline-block underline underline-offset-4">
              Go to the home page
            </Link>
          </>
        ) : (
          <Alert variant="destructive" role="alert">
            <AlertTitle>We could not load your booking</AlertTitle>
            <AlertDescription>
              Check your connection and try again.
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void context.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </PublicLayout>
    )
  }

  const ctx = context.data
  const current = status.data?.booking ?? latest

  // An existing booking takes over the page.
  if (current && current.state === 'confirmed') {
    return (
      <PublicLayout>
        <BookingConfirmed booking={current} reference={ctx.reference} />
      </PublicLayout>
    )
  }
  if (current && (current.state === 'reserved' || current.state === 'calendar_pending')) {
    return (
      <PublicLayout>
        <BookingPending booking={current} slow={slow} />
      </PublicLayout>
    )
  }

  const failedBefore = current?.state === 'failed' && step === 'type' && !notice
  const types = ctx.types
  const type = types.find((t) => t.id === typeId) ?? null

  if (!ctx.calendarAvailable) {
    return (
      <PublicLayout>
        <SavedBanner reference={ctx.reference} />
        <ContactPath
          token={token}
          context={ctx}
          reason="Our booking calendar is not available at the moment."
        />
      </PublicLayout>
    )
  }

  const handleResult = (result: BookResult) => {
    switch (result.status) {
      case 'booked':
      case 'already_booked':
        void context.refetch()
        return
      case 'slot_unavailable':
        setNotice('Sorry, that time has just gone. Here are the nearest times still free.')
        setAlternatives(result.alternatives)
        setSlot(null)
        setKey(null)
        setStep('slot')
        void availability.refetch()
        return
      case 'ineligible':
        setNotice(null)
        setStep(result.reason === 'site_address_required' ? 'address' : 'type')
        return
      case 'unavailable':
        setNotice('unavailable')
        return
    }
  }

  return (
    <PublicLayout>
      <SavedBanner reference={ctx.reference} />

      {failedBefore && (
        <Alert className="mb-6">
          <AlertTitle>Your last booking did not go through</AlertTitle>
          <AlertDescription>
            We could not add it to our calendar, so the time was released. Please choose another
            time, or ask us to contact you.
          </AlertDescription>
        </Alert>
      )}

      {notice === 'unavailable' ? (
        <ContactPath
          token={token}
          context={ctx}
          reason="We could not check our calendar just now."
        />
      ) : step === 'type' ? (
        <TypeStep
          types={types}
          selected={typeId}
          onChoose={(id) => {
            const chosen = types.find((t) => t.id === id)
            setTypeId(id)
            setSlot(null)
            setStep(
              chosen?.requiresSiteAddress && chosen.eligibility === 'site_address_required'
                ? 'address'
                : 'slot',
            )
          }}
        />
      ) : step === 'address' ? (
        <AddressStep
          token={token}
          initialAddress={ctx.siteAddress}
          onBack={() => setStep('type')}
          onDone={() => setStep('slot')}
        />
      ) : step === 'slot' ? (
        <section>
          <Heading>Choose a time</Heading>
          <p className="text-muted-foreground mt-2">
            {type?.label}, about {type?.durationMinutes} minutes. Times are Irish time
            (Europe/Dublin).
          </p>
          {notice && (
            <Alert className="mt-4">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {notice && alternatives && alternatives.length > 0 && (
            <ul aria-label="Nearest free times" className="mt-3 flex flex-col gap-2">
              {alternatives.slice(0, 3).map((alt) => (
                <li key={alt.start}>
                  <Button
                    type="button"
                    variant={slot?.start === alt.start ? 'default' : 'outline'}
                    aria-pressed={slot?.start === alt.start}
                    className="h-11 w-full justify-start text-base"
                    onClick={() => {
                      setSlot(alt)
                      setKey(null)
                    }}
                  >
                    {formatLongDate(alt.start)}, {formatClock(alt.start)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6">
            {availability.isPending ? (
              <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading times">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : availability.isError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>We could not load the times</AlertTitle>
                <AlertDescription>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => void availability.refetch()}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            ) : availability.data.status === 'unavailable' ? (
              <ContactPath
                token={token}
                context={ctx}
                reason="We could not check our calendar just now."
              />
            ) : availability.data.slots.length === 0 ? (
              <ContactPath
                token={token}
                context={ctx}
                reason="There are no free times in the next few weeks."
              />
            ) : (
              <SlotPicker
                key={alternatives?.[0]?.start ?? 'all'}
                slots={availability.data.slots}
                selected={slot}
                initialDate={alternatives?.[0]?.date}
                onSelect={(s) => {
                  setSlot(s)
                  setKey(null)
                }}
              />
            )}
          </div>
          <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 text-base"
              onClick={() => {
                setNotice(null)
                setAlternatives(null)
                setStep('type')
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-12 text-base sm:px-6"
              disabled={!slot}
              onClick={() => {
                setKey((k) => k ?? crypto.randomUUID())
                setStep('confirm')
              }}
            >
              Continue
            </Button>
          </div>
        </section>
      ) : (
        <section>
          <Heading>Check and book</Heading>
          {slot && type && (
            <dl className="mt-6 flex flex-col divide-y rounded-xl border">
              <div className="flex flex-col gap-0.5 p-4">
                <dt className="text-muted-foreground text-sm">Appointment</dt>
                <dd className="text-base">{type.label}</dd>
              </div>
              <div className="flex flex-col gap-0.5 p-4">
                <dt className="text-muted-foreground text-sm">When</dt>
                <dd className="text-base">
                  {formatLongDate(slot.start)} at {formatClock(slot.start)}
                  <span className="text-muted-foreground block text-sm">
                    Irish time (Europe/Dublin)
                  </span>
                </dd>
              </div>
              {type.mode === 'on_site' && ctx.siteAddress && (
                <div className="flex flex-col gap-0.5 p-4">
                  <dt className="text-muted-foreground text-sm">Where</dt>
                  <dd className="text-base whitespace-pre-line">{ctx.siteAddress}</dd>
                </div>
              )}
            </dl>
          )}
          {book.isError && (
            <Alert variant="destructive" className="mt-6" role="alert">
              <AlertTitle>The booking has not gone through</AlertTitle>
              <AlertDescription>
                We could not reach our system. Try again; you will not be booked twice.
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 text-base"
              disabled={book.isPending}
              onClick={() => setStep('slot')}
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-12 text-base sm:px-6"
              disabled={book.isPending || !slot || !key || !typeId}
              onClick={() => {
                if (!slot || !key || !typeId) return
                book.mutate(
                  { typeId, start: slot.start, idempotencyKey: key },
                  { onSuccess: handleResult },
                )
              }}
            >
              {book.isPending ? 'Booking…' : book.isError ? 'Try again' : 'Book this time'}
            </Button>
          </div>
        </section>
      )}
    </PublicLayout>
  )
}
