// "How did it go?" (review P4): one sheet for calls and visits. An outcome is a question with
// answers, each saying what happens next; it replaces Attended / No-show, "We already spoke" and
// "Mark as contacted" as separate controls. The server actions behind them are unchanged.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCallHeldEarly } from '@/api/after-call'
import { useSetEnquiryStatus, type EnquiryDetail } from '@/api/enquiries'
import { useSetAttendance, type StaffBooking } from '@/api/staff-booking'
import { AfterCallChoices, taskPath } from '@/components/staff/after-call'
import { MovePanel } from '@/components/staff/booking-actions'
import { Button } from '@/components/ui/button'
import { formatShortWhen } from '@/lib/format'

/** What "How did it go?" is about: an appointment that has started, a call still to come, or a ring. */
export type OutcomeTarget =
  | { kind: 'passed'; booking: StaffBooking }
  | { kind: 'coming'; booking: StaffBooking }
  | { kind: 'ring' }

/** The appointment the question is about, from the enquiry's bookings. */
export function outcomeTarget(bookings: StaffBooking[], now: number): OutcomeTarget {
  const confirmed = bookings.filter((b) => b.state === 'confirmed')
  const passed = confirmed
    .filter((b) => Date.parse(b.starts_at) <= now && !b.attendance)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0]
  if (passed) return { kind: 'passed', booking: passed }
  const coming = bookings
    .filter(
      (b) =>
        ['reserved', 'calendar_pending', 'confirmed'].includes(b.state) &&
        Date.parse(b.starts_at) > now &&
        b.appointment_types.mode === 'phone',
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]
  return coming ? { kind: 'coming', booking: coming } : { kind: 'ring' }
}

/** The question's title: "How did the call go?", "How did the site visit go?", or "How did it go?". */
export function outcomeTitle(target: OutcomeTarget): string {
  if (target.kind === 'ring') return 'How did it go?'
  return target.booking.appointment_types.mode === 'on_site'
    ? 'How did the site visit go?'
    : 'How did the call go?'
}

type Step = 'ask' | 'move' | 'next'

function Choice({
  title,
  line,
  onClick,
  disabled,
}: {
  title: string
  line: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="border-edge hover:bg-soft flex min-h-14 w-full flex-col items-start justify-center rounded-md border px-3 py-2 text-left disabled:opacity-60"
      >
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground text-sm">{line}</span>
      </button>
    </li>
  )
}

export function HowDidItGo({
  enquiry,
  bookings,
  now,
  close,
}: {
  enquiry: EnquiryDetail
  bookings: StaffBooking[]
  now: number
  close: () => void
}) {
  const navigate = useNavigate()
  const [target] = useState(() => outcomeTarget(bookings, now))
  const [step, setStep] = useState<Step>('ask')
  const attendance = useSetAttendance()
  const spoke = useCallHeldEarly(enquiry.id)
  const status = useSetEnquiryStatus()
  const busy = attendance.isPending || spoke.isPending || status.isPending
  const failed = attendance.isError || spoke.isError || status.isError

  if (step === 'move' && target.kind !== 'ring')
    return <MovePanel booking={target.booking} onDone={close} />
  if (step === 'next')
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">Choose the next step.</p>
        <AfterCallChoices enquiry={enquiry} now={now} />
      </div>
    )

  const visit = target.kind !== 'ring' && target.booking.appointment_types.mode === 'on_site'
  const record = (value: 'attended' | 'no_show', after: () => void) =>
    target.kind === 'passed' &&
    attendance.mutate({ bookingId: target.booking.id, attendance: value }, { onSuccess: after })
  // Each answer moves on in place: a visit straight to the estimate form, a call to its next step.
  const wentAhead = () =>
    record('attended', () => {
      if (!visit) return setStep('next')
      close()
      navigate(taskPath(enquiry.id, 'estimate'))
    })

  return (
    <div className="flex flex-col gap-3">
      {target.kind !== 'ring' && (
        <p className="text-muted-foreground text-sm">{formatShortWhen(target.booking.starts_at)}</p>
      )}
      <ul className="flex flex-col gap-2">
        {target.kind === 'passed' && (
          <>
            <Choice
              title="It went ahead"
              line={visit ? 'Next: write the estimate' : 'Next: choose the next step'}
              onClick={wentAhead}
              disabled={busy}
            />
            <Choice
              title={visit ? 'We met earlier' : 'We spoke earlier'}
              line="Same as went ahead"
              onClick={wentAhead}
              disabled={busy}
            />
            <Choice
              title="They didn’t show"
              line="Next: ring them, then rebook"
              onClick={() => record('no_show', close)}
              disabled={busy}
            />
            <Choice
              title="Moved to another day"
              line="Opens the diary picker"
              onClick={() => setStep('move')}
              disabled={busy}
            />
          </>
        )}
        {target.kind === 'coming' && (
          <>
            <Choice
              title="We spoke earlier"
              line={`Records the call as held today. The call booked for ${formatShortWhen(target.booking.starts_at)} is cancelled, with no email to them. Next: choose the next step`}
              onClick={() => spoke.mutate(undefined, { onSuccess: () => setStep('next') })}
              disabled={busy}
            />
            <Choice
              title="Moved to another day"
              line="Opens the diary picker"
              onClick={() => setStep('move')}
              disabled={busy}
            />
          </>
        )}
        {target.kind === 'ring' && (
          <>
            <Choice
              title="We spoke"
              line="Records the call as held today. Next: choose the next step"
              onClick={() => spoke.mutate(undefined, { onSuccess: () => setStep('next') })}
              disabled={busy}
            />
            <Choice
              title="No answer, or I left a message"
              line="Marks them as contacted; they are then waiting on them"
              onClick={() =>
                status.mutate(
                  { id: enquiry.id, status: 'contacted', reason: null },
                  { onSuccess: close },
                )
              }
              disabled={busy || enquiry.status === 'contacted'}
            />
          </>
        )}
      </ul>
      <Button
        variant="ghost"
        className="h-12 self-center underline underline-offset-4"
        onClick={close}
      >
        Not now
      </Button>
      {busy && <output className="text-muted-foreground block text-sm">Saving…</output>}
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {spoke.error?.message.includes('site visit booked')
            ? 'A site visit is already booked.'
            : 'Not saved. Try again.'}
        </p>
      )}
    </div>
  )
}
