import type { ReactNode } from 'react'
import { CircleCheck, Clock } from 'lucide-react'
import type { CustomerBooking } from '@/api/booking'
import { usePublicVisitDisclaimer } from '@/api/wording'
import { formatClock, formatLongDate } from '@/lib/format'
import { ROUTE_COPY } from '@/lib/journey'
import { WORDING } from '../../../supabase/functions/_shared/messages.ts'

/** "Anna will ring you on 087 …" / "Anna will meet you at 12 Example Road, Dublin 8." */
export function whatHappens(booking: CustomerBooking): string {
  if (booking.type.mode === 'phone') {
    return `${booking.staffFirstName} will ring you${booking.phone ? ` on ${booking.phone}` : ''}.`
  }
  const address = (booking.address ?? 'the address you gave us').replace(/\.\s*$/, '')
  return `${booking.staffFirstName} will meet you at ${address}.`
}

function When({ booking }: { booking: CustomerBooking }) {
  return (
    <dl className="mt-6 flex flex-col divide-y rounded-md border">
      <div className="flex flex-col gap-0.5 p-4">
        <dt className="text-muted-foreground text-sm">Appointment</dt>
        <dd className="text-base">{booking.type.label}</dd>
      </div>
      <div className="flex flex-col gap-0.5 p-4">
        <dt className="text-muted-foreground text-sm">When</dt>
        <dd className="text-base">
          {formatLongDate(booking.start)} at {formatClock(booking.start)}
          <span className="text-muted-foreground block text-sm">
            Irish time ({booking.timezone}), about {booking.type.durationMinutes} minutes
          </span>
        </dd>
      </div>
      <div className="flex flex-col gap-0.5 p-4">
        <dt className="text-muted-foreground text-sm">
          {booking.type.mode === 'phone' ? 'How' : 'Where'}
        </dt>
        <dd className="text-base">{whatHappens(booking)}</dd>
      </div>
    </dl>
  )
}

/**
 * The receipt. It leads with the date, time and length and what will happen, then the
 * reference, then the change and cancel actions (`actions`). Shown only once the booking is
 * confirmed (calendar event created), so the heading matches the saved state.
 */
export function BookingConfirmed({
  booking,
  reference,
  actions,
  offer,
}: {
  booking: CustomerBooking
  reference: string
  actions?: ReactNode
  /** "Help us prepare (optional)", after the actions. */
  offer?: ReactNode
}) {
  const visitDisclaimer = usePublicVisitDisclaimer()
  return (
    <section aria-labelledby="booked-heading">
      <CircleCheck className="size-8" aria-hidden="true" />
      <h1 id="booked-heading" className="text-section text-ink mt-4 font-medium">
        {ROUTE_COPY[booking.type.mode].booked}
      </h1>
      <p className="text-title text-ink mt-6 font-medium">
        {formatLongDate(booking.start)}, {formatClock(booking.start)}
      </p>
      <p className="text-muted-foreground mt-1">
        {booking.type.durationMinutes} minutes · Irish time
      </p>
      <p className="text-ink mt-4">{whatHappens(booking)}</p>
      <p className="text-muted-foreground mt-4 text-sm">
        Reference <span className="text-ink font-mono">{reference}</span>
      </p>
      {actions}
      {offer}
      <p className="text-muted-foreground mt-8">We will email you a confirmation.</p>
      <h2 className="text-title text-ink mt-8 font-medium">To prepare</h2>
      <p className="text-muted-foreground mt-2">{booking.whatToPrepare}</p>
      <p className="bg-soft text-muted-foreground mt-6 rounded-md px-4 py-3 text-sm leading-relaxed">
        {booking.type.mode === 'on_site' ? visitDisclaimer : WORDING.call_disclaimer.default}
      </p>
    </section>
  )
}

export function BookingPending({ booking, slow }: { booking: CustomerBooking; slow: boolean }) {
  return (
    <section aria-labelledby="pending-heading">
      <Clock className="size-8 motion-safe:animate-pulse" aria-hidden="true" />
      <h1 id="pending-heading" className="text-section text-ink mt-4 font-medium">
        Confirming your appointment…
      </h1>
      <p className="text-muted-foreground mt-2">
        {slow
          ? 'This is taking longer than usual. The time is held for you while we finish; you can close this page. We will email you as soon as it is confirmed, or contact you if anything goes wrong.'
          : 'We are holding this time and adding it to our calendar. This usually takes a few seconds.'}
      </p>
      <When booking={booking} />
    </section>
  )
}
