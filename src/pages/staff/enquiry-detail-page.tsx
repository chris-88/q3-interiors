import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Mail, MapPin, Phone } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'
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
  statusLabel,
  type EnquiryAttribution,
  type EnquiryDetail,
  type EnquiryEvent,
  type EnquiryPhoto,
} from '@/api/enquiries'
import { currentQuote } from '@/api/quotes'
import { useEnquiryBookings } from '@/api/staff-booking'
import { BookingActions } from '@/components/staff/booking-actions'
import { ChaseForm } from '@/components/staff/chase-form'
import { DeleteEnquiry } from '@/components/staff/delete-enquiry'
import { ActionBar, barAction, NowCard, StageStrip } from '@/components/staff/enquiry-now'
import { EstimateSection, estimateSource } from '@/components/staff/estimate-section'
import {
  enquiryName,
  projectLine,
  projectType,
  storedSearch,
} from '@/components/staff/enquiry-text'
import { eventLine } from '@/components/staff/event-text'
import { ListWalk } from '@/components/staff/list-walk'
import { QuoteSection } from '@/components/staff/quote-section'
import { useLoadedAt } from '@/components/staff/use-loaded-at'
import { StatusForm } from '@/components/staff/status-form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatAnswer, visibleFields } from '@/forms/logic'
import type { FormDefinition } from '@/forms/types'
import { appointmentBadge } from '@/lib/agenda'
import {
  currentEstimate,
  directionsHref,
  groupStages,
  mailHref,
  siteAddress,
  stageOf,
  telHref,
} from '@/lib/enquiry-stage'
import { formatDateTime, formatDayMonth, formatShortWhen } from '@/lib/format'
import { isKnown } from '@/lib/tolerant'
import { neighbours } from '@/lib/walk'
import { findProject } from '@/lib/website'
import { formatEuro, formatRange } from '../../../supabase/functions/_shared/estimate.ts'

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
                <BookingActions booking={b} moveCancel={false} attendance={false} />
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
        <Button
          type="submit"
          variant="outline"
          className="h-12 self-start px-6"
          disabled={add.isPending}
        >
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

function Details({ enquiry }: { enquiry: EnquiryDetail }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Reference <span className="font-mono">{enquiry.reference}</span> · received{' '}
        <time dateTime={enquiry.submitted_at}>{formatDateTime(enquiry.submitted_at)}</time> · form{' '}
        {enquiry.form_id} version {enquiry.form_version}
      </p>
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
  )
}

/**
 * A section folded to one line that opens in place (review P3): the title and a short summary.
 * Its section keeps its name for screen readers; the heading inside is not shown twice.
 */
function Fold({
  id,
  title,
  summary,
  children,
}: {
  id: string
  title: string
  summary?: ReactNode
  children: ReactNode
}) {
  return (
    <details
      id={`fold-${id}`}
      className="bg-background group rounded-md border [&_section]:border-0 [&_section]:p-0 [&>div>section>h2]:sr-only [&>div>section>h2+div]:mt-0"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-right text-sm">
          <span className="min-w-0 break-words">{summary}</span>
          <ChevronRight
            className="size-4 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t p-4">{children}</div>
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
  const rows = bookings.data ?? []
  // What a task screen just did ("Estimate sent to …"), handed over when it came back here.
  const said = (useLocation().state as { notice?: unknown } | null)?.notice
  const notice = typeof said === 'string' ? said : null
  const address = siteAddress(enquiry.answers, enquiry.site_details)
  const job = projectType(enquiry, form)
  const latest = [...rows].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0]
  const estimate = currentEstimate(enquiry.estimates)
  const quote = currentQuote(enquiry.quotes)
  const showEstimate = !!estimate || (bookings.data && !!estimateSource(enquiry, rows, now))
  const showQuote = !!quote || enquiry.estimates.length > 0
  const notes = enquiry.enquiry_events.filter((e) => e.kind === 'note_added').length
  const bar = barAction(view)
  return (
    <div className="grid grid-cols-1 gap-4 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:pb-0">
      <div className="flex flex-col gap-3 lg:sticky lg:top-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-title text-ink leading-tight font-medium break-words">
            {enquiryName(enquiry)}
          </h1>
          <p className="text-muted-foreground break-words">
            {[
              job,
              address ??
                (typeof enquiry.answers.location === 'string' ? enquiry.answers.location : null),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {enquiry.inspiration && (
            <p className="text-sm">
              Came from the website: {websiteProjectLine(enquiry.inspiration)}
            </p>
          )}
        </div>
        <StageStrip enquiry={enquiry} view={view} now={now} />
        {notice && (
          <output className="border-action bg-soft block rounded-md border-l-4 p-3 text-sm">
            {notice}
          </output>
        )}
        <QuickActions enquiry={enquiry} />
        <NowCard enquiry={enquiry} view={view} />
        <ActionBar enquiry={enquiry} view={view} bookings={rows} now={now} />
      </div>
      <div className="flex flex-col gap-3">
        <Fold id="answers" title="Their answers" summary={projectLine(enquiry, form)}>
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
        </Fold>
        {(rows.length > 0 || bookings.isPending || bookings.isError) && (
          <Fold
            id="appointments"
            title="Appointments"
            summary={
              latest
                ? `${formatShortWhen(latest.starts_at)}${latest.attendance === 'attended' ? ' · went ahead' : latest.state === 'cancelled' ? ' · cancelled' : ''}`
                : null
            }
          >
            <Appointments bookings={bookings} featured={null} />
          </Fold>
        )}
        {showEstimate && bookings.data && (
          <Fold
            id="estimate"
            title="Estimate"
            summary={
              estimate
                ? `Sent ${formatDayMonth(estimate.sent_at)} · ${formatRange(estimate.low_eur, estimate.high_eur)}`
                : 'Not sent yet'
            }
          >
            <EstimateSection
              enquiry={enquiry}
              bookings={bookings.data}
              now={now}
              offeredAbove={bar === 'write_estimate' || bar === 'choose_next'}
            />
          </Fold>
        )}
        {showQuote && (
          <Fold
            id="quote"
            title="Quote"
            summary={quote ? `${quote.number} · ${formatEuro(quote.price_eur)}` : 'Not sent yet'}
          >
            <QuoteSection enquiry={enquiry} now={now} />
          </Fold>
        )}
        <Fold
          id="activity"
          title="Notes and history"
          summary={notes === 1 ? '1 note' : notes > 1 ? `${notes} notes` : 'Add a note'}
        >
          <Notes enquiry={enquiry} />
          <History events={enquiry.enquiry_events} />
        </Fold>
        <Fold id="details" title="Details" summary="Reference, source, delete">
          <Details enquiry={enquiry} />
        </Fold>
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
