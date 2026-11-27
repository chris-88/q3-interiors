import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, Mail, MapPin, Phone } from 'lucide-react'
import { Link, useParams } from 'react-router'
import {
  ENQUIRY_STATUSES,
  NOTE_MAX,
  noteSchema,
  useAddNote,
  useEnquiries,
  useEnquiry,
  useEnquiryPhotoFile,
  useEnquiryPhotos,
  useFormVersions,
  useSetEnquiryStatus,
  statusLabel,
  type EnquiryAttribution,
  type EnquiryDetail,
  type EnquiryEvent,
  type EnquiryPhoto,
} from '@/api/enquiries'
import { useEnquiryBookings, type StaffBooking } from '@/api/staff-booking'
import {
  AfterCallChoices,
  BookACall,
  MissedAppointment,
  WeAlreadySpoke,
  WRITE_ESTIMATE_EVENT,
} from '@/components/staff/after-call'
import { BookingActions } from '@/components/staff/booking-actions'
import { QuoteSection, QuoteSummary, WRITE_QUOTE_EVENT } from '@/components/staff/quote-section'
import { currentQuote } from '@/api/quotes'
import { ChaseForm } from '@/components/staff/chase-form'
import { DueChip } from '@/components/staff/due-chip'
import { DeleteEnquiry } from '@/components/staff/delete-enquiry'
import {
  EstimateSection,
  EstimateSummary,
  estimateVisits,
} from '@/components/staff/estimate-section'
import { enquiryName, projectLine, storedSearch } from '@/components/staff/enquiry-text'
import { eventLine } from '@/components/staff/event-text'
import { ListWalk } from '@/components/staff/list-walk'
import { OutcomeForm } from '@/components/staff/outcome-form'
import { StageBadge } from '@/components/staff/stage-badge'
import { useLoadedAt } from '@/components/staff/use-loaded-at'
import { StatusForm } from '@/components/staff/status-form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatAnswer, visibleFields } from '@/forms/logic'
import type { FormDefinition } from '@/forms/types'
import { appointmentBadge } from '@/lib/agenda'
import {
  missedBooking,
  currentEstimate,
  directionsHref,
  enquiryStage,
  mailHref,
  nextStep,
  passedBooking,
  siteAddress,
  telHref,
  upcomingBooking,
  groupStages,
  stageOf,
} from '@/lib/enquiry-stage'
import { formatDateTime, formatShortWhen } from '@/lib/format'
import { OUTCOME_STAGES } from '@/lib/outcome'
import { isKnown } from '@/lib/tolerant'
import { neighbours } from '@/lib/walk'
import { findProject } from '@/lib/website'

// ---------------------------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------------------------

/** A value a newer release wrote: shown plainly, changeable after a reload. */
function NewerValue({ what }: { what: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{what.trim()}</p>
      <p className="text-muted-foreground">
        This was set by a newer version of the console. Reload to change it here.
      </p>
      <Button
        variant="outline"
        className="h-12 self-start"
        onClick={() => window.location.reload()}
      >
        Reload
      </Button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={id} className="bg-background rounded-md border p-4">
      <h2 id={id} className="text-base font-medium">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="break-words whitespace-pre-line">{children}</dd>
    </div>
  )
}

function ContactValue({ type, value }: { type: string; value: string }) {
  const href = type === 'email' ? mailHref(value) : type === 'tel' ? telHref(value) : null
  return href ? (
    <a className="underline underline-offset-4" href={href}>
      {value}
    </a>
  ) : (
    <>{value}</>
  )
}

// ---------------------------------------------------------------------------------------------
// Top: walk, header, quick actions
// ---------------------------------------------------------------------------------------------

/** Previous / "3 of 12" / Next through the list as last shown (chip and search, this tab). */
function EnquiryWalk({ id }: { id: string }) {
  const list = useEnquiries()
  const now = useLoadedAt(list.dataUpdatedAt)
  if (!list.data) return null
  // The list as shown: Your move, In the diary, Waiting on them (or Finished, for a finished one).
  const g = groupStages(list.data, storedSearch(), now)
  const open = [...g.your_move, ...g.diary, ...g.waiting].map((e) => e.id)
  const ids = open.includes(id) ? open : g.finished.map((e) => e.id)
  const place = neighbours(ids, id)
  return place ? (
    <ListWalk label="Enquiries in this list" place={place} to={(t) => `/enquiries/${t}`} />
  ) : null
}

const quick =
  'border-edge hover:bg-soft flex min-h-14 flex-col items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium'

function QuickActions({ enquiry }: { enquiry: EnquiryDetail }) {
  const call = telHref(enquiry.answers.phone)
  const email = mailHref(enquiry.answers.email)
  const directions = directionsHref(siteAddress(enquiry.answers, enquiry.site_details))
  const items = [
    call && { href: call, label: 'Call', icon: Phone },
    email && { href: email, label: 'Email', icon: Mail },
    directions && { href: directions, label: 'Directions', icon: MapPin, external: true },
  ].filter((x) => !!x)
  if (items.length === 0) return null
  return (
    <nav aria-label="Quick actions" className="grid auto-cols-fr grid-flow-col gap-2">
      {items.map(({ href, label, icon: Icon, ...rest }) => (
        <a
          key={label}
          href={href}
          className={quick}
          {...('external' in rest ? { target: '_blank', rel: 'noreferrer' } : {})}
        >
          <Icon className="size-5" aria-hidden="true" />
          {label}
        </a>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------------------------
// Next step: the one thing to do at this stage
// ---------------------------------------------------------------------------------------------

function MarkContacted({ enquiry }: { enquiry: EnquiryDetail }) {
  const setStatus = useSetEnquiryStatus()
  if (enquiry.status === 'contacted' || !isKnown(ENQUIRY_STATUSES, enquiry.status)) return null
  return (
    <>
      <Button
        variant="outline"
        className="h-12 w-full sm:w-auto sm:px-6"
        disabled={setStatus.isPending}
        onClick={() => setStatus.mutate({ id: enquiry.id, status: 'contacted', reason: null })}
      >
        {setStatus.isPending ? 'Saving…' : 'Mark as contacted'}
      </Button>
      {setStatus.isError && (
        <p role="alert" className="text-destructive text-sm">
          Not saved. Try again.
        </p>
      )}
    </>
  )
}

function outcomeOf(e: EnquiryDetail) {
  return {
    stage: isKnown(OUTCOME_STAGES, e.outcome) ? e.outcome : null,
    quoteAmount: e.quote_amount,
    quoteDate: e.quote_date,
    wonValue: e.outcome_value,
    wonDate: e.won_date,
    reason: e.outcome_reason,
    note: e.outcome_note,
  }
}

const outcomeKey = (e: EnquiryDetail) =>
  `${e.outcome}-${e.outcome_value}-${e.quote_amount}-${e.outcome_reason}-${e.won_date}-${e.quote_date}-${e.outcome_note}`

/** For stages before an outcome: record a quote, win or loss without hunting for it. */
function OutcomeLater({
  enquiry,
  label = 'Record a quote or result',
}: {
  enquiry: EnquiryDetail
  label?: string
}) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <Button
        variant="ghost"
        className="h-12 self-start px-2 underline underline-offset-4"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    )
  return (
    <div className="border-t pt-3">
      <OutcomeForm
        key={outcomeKey(enquiry)}
        enquiryId={enquiry.id}
        current={outcomeOf(enquiry)}
        badge={false}
        primary="quote"
      />
    </div>
  )
}

function AppointmentSummary({ booking }: { booking: StaffBooking }) {
  const badge = appointmentBadge(booking)
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-muted-foreground text-sm">{booking.appointment_types.label}</p>
      <p className="text-title text-ink leading-tight font-medium tabular-nums">
        {formatShortWhen(booking.starts_at)}
      </p>
      {badge && (
        <div>
          <Badge variant="outline">{badge.label}</Badge>
        </div>
      )}
    </div>
  )
}

function NextStepCard({
  enquiry,
  bookings,
  now,
}: {
  enquiry: EnquiryDetail
  bookings: ReturnType<typeof useEnquiryBookings>
  now: number
}) {
  const stage = enquiryStage(enquiry, now)
  const step = nextStep(stage.key)
  const call = telHref(enquiry.answers.phone)
  const first = enquiryName(enquiry).split(' ')[0]
  const needsBooking = step === 'appointment' || step === 'record'
  const featured = featuredBooking(enquiry, bookings.data ?? [], now)
  // While the "Book a call" panel is open, its Book button is the one filled action.
  const [bookingCall, setBookingCall] = useState(false)
  const bookCall = <BookACall enquiry={enquiry} onOpenChange={setBookingCall} />

  let body: ReactNode
  if (needsBooking && bookings.isPending) body = <Skeleton className="h-24 w-full" />
  else if (needsBooking && bookings.isError)
    body = <p className="text-destructive text-sm">Could not load the appointment.</p>
  else if (step === 'contact')
    body = (
      <>
        <p>
          Asked to be contacted
          {enquiry.contact_requested_at ? `, ${formatDateTime(enquiry.contact_requested_at)}` : ''}
          {enquiry.contact_request_reason ? `: ${enquiry.contact_request_reason}` : ''}.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {call && (
            <a
              href={call}
              className={buttonVariants({
                variant: bookingCall ? 'outline' : 'default',
                className: 'h-12 w-full sm:w-auto sm:px-6',
              })}
            >
              Ring {first}
            </a>
          )}
          <MarkContacted enquiry={enquiry} />
          <WeAlreadySpoke enquiry={enquiry} call={null} />
        </div>
        {bookCall}
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  else if (step === 'reach')
    body = (
      <>
        <p>Not booked yet. Ring or email to arrange a time.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <MarkContacted enquiry={enquiry} />
          <WeAlreadySpoke enquiry={enquiry} call={null} />
        </div>
        {bookCall}
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  else if (step === 'waiting')
    body = (
      <>
        <p>Contacted. Nothing booked yet.</p>
        <WeAlreadySpoke enquiry={enquiry} call={null} />
        {bookCall}
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  else if (step === 'appointment' && featured)
    body = (
      <>
        <AppointmentSummary booking={featured} />
        <BookingActions booking={featured} attendance={false} />
        {featured.appointment_types.mode === 'phone' && (
          <WeAlreadySpoke enquiry={enquiry} call={featured} />
        )}
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  else if (step === 'missed') {
    const missed = missedBooking(enquiry, now)
    body = (
      <>
        <MissedAppointment
          enquiry={enquiry}
          mode={stage.key === 'missed_visit' ? 'on_site' : 'phone'}
          when={missed?.starts_at ?? null}
        />
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  } else if (step === 'after_call')
    body = (
      <>
        <AfterCallChoices enquiry={enquiry} now={now} />
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  else if (step === 'record')
    body = (
      <>
        {featured ? (
          <>
            <AppointmentSummary booking={featured} />
            <BookingActions booking={featured} moveCancel={false} />
          </>
        ) : (
          <p>The appointment has happened.</p>
        )}
        <p className="text-sm">No estimate sent yet.</p>
        {estimateVisits(bookings.data ?? []).length > 0 && (
          <Button
            className="h-12 w-full sm:w-auto sm:px-6"
            onClick={() => window.dispatchEvent(new Event(WRITE_ESTIMATE_EVENT))}
          >
            Write the estimate
          </Button>
        )}
        {/* Won and lost before anything has gone out stay one tap away, not as buttons. */}
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  else if (step === 'estimate') {
    const estimate = currentEstimate(enquiry.estimates)
    body = (
      <>
        {estimate && <EstimateSummary estimate={estimate} now={now} />}
        {stage.key === 'quote_requested' ? (
          <>
            <p className="text-sm">They asked for their quote.</p>
            <Button
              className="h-12 w-full sm:w-auto sm:px-6"
              onClick={() => window.dispatchEvent(new Event(WRITE_QUOTE_EVENT))}
            >
              Write the quote
            </Button>
            <OutcomeLater enquiry={enquiry} label="Record a quote sent another way" />
          </>
        ) : (
          <>
            {stage.key === 'no_answer' && (
              <p className="text-sm">No answer after 10 days. Ring to follow up.</p>
            )}
            <OutcomeLater enquiry={enquiry} />
          </>
        )}
      </>
    )
  } else if (step === 'quote_change' || (step === 'quoted' && currentQuote(enquiry.quotes))) {
    const quote = currentQuote(enquiry.quotes)
    body = (
      <>
        {quote && <QuoteSummary enquiry={enquiry} quote={quote} now={now} />}
        {step === 'quote_change' && (
          <Button
            className="h-12 w-full sm:w-auto sm:px-6"
            onClick={() => window.dispatchEvent(new Event(WRITE_QUOTE_EVENT))}
          >
            Send an updated quote
          </Button>
        )}
        <OutcomeForm
          key={outcomeKey(enquiry)}
          enquiryId={enquiry.id}
          current={outcomeOf(enquiry)}
          badge={false}
          primary="won"
        />
      </>
    )
  } else if (step === 'quoted' || step === 'result')
    body = (
      <OutcomeForm
        key={outcomeKey(enquiry)}
        enquiryId={enquiry.id}
        current={outcomeOf(enquiry)}
        badge={false}
        primary={step === 'quoted' ? 'won' : 'none'}
      />
    )
  else if (step === 'closed')
    body = (
      <>
        <p>Marked not suitable{enquiry.status_reason ? `: ${enquiry.status_reason}` : ''}.</p>
        <OutcomeLater enquiry={enquiry} />
      </>
    )
  else if (step === 'appointment')
    // The list said booked but the appointment is gone (moved or cancelled since): show the rest.
    body = <p>No upcoming appointment now. Reload to see the latest.</p>
  else
    body = (
      <NewerValue
        what={
          enquiry.outcome !== null && !isKnown(OUTCOME_STAGES, enquiry.outcome)
            ? `Outcome: ${enquiry.outcome} ${enquiry.outcome_reason ?? ''}`
            : `Status: ${enquiry.status}`
        }
      />
    )

  return (
    <section
      aria-labelledby="next-step"
      className="bg-background border-action flex flex-col gap-3 rounded-md border-2 p-4"
    >
      <h2 id="next-step" className="text-base font-medium">
        {step === 'result' ? 'Result' : 'Next step'}
      </h2>
      {body}
    </section>
  )
}

/**
 * The booking the Next step card holds (the next appointment, or the one that just happened), so
 * the list below does not repeat its controls. A full booking row has no confirmed time; its
 * state stands in for it.
 */
function featuredBooking(
  enquiry: EnquiryDetail,
  bookings: StaffBooking[],
  now: number,
): StaffBooking | null {
  const step = nextStep(enquiryStage(enquiry, now).key)
  const rows = bookings.map((b) => ({
    ...b,
    confirmed_at: b.state === 'confirmed' ? b.starts_at : null,
  }))
  if (step === 'appointment') return upcomingBooking(rows, now)
  if (step === 'record') return passedBooking(rows, now)
  return null
}

/** Next step already offers "Write the estimate", so the Estimate section does not repeat it. */
function writeOfferedAbove(enquiry: EnquiryDetail, bookings: StaffBooking[], now: number): boolean {
  const step = nextStep(enquiryStage(enquiry, now).key)
  return step === 'after_call' || (step === 'record' && estimateVisits(bookings).length > 0)
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/** Staff wording for the customer's questions (the form's own labels speak to the customer). */
const STAFF_LABELS: Record<string, string> = {
  appointment_preference: 'Wants',
  name: 'Name',
  phone: 'Phone',
  site_street: 'Street',
  site_unit: 'Apartment or unit',
  kitchen_layout: 'Kitchen layout',
  rooms_involved: 'Rooms',
  project_type_other: 'What they described',
}

/** Their answers, through the form version they answered; empty answers are left out. */
function Project({
  enquiry,
  form,
  siteForm,
}: {
  enquiry: EnquiryDetail
  form: FormDefinition | undefined
  siteForm: FormDefinition | undefined
}) {
  if (!form) {
    return (
      <Section title="Project">
        <p className="text-muted-foreground mb-3 text-sm">
          Form version {enquiry.form_version} could not be loaded, so answers are shown by field ID.
        </p>
        <dl className="flex flex-col gap-3">
          {Object.entries(enquiry.answers).map(([key, value]) => (
            <Row key={key} label={key}>
              {Array.isArray(value) ? value.join(', ') : value}
            </Row>
          ))}
        </dl>
      </Section>
    )
  }
  const rows = form.steps.flatMap((step) =>
    visibleFields(step.fields, enquiry.answers).flatMap((field) => {
      const value = formatAnswer(field, enquiry.answers[field.id])
      return value === null
        ? []
        : [
            <Row key={field.id} label={STAFF_LABELS[field.id] ?? field.label}>
              <ContactValue type={field.type} value={value} />
            </Row>,
          ]
    }),
  )
  // A v1 enquiry's address came later, as site details; v2 answers already hold the street.
  const site = enquiry.site_details
  if (site && !enquiry.answers.site_street) {
    for (const field of siteForm?.steps.flatMap((s) => s.fields) ?? []) {
      if (field.id === 'access_notes') continue
      const value = formatAnswer(field, site[field.id])
      if (value !== null)
        rows.push(
          <Row key={`site-${field.id}`} label={field.label}>
            {value}
          </Row>,
        )
    }
  }
  return (
    <Section title="Project">
      <dl className="flex flex-col gap-3">
        {rows}
        {enquiry.marketing_opt_in && enquiry.marketing_opt_in_at && (
          <Row label="News and offers">
            Asked for them ({formatDateTime(enquiry.marketing_opt_in_at)})
          </Row>
        )}
      </dl>
    </Section>
  )
}

/** The full-size photo in a modal dialog, fetched with the staff session. */
function PhotoViewer({ photo, onClose }: { photo: EnquiryPhoto; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const file = useEnquiryPhotoFile(photo.path)
  const url = useMemo(() => (file.data ? URL.createObjectURL(file.data) : null), [file.data])
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-label="Photo, full size"
      onClose={onClose}
      className="bg-background m-auto max-h-[95svh] w-[min(95vw,1000px)] rounded-md border p-3 backdrop:bg-black/70"
    >
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="h-12 self-end"
          autoFocus
          onClick={() => ref.current?.close()}
        >
          Close
        </Button>
        {file.isPending ? (
          <Skeleton className="aspect-[4/3] w-full" />
        ) : file.isError ? (
          <p className="text-destructive text-sm">Could not load the photo.</p>
        ) : url ? (
          <img
            src={url}
            alt="Added by the customer, full size"
            width={photo.width}
            height={photo.height}
            className="h-auto max-h-[80svh] w-full object-contain"
          />
        ) : null}
      </div>
    </dialog>
  )
}

/** "Help us prepare": budget, timing, access notes and photos the customer added after booking. */
function Prepared({
  enquiry,
  form,
  siteForm,
}: {
  enquiry: EnquiryDetail
  form: FormDefinition | undefined
  siteForm: FormDefinition | undefined
}) {
  const photos = useEnquiryPhotos(enquiry.id)
  const [open, setOpen] = useState<EnquiryPhoto | null>(null)
  const answers = enquiry.prepare_details ?? {}
  const rows = (form ? form.steps.flatMap((s) => s.fields) : []).flatMap((field) => {
    const value = formatAnswer(field, answers[field.id])
    return value === null ? [] : [{ id: field.id, label: field.label, value }]
  })
  const access = enquiry.site_details?.access_notes
  if (typeof access === 'string' && access.trim()) {
    const label = siteForm
      ? siteForm.steps.flatMap((s) => s.fields).find((f) => f.id === 'access_notes')?.label
      : undefined
    rows.push({ id: 'access_notes', label: label ?? 'Access notes', value: access.trim() })
  }
  const shownPhotos = photos.data ?? []
  if (!enquiry.added_after_booking_at && rows.length === 0 && shownPhotos.length === 0) return null
  return (
    <Section title="Help us prepare">
      {enquiry.added_after_booking_at && (
        <p className="mb-3 text-sm">
          <span className="bg-secondary rounded-md px-2 py-1 font-medium">Added after booking</span>{' '}
          <span className="text-muted-foreground">
            last change{' '}
            <time dateTime={enquiry.added_after_booking_at}>
              {formatDateTime(enquiry.added_after_booking_at)}
            </time>
          </span>
        </p>
      )}
      {rows.length > 0 && (
        <dl className="flex flex-col gap-3">
          {rows.map((r) => (
            <Row key={r.id} label={r.label}>
              {r.value}
            </Row>
          ))}
        </dl>
      )}
      {photos.isError ? (
        <p className="text-destructive mt-3 text-sm">Could not load the photos.</p>
      ) : photos.isPending ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : shownPhotos.length > 0 ? (
        <>
          <h3 className="text-muted-foreground mt-4 text-sm">Photos</h3>
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shownPhotos.map((photo, index) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => setOpen(photo)}
                  className="block w-full rounded-md"
                >
                  <img
                    src={photo.thumbUrl}
                    alt={`Customer upload ${index + 1}, added ${formatDateTime(photo.uploadedAt)}; open full size`}
                    className="aspect-square w-full rounded-md border object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {open && <PhotoViewer photo={open} onClose={() => setOpen(null)} />}
    </Section>
  )
}

function Appointments({
  bookings,
  featured,
}: {
  bookings: ReturnType<typeof useEnquiryBookings>
  featured: string | null
}) {
  if (bookings.isPending)
    return (
      <Section title="Appointments">
        <Skeleton className="h-16 w-full" />
      </Section>
    )
  if (bookings.isError)
    return (
      <Section title="Appointments">
        <p className="text-destructive text-sm">Could not load appointments.</p>
      </Section>
    )
  if (bookings.data.length === 0) return null
  const list = [...bookings.data].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
  return (
    <Section title="Appointments">
      <ul className="flex flex-col">
        {list.map((b) => {
          const badge = appointmentBadge(b)
          return (
            <li
              key={b.id}
              className="flex flex-col gap-1 border-t py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">{formatShortWhen(b.starts_at)}</span>
                {badge && <Badge variant="outline">{badge.label}</Badge>}
                {b.attendance === 'attended' && (
                  <span className="text-muted-foreground text-sm">Attended</span>
                )}
              </div>
              <span className="text-sm">{b.appointment_types.label}</span>
              {b.state === 'cancelled' && (
                <span className="text-muted-foreground text-sm">
                  Cancelled{b.cancelled_by ? ` by ${b.cancelled_by}` : ''}
                  {b.cancel_reason ? `: ${b.cancel_reason}` : ''}
                </span>
              )}
              {b.failure_reason && (
                <span className="text-destructive text-sm break-words">{b.failure_reason}</span>
              )}
              {b.id !== featured && b.state === 'confirmed' && (
                <BookingActions booking={b} moveCancel={false} />
              )}
              {b.calendar_event_link && (
                <a
                  href={b.calendar_event_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center self-start text-sm underline underline-offset-4"
                >
                  Open in Google Calendar
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Notes({ enquiry }: { enquiry: EnquiryDetail }) {
  const add = useAddNote(enquiry.id)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const notes = enquiry.enquiry_events.filter((e) => e.kind === 'note_added')
  const save = () => {
    const parsed = noteSchema.safeParse(text)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the note.')
      document.getElementById('new-note')?.focus()
      return
    }
    setError(null)
    add.mutate(parsed.data, { onSuccess: () => setText('') })
  }
  return (
    <Section title="Notes">
      {notes.length > 0 && (
        <ul className="mb-4 flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 pl-3">
              <p className="break-words whitespace-pre-line">{n.detail}</p>
              <p className="text-muted-foreground text-xs">
                {n.actor_name ?? 'Staff'} ·{' '}
                <time dateTime={n.created_at}>{formatDateTime(n.created_at)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
      <form
        noValidate
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label htmlFor="new-note" className="text-sm font-medium">
          Add a note
        </label>
        <Textarea
          id="new-note"
          rows={2}
          maxLength={NOTE_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'new-note-error' : undefined}
          className="text-base md:text-base"
        />
        {error && (
          <p id="new-note-error" role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {add.isError && (
          <p role="alert" className="text-destructive text-sm">
            The note was not saved. Try again.
          </p>
        )}
        <Button type="submit" className="h-12 self-start px-6" disabled={add.isPending}>
          {add.isPending ? 'Saving…' : 'Save note'}
        </Button>
      </form>
      <details className="group mt-4 border-t pt-2">
        <summary className="text-muted-foreground flex min-h-12 cursor-pointer items-center text-sm">
          Change status (now: {statusLabel(enquiry.status)})
        </summary>
        <section aria-label="Change status" className="pt-2">
          {isKnown(ENQUIRY_STATUSES, enquiry.status) ? (
            <StatusForm enquiryId={enquiry.id} current={enquiry.status} />
          ) : (
            <NewerValue what={`Status: ${enquiry.status}`} />
          )}
        </section>
      </details>
    </Section>
  )
}

/** "Kitchen fit-out, Fairview, Dublin 3" for a known website project, else the slug as stored. */
function websiteProjectLine(slug: string): string {
  const project = findProject(slug)
  return project ? `${project.title}, ${project.location}` : slug
}

function Attribution({ attribution }: { attribution: EnquiryAttribution | null }) {
  if (!attribution || attribution.tracking === 'unknown') {
    return (
      <Section title="Where they came from">
        <p className="text-sm">Unknown. The link they used carried no campaign tags.</p>
      </Section>
    )
  }
  const rows: [string, string | null][] = [
    ['Source', attribution.utm_source],
    ['Medium', attribution.utm_medium],
    ['Campaign', attribution.utm_campaign],
    ['Content', attribution.utm_content],
    ['Term', attribution.utm_term],
  ]
  return (
    <Section title="Where they came from">
      <dl className="grid grid-cols-2 gap-3">
        {rows.map(([label, value]) =>
          value ? (
            <Row key={label} label={label}>
              {value}
            </Row>
          ) : null,
        )}
        {attribution.click_id_present !== null && (
          <Row label="Ad click id">{attribution.click_id_present ? 'Present' : 'None'}</Row>
        )}
        {attribution.first_seen_at && (
          <Row label="First seen">{formatDateTime(attribution.first_seen_at)}</Row>
        )}
      </dl>
    </Section>
  )
}

function History({ events }: { events: EnquiryEvent[] }) {
  return (
    <Section title="History">
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No history recorded.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {events.map((event) => {
            const line =
              event.kind === 'note_added'
                ? { title: 'Note added', detail: event.detail }
                : eventLine(event)
            return (
              <li key={event.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
                <span className="text-sm font-medium">{line.title}</span>
                {line.detail && (
                  <span className="text-sm break-words whitespace-pre-line">{line.detail}</span>
                )}
                <span className="text-muted-foreground text-xs">
                  <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
                  {event.actor_name ? ` · ${event.actor_name}` : ''}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}

function More({ enquiry }: { enquiry: EnquiryDetail }) {
  return (
    <details className="bg-background group rounded-md border">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 text-base font-medium">
        More
      </summary>
      <div className="flex flex-col gap-3 border-t p-3">
        <p className="text-muted-foreground px-1 text-xs">
          Form: {enquiry.form_id} version {enquiry.form_version}
        </p>
        <History events={enquiry.enquiry_events} />
        <Attribution attribution={enquiry.enquiry_attribution} />
        <Section title="Had to chase details">
          <ChaseForm
            key={`${enquiry.chase_flagged_at}-${enquiry.chase_note}`}
            enquiryId={enquiry.id}
            current={{
              at: enquiry.chase_flagged_at,
              note: enquiry.chase_note,
              by: enquiry.chase_flagged_by_name,
            }}
          />
        </Section>
        <Section title="Delete">
          <DeleteEnquiry enquiryId={enquiry.id} reference={enquiry.reference} />
        </Section>
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

function EnquiryView({ enquiry, now }: { enquiry: EnquiryDetail; now: number }) {
  const forms = useFormVersions()
  const bookings = useEnquiryBookings(enquiry.id)
  const form = forms.data?.get(`${enquiry.form_id}@${enquiry.form_version}`)
  const siteForm = forms.data?.get(`site_details@${enquiry.site_details_form_version ?? 1}`)
  const view = stageOf(enquiry, now)
  const stage = view
  const featured = featuredBooking(enquiry, bookings.data ?? [], now)?.id ?? null
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="flex flex-col gap-4 lg:sticky lg:top-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-title text-ink leading-tight font-medium break-words">
            {enquiryName(enquiry)}
          </h1>
          <p className="text-muted-foreground">{projectLine(enquiry, form)}</p>
          {enquiry.inspiration && (
            <p className="text-sm">
              Came from the website: {websiteProjectLine(enquiry.inspiration)}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StageBadge stage={stage} />
            <DueChip view={view} />
            <span className="text-muted-foreground font-mono text-xs">{enquiry.reference}</span>
            <span className="text-muted-foreground text-xs">
              Received{' '}
              <time dateTime={enquiry.submitted_at}>{formatDateTime(enquiry.submitted_at)}</time>
            </span>
          </div>
        </div>
        <QuickActions enquiry={enquiry} />
        <NextStepCard enquiry={enquiry} bookings={bookings} now={now} />
      </div>
      <div className="flex flex-col gap-4">
        {forms.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <Project enquiry={enquiry} form={form} siteForm={siteForm} />
        )}
        <Prepared
          enquiry={enquiry}
          form={forms.data?.get(`prepare@${enquiry.prepare_form_version ?? 1}`)}
          siteForm={siteForm}
        />
        {bookings.data && (
          <EstimateSection
            enquiry={enquiry}
            bookings={bookings.data}
            now={now}
            offeredAbove={writeOfferedAbove(enquiry, bookings.data, now)}
          />
        )}
        <QuoteSection enquiry={enquiry} now={now} />
        <Appointments bookings={bookings} featured={featured} />
        <Notes enquiry={enquiry} />
        <More enquiry={enquiry} />
      </div>
    </div>
  )
}

export function EnquiryDetailPage() {
  const { id = '' } = useParams()
  const enquiry = useEnquiry(id)
  const now = useLoadedAt(enquiry.dataUpdatedAt)

  const top = (
    <div className="flex flex-wrap items-center justify-between gap-x-4">
      <Link
        to="/"
        className="text-primary inline-flex min-h-12 items-center gap-1 text-sm underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All enquiries
      </Link>
      <EnquiryWalk id={id} />
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      {top}
      {enquiry.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading enquiry">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : enquiry.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not load this enquiry</AlertTitle>
          <AlertDescription>
            <Button variant="outline" className="mt-2 h-12" onClick={() => void enquiry.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !enquiry.data ? (
        <p className="bg-background text-muted-foreground rounded-md border p-6">
          No enquiry with this link.
        </p>
      ) : (
        <EnquiryView key={enquiry.data.id} enquiry={enquiry.data} now={now} />
      )}
    </div>
  )
}
