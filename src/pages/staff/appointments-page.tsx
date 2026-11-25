import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { useAppointments, type StaffBooking } from '@/api/staff-booking'
import { BookingActions } from '@/components/staff/booking-actions'
import { BookingStateBadge } from '@/components/staff/booking-state-badge'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatClock, formatLongDate } from '@/lib/format'

const LIVE = new Set(['reserved', 'calendar_pending', 'confirmed'])

function Row({ booking, actions }: { booking: StaffBooking; actions?: boolean }) {
  const name = booking.enquiries?.answers.name
  return (
    <li>
      <Link
        to={`/enquiries/${booking.enquiry_id}`}
        className="bg-background hover:bg-muted/50 focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-3 focus-visible:outline-none"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium tabular-nums">
              {formatLongDate(booking.starts_at)}, {formatClock(booking.starts_at)}
            </span>
            <BookingStateBadge state={booking.state} />
          </div>
          <span className="truncate text-sm">
            {booking.appointment_types.label}
            {typeof name === 'string' ? ` · ${name}` : ''}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {booking.enquiries?.reference}
          </span>
        </div>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
      {actions && (
        <div className="px-1">
          <BookingActions booking={booking} />
        </div>
      )}
    </li>
  )
}

export function AppointmentsPage() {
  const appointments = useAppointments()
  const [now] = useState(() => Date.now())

  return (
    <>
      <ExceptionsBanner />
      <h1 className="text-xl font-semibold tracking-tight">Appointments</h1>
      <p className="text-muted-foreground mt-1 text-sm">Times in Irish time (Europe/Dublin).</p>
      {appointments.isPending ? (
        <div
          className="mt-4 flex flex-col gap-2"
          aria-busy="true"
          aria-label="Loading appointments"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : appointments.isError ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Could not load appointments</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void appointments.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        (() => {
          const upcoming = appointments.data.filter(
            (b) => LIVE.has(b.state) && Date.parse(b.ends_at) >= now,
          )
          const other = appointments.data
            .filter((b) => !upcoming.includes(b))
            .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
          return (
            <>
              <h2 className="text-muted-foreground mt-6 text-sm font-medium">Upcoming</h2>
              {upcoming.length === 0 ? (
                <p className="bg-background text-muted-foreground mt-2 rounded-xl border p-6 text-center">
                  No upcoming appointments.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {upcoming.map((b) => (
                    <Row key={b.id} booking={b} actions />
                  ))}
                </ul>
              )}
              {other.length > 0 && (
                <>
                  <h2 className="text-muted-foreground mt-8 text-sm font-medium">
                    Past and failed
                  </h2>
                  <ul className="mt-2 flex flex-col gap-2">
                    {other.map((b) => (
                      <Row key={b.id} booking={b} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )
        })()
      )}
    </>
  )
}
