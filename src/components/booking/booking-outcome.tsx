import { CircleCheck, Clock } from 'lucide-react'
import type { CustomerBooking } from '@/api/booking'
import { formatClock, formatLongDate } from '@/lib/format'

function When({ booking }: { booking: CustomerBooking }) {
  return (
    <dl className="mt-6 flex flex-col divide-y rounded-xl border">
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
        <dd className="text-base whitespace-pre-line">
          {booking.type.mode === 'phone'
            ? `${booking.staffFirstName} will ring you${booking.phone ? ` on ${booking.phone}` : ''}.`
            : `${booking.staffFirstName} will visit you at:\n${booking.address ?? 'the address you gave us'}`}
        </dd>
      </div>
    </dl>
  )
}

export function BookingConfirmed({
  booking,
  reference,
}: {
  booking: CustomerBooking
  reference: string
}) {
  return (
    <section aria-labelledby="booked-heading">
      <CircleCheck className="size-8" aria-hidden="true" />
      <h1 id="booked-heading" className="text-section text-ink mt-4 font-bold">
        {booking.type.mode === 'on_site' ? 'Your site visit is booked' : 'Your call is booked'}
      </h1>
      <p className="text-muted-foreground mt-2">
        We will email you a confirmation. Your reference is{' '}
        <span className="text-foreground font-mono">{reference}</span>.
      </p>
      <When booking={booking} />
      <h2 className="text-title text-ink mt-8 font-bold">To prepare</h2>
      <p className="text-muted-foreground mt-2">{booking.whatToPrepare}</p>
      <p className="bg-muted text-muted-foreground mt-6 rounded-lg px-4 py-3 text-sm leading-relaxed">
        {booking.type.mode === 'on_site'
          ? 'This visit is for us to assess and price the work. It does not commit you to a quote, and it is not a start date.'
          : 'This call is to talk your project through. It does not commit you to anything.'}
      </p>
    </section>
  )
}

export function BookingPending({ booking, slow }: { booking: CustomerBooking; slow: boolean }) {
  return (
    <section aria-labelledby="pending-heading" aria-live="polite">
      <Clock className="size-8 animate-pulse" aria-hidden="true" />
      <h1 id="pending-heading" className="text-section text-ink mt-4 font-bold">
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
