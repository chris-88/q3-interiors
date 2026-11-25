import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  InvalidDetailsError,
  InvalidLinkError,
  useAvailability,
  useBookingContext,
  useBookingStatus,
  useCommitBooking,
  useRequestContact,
  type BookResult,
  type BookingContext,
  type DetailsPatch,
  type Slot,
} from '@/api/booking'
import { BookingPending } from '@/components/booking/booking-outcome'
import { ManageBooking } from '@/components/booking/manage-booking'
import { SlotPicker } from '@/components/booking/slot-picker'
import { ChoiceCards, JourneyProgress } from '@/components/journey/journey-parts'
import { PublicLayout } from '@/components/public-layout'
import { TroubleMessage } from '@/components/trouble-message'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { enquiryV2 } from '@/forms/enquiry/v2'
import { findField, validateFields } from '@/forms/logic'
import type { FormField } from '@/forms/types'
import { formatClock, formatLongDate } from '@/lib/format'
import {
  ROUTE_COPY,
  ROUTES,
  bookLabel,
  formatSlotShort,
  otherRoute,
  routeTitle,
  suggestSlots,
  type Route,
} from '@/lib/journey'
import { cn } from '@/lib/utils'

/*
 * The time screen (journey screen 4) and, once booked, the receipt with change and cancel. One
 * page per enquiry token: links in emails and the "Change time" / "Cancel appointment" actions
 * (`?do=change|cancel`) land here too, for v1 enquiries as well as v2.
 */

const SLOT_TAKEN = 'That time has just been booked. Choose another time.'

function Heading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      className="text-section text-ink font-medium text-balance outline-none"
    >
      {children}
    </h1>
  )
}

/** Shown when no time can be offered or none suits: the request goes to the staff queue. */
function ContactPath({
  token,
  context,
  reason,
  intro,
}: {
  token: string
  context: BookingContext
  reason: string
  intro: string
}) {
  const request = useRequestContact(token)
  if (context.contactRequested || request.isSuccess) {
    return (
      <section>
        <Heading>We’ll be in touch</Heading>
        <p className="text-muted-foreground mt-2">
          Your enquiry is saved and we have your request. We will contact you to arrange a time. You
          do not need to do anything else.
        </p>
      </section>
    )
  }
  return (
    <section>
      <Heading>Your enquiry is saved</Heading>
      <p className="text-muted-foreground mt-2">{intro}</p>
      {request.isError && (
        <TroubleMessage
          error={request.error}
          title="Your request has not gone through"
          keptNote="Your enquiry is saved."
        />
      )}
      <Button
        size="lg"
        className="mt-6 h-auto min-h-12 w-full py-3 text-base whitespace-normal"
        disabled={request.isPending}
        onClick={() => request.mutate(reason)}
      >
        {request.isPending ? 'Sending…' : request.isError ? 'Try again' : 'Ask Q3 to contact me'}
      </Button>
    </section>
  )
}

const phoneField = findField(enquiryV2, 'phone') as FormField
const streetField = findField(enquiryV2, 'site_street') as FormField
const unitField = findField(enquiryV2, 'site_unit') as FormField

function LineInput({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
  optional,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: 'text' | 'tel'
  autoComplete: string
  optional?: boolean
}) {
  return (
    <div className="flex flex-col gap-2" data-field={id}>
      <label htmlFor={id} className="text-ink text-base font-medium">
        {label}
        {optional && <span className="text-muted-foreground font-normal"> (optional)</span>}
      </label>
      <Input
        id={id}
        type={type}
        inputMode={type === 'tel' ? 'tel' : undefined}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-12 text-base md:text-base"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  )
}

function TimeScreen({
  token,
  ctx,
  onBooked,
}: {
  token: string
  ctx: BookingContext
  onBooked: () => void
}) {
  const routes = ROUTES.filter((r) => ctx.types.some((t) => t.mode === r))
  const [route, setRoute] = useState<Route | null>(() =>
    ctx.preference && routes.includes(ctx.preference) ? ctx.preference : null,
  )
  const type = ctx.types.find((t) => t.mode === route) ?? null
  const availability = useAvailability(token, type?.id ?? null)
  const commit = useCommitBooking(token)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [slotError, setSlotError] = useState<string | null>(null)
  const [askContact, setAskContact] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [waiting, setWaiting] = useState(false)
  // The editable line: null while showing the saved value.
  const [phone, setPhone] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [editAddress, setEditAddress] = useState(false)
  const [street, setStreet] = useState(ctx.siteStreet ?? '')
  const [unit, setUnit] = useState(ctx.siteUnit ?? '')
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({})
  const inFlight = useRef(false)

  const slots = useMemo(
    () => (availability.data?.status === 'ok' ? availability.data.slots : []),
    [availability.data],
  )
  const suggestions = useMemo(() => suggestSlots(slots), [slots])

  // A chosen time the (new) appointment type cannot have is dropped, and the customer told.
  const ready = availability.data?.status === 'ok' && !availability.isFetching
  const slotFits = !slot || !ready || slots.some((s) => s.start === slot.start)
  const chosen = slotFits ? slot : null
  const dropped =
    !slotFits && route
      ? `Your chosen time is not free for a ${ROUTE_COPY[route].noun}. Choose another time.`
      : null

  const choose = (s: Slot) => {
    setSlot(s)
    setKey(crypto.randomUUID())
    setSlotError(null)
    setNotice(null)
  }

  const needsAddress = route === 'on_site' && (!ctx.siteAddress || editAddress)

  const switchTo = (next: Route) => {
    setRoute(next)
    // A new key: the same time as a different appointment is a different booking.
    if (slot) setKey(crypto.randomUUID())
    setNotice(null)
    setSlotError(null)
    setShowAll(false)
    commit.reset()
  }

  const handleResult = (result: BookResult) => {
    switch (result.status) {
      case 'booked':
      case 'already_booked':
        setWaiting(true)
        onBooked()
        return
      case 'slot_unavailable':
        setNotice(SLOT_TAKEN)
        setSlot(null)
        setKey(null)
        void availability.refetch()
        return
      case 'ineligible':
        if (result.reason === 'site_address_required') {
          setEditAddress(true)
          setAddressErrors({ site_street: 'Add the house name or number and street.' })
        } else if (result.reason === 'phone_required') {
          setPhone('')
          setPhoneError('Add a number we can ring.')
        }
        return
      case 'unavailable':
        setUnavailable(true)
        return
    }
  }

  const book = () => {
    if (!route || !type) return
    let ok = true
    const details: DetailsPatch = {}
    if (phone !== null) {
      const errors = validateFields([phoneField], { phone })
      setPhoneError(errors.phone ?? null)
      if (errors.phone) ok = false
      else if (phone.trim() !== ctx.phone) details.phone = phone.trim()
    }
    if (needsAddress) {
      const errors = validateFields([streetField, unitField], {
        appointment_preference: 'on_site',
        site_street: street,
        site_unit: unit,
      })
      setAddressErrors(errors)
      if (Object.keys(errors).length) ok = false
      details.site_street = street.trim()
      details.site_unit = unit.trim()
      details.appointment_preference = 'on_site'
    }
    if (ctx.preference && route !== ctx.preference) details.appointment_preference = route
    if (!chosen || !key) {
      setSlotError('Choose a time.')
      ok = false
    }
    if (!ok || !chosen || !key) {
      // After the errors render: focus the first field that needs attention.
      window.requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')
          ?.focus(),
      )
      return
    }
    // A second tap before the first has re-rendered the button is ignored here; the
    // idempotency key would make it the same booking on the server anyway.
    if (inFlight.current) return
    inFlight.current = true
    commit.mutate(
      {
        details: Object.keys(details).length ? details : null,
        typeId: type.id,
        start: chosen.start,
        idempotencyKey: key,
      },
      { onSuccess: handleResult, onSettled: () => (inFlight.current = false) },
    )
  }

  if (!ctx.calendarAvailable || unavailable) {
    return (
      <ContactPath
        token={token}
        context={ctx}
        reason="Booking calendar not available"
        intro="We cannot show times to book online at the moment. We can contact you to arrange one instead."
      />
    )
  }
  if (askContact) {
    return (
      <ContactPath
        token={token}
        context={ctx}
        reason="No suitable time online"
        intro="Ask us to contact you and we will arrange a time that suits."
      />
    )
  }

  const confirming = commit.isPending || waiting
  const minutes = type?.durationMinutes ?? null
  const detailsRefused = commit.error instanceof InvalidDetailsError

  return (
    <section className="flex flex-col">
      <Heading>
        {route
          ? `Choose a time for your ${ROUTE_COPY[route].noun}`
          : 'Choose a call or a site visit'}
      </Heading>
      <p className="text-muted-foreground mt-2 text-sm">
        Enquiry saved. Reference <span className="text-ink font-mono">{ctx.reference}</span>
      </p>

      {route === null ? (
        <div className="mt-6">
          <ChoiceCards
            name="appointment"
            legend="Appointment"
            options={routes.map((r) => ({
              value: r,
              label: routeTitle(r, ctx.types.find((t) => t.mode === r)?.durationMinutes),
              description: ROUTE_COPY[r].blurb,
            }))}
            value={null}
            onChange={(v) => switchTo(v as Route)}
          />
          <p className="text-ink mt-4 font-medium">Both are free.</p>
        </div>
      ) : (
        <>
          <p className="text-ink mt-4">
            {routeTitle(route, minutes)} · Irish time
            {routes.includes(otherRoute(route)) && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => switchTo(otherRoute(route))}
                  disabled={confirming}
                  className="inline-flex min-h-12 items-center underline underline-offset-4"
                >
                  Switch to a {ROUTE_COPY[otherRoute(route)].noun}
                </button>
              </>
            )}
          </p>

          {(notice ?? dropped) && (
            <Alert className="mt-4" role="alert">
              <AlertDescription>{notice ?? dropped}</AlertDescription>
            </Alert>
          )}

          <div className="mt-4">
            {availability.isPending ? (
              <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading times">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : availability.isError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>We could not load the times</AlertTitle>
                <AlertDescription>
                  <Button
                    variant="outline"
                    className="mt-2 h-12"
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
                reason="Booking calendar not available"
                intro="We could not check our calendar just now. We can contact you to arrange a time instead."
              />
            ) : slots.length === 0 ? (
              <ContactPath
                token={token}
                context={ctx}
                reason="No times available online"
                intro={`There are no times free for a ${ROUTE_COPY[route].noun} in the next few weeks. We can contact you to arrange one.`}
              />
            ) : (
              <>
                <fieldset data-field="slot" className="min-w-0">
                  <legend className="text-ink mb-2 text-base font-medium">Suggested times</legend>
                  <ul className="flex flex-col gap-2">
                    {suggestions.map((s) => {
                      const active = chosen?.start === s.start
                      return (
                        <li key={s.start}>
                          <button
                            type="button"
                            aria-pressed={active}
                            data-invalid={slotError ? true : undefined}
                            onClick={() => choose(s)}
                            className={cn(
                              'text-ink flex min-h-12 w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left text-base tabular-nums transition-colors duration-150 motion-reduce:transition-none',
                              active
                                ? 'border-action bg-soft border-2 px-[15px] py-[11px]'
                                : 'border-input',
                            )}
                          >
                            {formatSlotShort(s.start)}
                            <span
                              aria-hidden="true"
                              className={cn(
                                'flex size-6 shrink-0 items-center justify-center rounded-full border',
                                active ? 'border-action bg-action text-white' : 'border-input',
                              )}
                            >
                              {active && <Check className="size-4" />}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {slotError && (
                    <p role="alert" className="text-destructive mt-2 text-sm">
                      {slotError}
                    </p>
                  )}
                </fieldset>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 h-auto min-h-12 w-full py-3 text-base whitespace-normal"
                  aria-expanded={showAll}
                  aria-controls="all-times"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? 'Hide other times' : 'See more times'}
                </Button>
                {showAll && (
                  <div
                    id="all-times"
                    className="motion-safe:animate-in motion-safe:fade-in mt-6 duration-150"
                  >
                    <SlotPicker slots={slots} selected={chosen} onSelect={choose} />
                  </div>
                )}
                <p className="mt-3">
                  <button
                    type="button"
                    onClick={() => setAskContact(true)}
                    className="text-muted-foreground inline-flex min-h-12 items-center text-sm underline underline-offset-4"
                  >
                    None of these suit? Ask Q3 to contact me
                  </button>
                </p>

                <div className="border-rule mt-6 flex flex-col gap-4 border-t pt-6">
                  {route === 'phone' ? (
                    phone === null ? (
                      <p className="text-ink">
                        We’ll ring you on <span className="font-medium">{ctx.phone ?? '–'}</span>{' '}
                        <button
                          type="button"
                          onClick={() => setPhone(ctx.phone ?? '')}
                          className="inline-flex min-h-12 items-center underline underline-offset-4"
                        >
                          Change<span className="sr-only"> the number</span>
                        </button>
                      </p>
                    ) : (
                      <LineInput
                        id="time-phone"
                        label={ROUTE_COPY.phone.phoneLabel}
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(v) => {
                          setPhone(v)
                          setPhoneError(null)
                        }}
                        error={phoneError ?? undefined}
                      />
                    )
                  ) : needsAddress ? (
                    <fieldset className="flex min-w-0 flex-col gap-4">
                      <legend className="text-ink mb-2 text-base font-medium">Visit address</legend>
                      <LineInput
                        id="time-street"
                        label={streetField.label}
                        autoComplete="address-line1"
                        value={street}
                        onChange={(v) => {
                          setStreet(v)
                          setAddressErrors({})
                        }}
                        error={addressErrors.site_street}
                      />
                      <LineInput
                        id="time-unit"
                        label={unitField.label}
                        optional
                        autoComplete="address-line2"
                        value={unit}
                        onChange={setUnit}
                        error={addressErrors.site_unit}
                      />
                      <p className="text-muted-foreground text-sm">
                        Town or Eircode: <span className="text-ink">{ctx.location ?? '–'}</span>
                      </p>
                    </fieldset>
                  ) : (
                    <p className="text-ink">
                      We’ll meet you at{' '}
                      <span className="font-medium">{ctx.siteAddress?.replace(/\.\s*$/, '')}</span>{' '}
                      <button
                        type="button"
                        onClick={() => setEditAddress(true)}
                        className="inline-flex min-h-12 items-center underline underline-offset-4"
                      >
                        Change<span className="sr-only"> the address</span>
                      </button>
                    </p>
                  )}

                  {detailsRefused && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>
                        Those details could not be accepted. Check them and try again.
                      </AlertDescription>
                    </Alert>
                  )}
                  {commit.isError && !detailsRefused && (
                    <TroubleMessage
                      error={commit.error}
                      title="The booking has not gone through"
                      keptNote="Your enquiry is saved and the time is not booked yet."
                    />
                  )}
                  <Button
                    type="button"
                    size="lg"
                    className="h-auto min-h-12 w-full py-3 text-base whitespace-normal"
                    disabled={confirming}
                    onClick={book}
                  >
                    {confirming
                      ? 'Confirming your appointment…'
                      : commit.isError && !detailsRefused
                        ? 'Try again'
                        : bookLabel(route, chosen)}
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export function BookingPage() {
  const { token = '' } = useParams()
  const [search] = useSearchParams()
  const doParam = search.get('do')
  const initialAction = doParam === 'change' || doParam === 'cancel' ? doParam : null
  const context = useBookingContext(token)
  const [round, setRound] = useState(0)
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

  const current = status.data?.booking ?? latest
  const state = current?.state
  // One live region for the page's booking status, kept mounted across the screens.
  const announcement =
    state === 'confirmed' && current
      ? ROUTE_COPY[current.type.mode].booked
      : state === 'reserved' || state === 'calendar_pending'
        ? 'Confirming your appointment…'
        : ''

  let content: React.ReactNode
  if (context.isPending) {
    content = (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  } else if (context.isError) {
    content =
      context.error instanceof InvalidLinkError ? (
        <>
          <Heading>This link has expired</Heading>
          <p className="text-muted-foreground mt-2">
            Booking links work for 30 days. If you sent us an enquiry, we still have it and will
            contact you.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex min-h-12 items-center underline underline-offset-4"
          >
            Go to the home page
          </Link>
        </>
      ) : (
        <Alert variant="destructive" role="alert">
          <AlertTitle>We could not load your booking</AlertTitle>
          <AlertDescription>
            Check your connection and try again.
            <Button variant="outline" className="mt-2 h-12" onClick={() => void context.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )
  } else if (current && current.state === 'confirmed') {
    content = (
      <ManageBooking
        token={token}
        booking={current}
        reference={context.data.reference}
        initialAction={initialAction}
        onCancelled={() => setRound((r) => r + 1)}
      />
    )
  } else if (current && (current.state === 'reserved' || current.state === 'calendar_pending')) {
    content = <BookingPending booking={current} slow={slow} />
  } else {
    const ctx = context.data
    content = (
      <>
        <JourneyProgress current={2} />
        <div className="mt-6">
          {current?.state === 'cancelled' && (
            <Alert className="mb-6">
              <AlertTitle>Your appointment is cancelled</AlertTitle>
              <AlertDescription>
                {current.type.label} on {formatLongDate(current.start)} at{' '}
                {formatClock(current.start)} is cancelled and the time released. If you would like a
                new time, choose one below.
              </AlertDescription>
            </Alert>
          )}
          {current?.state === 'failed' && (
            <Alert className="mb-6">
              <AlertTitle>Your last booking did not go through</AlertTitle>
              <AlertDescription>
                We could not add it to our calendar, so the time was released. Please choose another
                time, or ask us to contact you.
              </AlertDescription>
            </Alert>
          )}
          <TimeScreen
            key={`${round}-${current?.id ?? 'none'}`}
            token={token}
            ctx={ctx}
            onBooked={() => void context.refetch()}
          />
        </div>
      </>
    )
  }

  return (
    <PublicLayout>
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>
      {content}
    </PublicLayout>
  )
}
