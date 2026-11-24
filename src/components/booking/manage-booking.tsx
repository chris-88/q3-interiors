import { useEffect, useRef, useState } from 'react'
import {
  useCancelBooking,
  useMoveOptions,
  useReschedule,
  type CustomerBooking,
  type Slot,
} from '@/api/booking'
import { BookingConfirmed } from '@/components/booking/booking-outcome'
import { SlotPicker } from '@/components/booking/slot-picker'
import { TroubleMessage } from '@/components/trouble-message'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatClock, formatLongDate } from '@/lib/format'

type Mode = 'view' | 'move' | 'move_confirm' | 'cancel'

function Heading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      className="text-section text-ink font-bold text-balance outline-none"
    >
      {children}
    </h1>
  )
}

/** "Ring us" for changes inside the cut-off. */
export function RingUs({ phone }: { phone: string | null }) {
  return (
    <p className="text-muted-foreground">
      It is too close to your appointment to change it online.{' '}
      {phone ? (
        <>
          Please ring us on{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href={`tel:${phone.replace(/[^\d+]/g, '')}`}
          >
            {phone}
          </a>
          .
        </>
      ) : (
        'Please reply to your confirmation email and we will sort it out.'
      )}
    </p>
  )
}

const buttonRow = 'mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between'

/** The confirmed booking, with change and cancel for the customer. */
export function ManageBooking({
  token,
  booking,
  reference,
  onCancelled,
}: {
  token: string
  booking: CustomerBooking
  reference: string
  /** Lets the page start a fresh booking once this one is cancelled. */
  onCancelled: () => void
}) {
  const [mode, setMode] = useState<Mode>('view')
  const [slot, setSlot] = useState<Slot | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [alternatives, setAlternatives] = useState<Slot[] | null>(null)
  const [reason, setReason] = useState('')
  const [tooLatePhone, setTooLatePhone] = useState<string | null | undefined>(undefined)
  const options = useMoveOptions(token, mode === 'move' || mode === 'move_confirm')
  const reschedule = useReschedule(token)
  const cancel = useCancelBooking(token, (result) => {
    if (result.status === 'too_late') setTooLatePhone(result.businessPhone)
    else onCancelled()
  })

  const backToView = () => {
    setMode('view')
    setSlot(null)
    setAlternatives(null)
  }

  if (tooLatePhone !== undefined) {
    return (
      <section>
        <Heading>Please ring us</Heading>
        <div className="mt-2">
          <RingUs phone={tooLatePhone} />
        </div>
      </section>
    )
  }

  if (mode === 'cancel') {
    return (
      <section>
        <Heading>Cancel your appointment?</Heading>
        <p className="text-muted-foreground mt-2">
          {booking.type.label} on {formatLongDate(booking.start)} at {formatClock(booking.start)}{' '}
          (Irish time). The time will be released.
        </p>
        <Field className="mt-6">
          <FieldLabel htmlFor="cancel-reason">Reason (optional)</FieldLabel>
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="text-base"
          />
        </Field>
        {cancel.isError && (
          <TroubleMessage
            error={cancel.error}
            title="We could not cancel it just now"
            keptNote="Your appointment is unchanged."
          />
        )}
        <div className={buttonRow}>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 text-base"
            onClick={backToView}
            disabled={cancel.isPending}
          >
            Keep my appointment
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="h-12 text-base sm:px-6"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(reason)}
          >
            {cancel.isPending ? 'Cancelling…' : 'Yes, cancel it'}
          </Button>
        </div>
      </section>
    )
  }

  if (mode === 'move' || mode === 'move_confirm') {
    const data = options.data
    return (
      <section>
        <Heading>{mode === 'move' ? 'Choose a new time' : 'Move your appointment?'}</Heading>
        <p className="text-muted-foreground mt-2">
          Now: {formatLongDate(booking.start)} at {formatClock(booking.start)}. Times are Irish time
          (Europe/Dublin).
        </p>
        {notice && (
          <Alert className="mt-4">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {mode === 'move_confirm' && slot ? (
          <>
            <dl className="mt-6 rounded-xl border p-4">
              <dt className="text-muted-foreground text-sm">New time</dt>
              <dd className="text-base">
                {formatLongDate(slot.start)} at {formatClock(slot.start)}
              </dd>
            </dl>
            {reschedule.isError && (
              <TroubleMessage
                error={reschedule.error}
                title="We could not move it just now"
                keptNote="Your appointment is unchanged."
              />
            )}
            <div className={buttonRow}>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 text-base"
                onClick={() => setMode('move')}
                disabled={reschedule.isPending}
              >
                Back
              </Button>
              <Button
                type="button"
                size="lg"
                className="h-12 text-base sm:px-6"
                disabled={reschedule.isPending}
                onClick={() =>
                  reschedule.mutate(slot.start, {
                    onSuccess: (result) => {
                      if (result.status === 'rescheduled') {
                        setNotice(null)
                        backToView()
                      } else if (result.status === 'slot_unavailable') {
                        setNotice(
                          'That time has just been booked. Pick another time. Your appointment is unchanged.',
                        )
                        setAlternatives(result.alternatives)
                        setSlot(null)
                        setMode('move')
                      } else if (result.status === 'too_late') {
                        setTooLatePhone(result.businessPhone)
                      } else {
                        setNotice(
                          'We could not check our calendar just now. Your appointment is unchanged.',
                        )
                        setMode('move')
                      }
                    },
                  })
                }
              >
                {reschedule.isPending ? 'Moving…' : 'Move to this time'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {alternatives && alternatives.length > 0 && (
              <ul aria-label="Nearest free times" className="mt-3 flex flex-col gap-2">
                {alternatives.slice(0, 3).map((alt) => (
                  <li key={alt.start}>
                    <Button
                      type="button"
                      variant={slot?.start === alt.start ? 'default' : 'outline'}
                      aria-pressed={slot?.start === alt.start}
                      className="h-12 w-full justify-start text-base"
                      onClick={() => setSlot(alt)}
                    >
                      {formatLongDate(alt.start)}, {formatClock(alt.start)}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6">
              {options.isPending ? (
                <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading times">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : options.isError || !data ? (
                <Alert variant="destructive">
                  <AlertTitle>We could not load the times</AlertTitle>
                  <AlertDescription>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void options.refetch()}
                    >
                      Try again
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : data.status === 'too_late' ? (
                <RingUs phone={data.businessPhone} />
              ) : data.status !== 'ok' ? (
                <p className="text-muted-foreground">
                  We cannot show other times right now. Your appointment is unchanged; reply to your
                  confirmation email if you need to move it.
                </p>
              ) : data.slots.length === 0 ? (
                <p className="text-muted-foreground">
                  There are no other free times at the moment.
                </p>
              ) : (
                <SlotPicker
                  key={alternatives?.[0]?.start ?? 'all'}
                  slots={data.slots}
                  selected={slot}
                  initialDate={alternatives?.[0]?.date ?? booking.start.slice(0, 10)}
                  onSelect={setSlot}
                />
              )}
            </div>
            <div className={buttonRow}>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 text-base"
                onClick={backToView}
              >
                Keep my current time
              </Button>
              <Button
                type="button"
                size="lg"
                className="h-12 text-base sm:px-6"
                disabled={!slot}
                onClick={() => setMode('move_confirm')}
              >
                Continue
              </Button>
            </div>
          </>
        )}
      </section>
    )
  }

  return (
    <>
      {reschedule.isSuccess && reschedule.data.status === 'rescheduled' && (
        <Alert className="mb-6">
          <AlertDescription>
            Your appointment has moved. We will email you the new time.
          </AlertDescription>
        </Alert>
      )}
      <BookingConfirmed booking={booking} reference={reference} />
      <section aria-labelledby="change-heading" className="mt-10">
        <h2 id="change-heading" className="text-title text-ink font-bold">
          Change or cancel
        </h2>
        {booking.canChange ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 text-base"
              onClick={() => {
                setNotice(null)
                setMode('move')
              }}
            >
              Choose another time
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-12 text-base"
              onClick={() => setMode('cancel')}
            >
              Cancel appointment
            </Button>
          </div>
        ) : (
          <div className="mt-2">
            <RingUs phone={booking.businessPhone} />
          </div>
        )}
      </section>
    </>
  )
}
