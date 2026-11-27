import { MapPin, Phone } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useAppointments, type StaffBooking } from '@/api/staff-booking'
import { Chips } from '@/components/staff/chips'
import { useLoadedAt } from '@/components/staff/use-loaded-at'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AGENDA_FILTERS,
  appointmentBadge,
  groupByDay,
  readAgendaFilter,
  splitAgenda,
} from '@/lib/agenda'
import { directionsHref, siteAddress, telHref } from '@/lib/enquiry-stage'
import { formatClock } from '@/lib/format'

function nameOf(b: StaffBooking): string {
  const name = b.enquiries?.answers.name
  return typeof name === 'string' && name.trim()
    ? name.trim()
    : (b.enquiries?.reference ?? 'Enquiry')
}

/** "Site visit · Dublin 8", "Call", or the type's own label for a mode this build does not know. */
function whatLine(b: StaffBooking): string {
  if (b.appointment_types.mode === 'phone') return 'Call'
  const town = b.enquiries?.answers.location
  const kind = b.appointment_types.mode === 'on_site' ? 'Site visit' : b.appointment_types.label
  return typeof town === 'string' && town.trim() && b.appointment_types.mode === 'on_site'
    ? `${kind} · ${town.trim()}`
    : kind
}

const icon =
  'border-edge hover:bg-soft inline-flex size-12 shrink-0 items-center justify-center rounded-md border'

function AgendaRow({ booking }: { booking: StaffBooking }) {
  const name = nameOf(booking)
  const badge = appointmentBadge(booking)
  const call = telHref(booking.enquiries?.answers.phone)
  const directions =
    booking.appointment_types.mode === 'on_site'
      ? directionsHref(
          booking.enquiries
            ? siteAddress(booking.enquiries.answers, booking.enquiries.site_details)
            : null,
        )
      : null
  return (
    <li className="bg-background flex items-center gap-2 rounded-md border p-2">
      <Link
        to={`/enquiries/${booking.enquiry_id}`}
        className="hover:bg-muted/50 flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-sm px-1"
      >
        <span className="text-title text-ink w-16 shrink-0 font-medium tabular-nums">
          {formatClock(booking.starts_at)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{name}</span>
          <span className="text-muted-foreground truncate text-sm">{whatLine(booking)}</span>
          {badge && (
            <span>
              <Badge
                variant="outline"
                className={
                  badge.tone === 'warn' ? 'border-amber-400 bg-amber-50 text-amber-950' : ''
                }
              >
                {badge.label}
              </Badge>
            </span>
          )}
        </span>
      </Link>
      {call && (
        <a href={call} className={icon} aria-label={`Call ${name}`}>
          <Phone className="size-5" aria-hidden="true" />
        </a>
      )}
      {directions && (
        <a
          href={directions}
          target="_blank"
          rel="noreferrer"
          className={icon}
          aria-label={`Directions to ${name}`}
        >
          <MapPin className="size-5" aria-hidden="true" />
        </a>
      )}
    </li>
  )
}

function Days({ bookings, now }: { bookings: StaffBooking[]; now: number }) {
  return (
    <div className="flex flex-col gap-4">
      {groupByDay(bookings, now).map((day) => (
        <section key={day.key} aria-labelledby={`day-${day.key}`} className="flex flex-col gap-2">
          <h2 id={`day-${day.key}`} className="text-base font-medium">
            {day.heading}
          </h2>
          <ul className="flex flex-col gap-2">
            {day.bookings.map((b) => (
              <AgendaRow key={b.id} booking={b} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function AppointmentsPage() {
  const appointments = useAppointments()
  const [params, setParams] = useSearchParams()
  const filter = readAgendaFilter(`?${params.toString()}`)
  const now = useLoadedAt(appointments.dataUpdatedAt)

  return (
    <div className="flex flex-col gap-3">
      <ExceptionsBanner />
      <h1 className="text-section text-ink font-medium">Appointments</h1>
      <Chips
        name="agenda-filter"
        legend="Show"
        options={AGENDA_FILTERS}
        value={filter}
        onChange={(key) => setParams(key === 'upcoming' ? {} : { show: key }, { replace: true })}
      />
      {appointments.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading appointments">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : appointments.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load appointments</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              className="mt-2 h-12"
              onClick={() => void appointments.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        (() => {
          const { upcoming, past } = splitAgenda(appointments.data, now)
          if (filter === 'past')
            return past.length === 0 ? (
              <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
                No past appointments.
              </p>
            ) : (
              <Days bookings={past} now={now} />
            )
          return (
            <>
              {/* Appointments that are over and need "How did it go?" are under Your move. */}
              <p className="text-muted-foreground text-sm">
                Over and not recorded yet? They are under{' '}
                <Link to="/" className="underline underline-offset-4">
                  Your move
                </Link>
                .
              </p>
              {upcoming.length === 0 ? (
                <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
                  No upcoming appointments.
                </p>
              ) : (
                <Days bookings={upcoming} now={now} />
              )}
            </>
          )
        })()
      )}
      <p className="text-muted-foreground text-xs">Times in Irish time.</p>
    </div>
  )
}
