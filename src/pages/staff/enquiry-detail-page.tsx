import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import {
  STATUS_LABELS,
  useEnquiry,
  useFormVersions,
  type EnquiryAttribution,
  type EnquiryDetail,
  type EnquiryEvent,
} from '@/api/enquiries'
import { StatusBadge } from '@/components/staff/status-badge'
import { StatusForm } from '@/components/staff/status-form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatAnswer, visibleFields } from '@/forms/logic'
import type { FormDefinition, FormField } from '@/forms/types'
import { formatClock, formatDateTime, formatLongDate } from '@/lib/format'
import { useEnquiryBookings } from '@/api/staff-booking'
import { BookingStateBadge } from '@/components/staff/booking-state-badge'

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={id} className="bg-background rounded-xl border p-4">
      <h2 id={id} className="text-muted-foreground text-sm font-medium">
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

function ContactValue({ field, value }: { field: FormField; value: string | null }) {
  if (value === null) return <span className="text-muted-foreground">Not given</span>
  if (field.type === 'email') {
    return (
      <a className="underline underline-offset-4" href={`mailto:${value}`}>
        {value}
      </a>
    )
  }
  if (field.type === 'tel') {
    return (
      <a className="underline underline-offset-4" href={`tel:${value.replace(/[^\d+]/g, '')}`}>
        {value}
      </a>
    )
  }
  return <>{value}</>
}

/** Answers rendered through the form version the customer actually answered. */
function Answers({ enquiry, form }: { enquiry: EnquiryDetail; form: FormDefinition }) {
  const contactStep = form.steps.find((s) => s.fields.some((f) => f.type === 'email'))
  const otherSteps = form.steps.filter((s) => s !== contactStep)
  return (
    <>
      {contactStep && (
        <Section title="Contact">
          <dl className="flex flex-col gap-3">
            {visibleFields(contactStep.fields, enquiry.answers).map((field) => (
              <Row key={field.id} label={field.label}>
                <ContactValue
                  field={field}
                  value={formatAnswer(field, enquiry.answers[field.id])}
                />
              </Row>
            ))}
            <Row label="News and offers">
              {enquiry.marketing_opt_in && enquiry.marketing_opt_in_at
                ? `Asked for them (${formatDateTime(enquiry.marketing_opt_in_at)})`
                : 'Not asked for'}
            </Row>
          </dl>
        </Section>
      )}
      <Section title="Project">
        <dl className="flex flex-col gap-3">
          {otherSteps.flatMap((step) =>
            visibleFields(step.fields, enquiry.answers).map((field) => (
              <Row key={field.id} label={field.label}>
                {formatAnswer(field, enquiry.answers[field.id]) ?? (
                  <span className="text-muted-foreground">Not answered</span>
                )}
              </Row>
            )),
          )}
        </dl>
        <p className="text-muted-foreground mt-4 text-xs">
          Form: {form.formId} version {form.version}
        </p>
      </Section>
    </>
  )
}

function RawAnswers({ enquiry }: { enquiry: EnquiryDetail }) {
  return (
    <Section title="Answers">
      <Alert className="mb-3">
        <AlertDescription>
          Form version {enquiry.form_version} could not be loaded, so answers are shown by field ID.
        </AlertDescription>
      </Alert>
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
        {rows.map(([label, value]) => (
          <Row key={label} label={label}>
            {value ?? <span className="text-muted-foreground">Unknown</span>}
          </Row>
        ))}
        <Row label="Ad click id">
          {attribution.click_id_present === null
            ? 'Unknown'
            : attribution.click_id_present
              ? 'Present'
              : 'None'}
        </Row>
        <Row label="First seen">
          {attribution.first_seen_at ? formatDateTime(attribution.first_seen_at) : 'Unknown'}
        </Row>
      </dl>
    </Section>
  )
}

const EVENT_TEXT: Partial<Record<EnquiryEvent['kind'], string>> = {
  submitted: 'Enquiry received',
  site_details_added: 'Customer added the property address',
  contact_requested: 'Customer asked to be contacted',
  booking_requested: 'Customer booked',
  booking_confirmed: 'Calendar event created; booking confirmed',
  booking_retrying: 'Calendar event not created yet; retrying',
  booking_failed: 'Booking failed',
  email_sent: 'Confirmation email sent',
  email_failed: 'Confirmation email not sent',
}

function eventText(event: EnquiryEvent): string {
  const fixed = EVENT_TEXT[event.kind]
  if (fixed) return fixed
  const to = event.to_status ? STATUS_LABELS[event.to_status] : 'unknown'
  const from = event.from_status ? STATUS_LABELS[event.from_status] : null
  return from ? `Status changed from ${from} to ${to}` : `Status set to ${to}`
}

function History({ events }: { events: EnquiryEvent[] }) {
  return (
    <Section title="History">
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No history recorded.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
              <span className="text-sm font-medium">{eventText(event)}</span>
              {(event.reason ?? event.detail) && (
                <span className="text-sm break-words whitespace-pre-line">
                  {event.reason ?? event.detail}
                </span>
              )}
              <span className="text-muted-foreground text-xs">
                <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
                {event.actor_name ? ` · ${event.actor_name}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

function BookingsSection({ enquiryId }: { enquiryId: string }) {
  const bookings = useEnquiryBookings(enquiryId)
  return (
    <Section title="Appointments">
      {bookings.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : bookings.isError ? (
        <p className="text-destructive text-sm">Could not load appointments.</p>
      ) : bookings.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">No appointment booked.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {bookings.data.map((b) => (
            <li key={b.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {formatLongDate(b.starts_at)}, {formatClock(b.starts_at)}
                </span>
                <BookingStateBadge state={b.state} />
              </div>
              <span className="text-sm">{b.appointment_types.label}</span>
              {b.failure_reason && (
                <span className="text-destructive text-sm break-words">{b.failure_reason}</span>
              )}
              {b.calendar_event_link && (
                <a
                  href={b.calendar_event_link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline underline-offset-4"
                >
                  Open in Google Calendar
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function SiteDetails({
  answers,
  form,
}: {
  answers: EnquiryDetail['answers']
  form: FormDefinition | undefined
}) {
  const fields = form ? form.steps.flatMap((s) => s.fields) : []
  return (
    <Section title="Property">
      <dl className="flex flex-col gap-3">
        {form
          ? fields.map((field) => (
              <Row key={field.id} label={field.label}>
                {formatAnswer(field, answers[field.id]) ?? (
                  <span className="text-muted-foreground">Not given</span>
                )}
              </Row>
            ))
          : Object.entries(answers).map(([key, value]) => (
              <Row key={key} label={key}>
                {Array.isArray(value) ? value.join(', ') : value}
              </Row>
            ))}
      </dl>
    </Section>
  )
}

export function EnquiryDetailPage() {
  const { id = '' } = useParams()
  const enquiry = useEnquiry(id)
  const forms = useFormVersions()

  const back = (
    <Link
      to="/staff"
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 text-sm focus-visible:rounded-sm focus-visible:ring-3 focus-visible:outline-none"
    >
      <ChevronLeft className="size-4" aria-hidden="true" /> All enquiries
    </Link>
  )

  if (enquiry.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading enquiry">
        {back}
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (enquiry.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not load this enquiry</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void enquiry.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (!enquiry.data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="bg-background text-muted-foreground rounded-xl border p-6">
          No enquiry with this link.
        </p>
      </div>
    )
  }

  const data = enquiry.data
  const form = forms.data?.get(`${data.form_id}@${data.form_version}`)

  return (
    <div className="flex flex-col gap-4">
      {back}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="font-mono text-xl font-semibold tracking-wider">{data.reference}</h1>
        <StatusBadge status={data.status} />
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">
        Received <time dateTime={data.submitted_at}>{formatDateTime(data.submitted_at)}</time>
        {data.status === 'unsuitable' && data.status_reason
          ? ` · Unsuitable: ${data.status_reason}`
          : ''}
      </p>

      {forms.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : form ? (
        <Answers enquiry={data} form={form} />
      ) : (
        <RawAnswers enquiry={data} />
      )}

      <BookingsSection enquiryId={data.id} />
      {data.contact_requested_at && (
        <Alert>
          <AlertTitle>Asked to be contacted</AlertTitle>
          <AlertDescription>
            {formatDateTime(data.contact_requested_at)}
            {data.contact_request_reason ? `: ${data.contact_request_reason}` : ''}
          </AlertDescription>
        </Alert>
      )}
      {data.site_details && (
        <SiteDetails
          answers={data.site_details}
          form={forms.data?.get(`site_details@${data.site_details_form_version ?? 1}`)}
        />
      )}

      <Section title="Change status">
        <StatusForm enquiryId={data.id} current={data.status} />
      </Section>
      <History events={data.enquiry_events} />
      <Attribution attribution={data.enquiry_attribution} />
    </div>
  )
}
