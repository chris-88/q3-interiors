import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  useBookCall,
  useBookVisit,
  useCallOptions,
  callTimes,
  useSendVisitLink,
  useVisitOptions,
  type VisitSlot,
} from '@/api/after-call'
import type { EnquiryDetail } from '@/api/enquiries'
import { Confirm } from '@/components/staff/confirm'
import { SlotPicker } from '@/components/booking/slot-picker'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { callHeldAt, telHref, visitLinkSentAt } from '@/lib/enquiry-stage'
import { formatDayMonth, formatShortWhen } from '@/lib/format'

/** The Estimate section listens for this to open its form (the Next step's "Write the estimate"). */
export const WRITE_ESTIMATE_EVENT = 'q3:write-estimate'

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** An open choice: a heavier edge and the chevron turned, not only a lighter fill. */
const opened = 'aria-expanded:border-action aria-expanded:border-2 aria-expanded:bg-background'
const wide = 'h-12 w-full sm:w-auto sm:px-6'

export function SendLinkPanel({
  enquiry,
  onClose,
}: {
  enquiry: EnquiryDetail
  onClose: () => void
}) {
  const send = useSendVisitLink(enquiry.id)
  const email = text(enquiry.answers.email)
  const [sent, setSent] = useState(false)
  if (!email)
    return (
      <p role="alert" className="text-destructive text-sm">
        This enquiry has no email address. Ring them to book a time instead.
      </p>
    )
  if (sent)
    return (
      <output className="block text-sm">
        Link sent to {email}. The email goes within a minute.
      </output>
    )
  return (
    <Confirm
      question={`Email ${email} a link to book their site visit?`}
      detail="They pick a time from the same free times you see. Their details are kept."
      confirm="Yes, send it"
      pending={send.isPending}
      pendingLabel="Sending…"
      onConfirm={() => send.mutate(undefined, { onSuccess: () => setSent(true) })}
      onCancel={onClose}
      error={
        send.isError
          ? send.error.message.includes('site visit booked')
            ? 'A site visit is already booked.'
            : 'The link was not sent. Try again.'
          : null
      }
    />
  )
}

export function BookVisitPanel({
  enquiry,
  onUseLink,
}: {
  enquiry: EnquiryDetail
  onUseLink: () => void
}) {
  const options = useVisitOptions(enquiry.id, true)
  const book = useBookVisit(enquiry.id)
  const [slot, setSlot] = useState<VisitSlot | null>(null)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [street, setStreet] = useState(text(enquiry.answers.site_street))
  const [unit, setUnit] = useState(text(enquiry.answers.site_unit))
  const [problem, setProblem] = useState<string | null>(null)
  const [booked, setBooked] = useState<string | null>(null)
  const data = options.data
  const linkInstead = (
    <Button variant="outline" className={wide} onClick={onUseLink}>
      Send a booking link instead
    </Button>
  )

  if (booked)
    return (
      <output className="block text-sm">
        Site visit booked for {formatShortWhen(booked)}. The customer is emailed the confirmation
        with a link to manage it.
      </output>
    )
  if (options.isPending) return <Skeleton className="h-40 w-full" />
  if (options.isError || !data)
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load free times.</AlertDescription>
      </Alert>
    )
  if (data.status !== 'ok')
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">The calendar is not available, so times cannot be checked.</p>
        {linkInstead}
      </div>
    )
  if (data.eligibility === 'phone_required')
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          There is no phone number on this enquiry, so a visit cannot be booked here.
        </p>
        {linkInstead}
      </div>
    )
  const needsAddress = !data.siteAddress
  const field = 'flex flex-col gap-1'

  const submit = () => {
    if (!slot) return setProblem('Choose a time.')
    if (needsAddress && street.trim().length < 3)
      return setProblem('Add the house name or number and street.')
    setProblem(null)
    book.mutate(
      {
        start: slot.start,
        idempotencyKey: key,
        ...(needsAddress ? { siteStreet: street.trim(), siteUnit: unit.trim() } : {}),
      },
      {
        onSuccess: (r) => {
          if (r.status === 'booked') return setBooked(slot.start)
          setKey(crypto.randomUUID())
          if (r.status === 'slot_unavailable') {
            setSlot(null)
            setProblem('That time has just gone. Choose another.')
          } else if (r.status === 'invalid_address' || r.reason === 'site_address_required')
            setProblem('Check the address: the house name or number and street.')
          else if (r.status === 'already_booked') setProblem('An appointment is already booked.')
          else setProblem('The visit was not booked. Try again, or send a booking link.')
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <p className="text-muted-foreground text-sm">
        The same free times the customer sees (Irish time). They get the normal confirmation email.
      </p>
      {needsAddress ? (
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="text-sm font-medium">Address of the property</legend>
          <p className="text-muted-foreground text-xs">
            A site visit needs the address. If you do not have it, send a booking link instead.
          </p>
          <div className={field}>
            <label htmlFor="visit-street" className="text-sm">
              House name or number and street
            </label>
            <Input
              id="visit-street"
              autoComplete="off"
              className="h-12 text-base"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
            />
          </div>
          <div className={field}>
            <label htmlFor="visit-unit" className="text-sm">
              Apartment or unit (optional)
            </label>
            <Input
              id="visit-unit"
              autoComplete="off"
              className="h-12 text-base"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          {text(enquiry.answers.location) && (
            <p className="text-muted-foreground text-xs">Area: {text(enquiry.answers.location)}</p>
          )}
        </fieldset>
      ) : (
        <p className="text-sm">At {data.siteAddress}</p>
      )}
      {data.slots.length === 0 ? (
        <p className="text-sm">No free site visit times in the booking window.</p>
      ) : (
        <SlotPicker
          slots={data.slots}
          selected={slot}
          onSelect={(s) => {
            setSlot(s)
            setProblem(null)
          }}
        />
      )}
      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className={wide} disabled={book.isPending} onClick={submit}>
          {book.isPending
            ? 'Booking…'
            : slot
              ? `Book ${formatShortWhen(slot.start)}`
              : 'Book the visit'}
        </Button>
        {needsAddress && linkInstead}
      </div>
      {book.isError && (
        <p role="alert" className="text-destructive text-sm">
          The visit was not booked: {book.error.message}
        </p>
      )}
    </div>
  )
}

type Choice = 'none' | 'visit' | 'link'

/** Next step once the call is held: the estimate, the site visit, or a booking link. */
export function AfterCallChoices({ enquiry, now }: { enquiry: EnquiryDetail; now: number }) {
  const [choice, setChoice] = useState<Choice>('none')
  const held = callHeldAt(enquiry, now)
  const linkSent = visitLinkSentAt(enquiry, now)
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{held ? `Call held ${formatDayMonth(held)}` : 'Call held'}</p>
        {linkSent && (
          <p className="text-sm">
            Site visit link sent {formatDayMonth(linkSent)}. Waiting for them to book.
          </p>
        )}
      </div>
      {/* Chris: an estimate normally needs the space seen, so the site visit comes first. */}
      <div className="flex flex-col gap-2">
        <Button
          // One filled button at a time: while a choice is open, its own panel holds the action.
          variant={choice === 'none' ? 'default' : 'outline'}
          aria-expanded={choice === 'visit'}
          className={`${wide} ${opened}`}
          onClick={() => setChoice((c) => (c === 'visit' ? 'none' : 'visit'))}
        >
          Book the site visit
          <ChevronDown
            className={`size-4 transition-transform ${choice === 'visit' ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </Button>
        <Button
          variant="outline"
          aria-expanded={choice === 'link'}
          className={`${wide} ${opened}`}
          onClick={() => setChoice((c) => (c === 'link' ? 'none' : 'link'))}
        >
          {linkSent ? 'Send the booking link again' : 'Send a booking link'}
          <ChevronDown
            className={`size-4 transition-transform ${choice === 'link' ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </Button>
        <Button
          variant="outline"
          className={wide}
          onClick={() => {
            setChoice('none')
            window.dispatchEvent(new Event(WRITE_ESTIMATE_EVENT))
          }}
        >
          Write the estimate
        </Button>
      </div>
      {choice === 'visit' && (
        <BookVisitPanel enquiry={enquiry} onUseLink={() => setChoice('link')} />
      )}
      {choice === 'link' && <SendLinkPanel enquiry={enquiry} onClose={() => setChoice('none')} />}
    </>
  )
}

/**
 * "Book a call" before any call is held: staff put a call in the diary for the customer, from the
 * same free call times the customer sees; the customer gets the usual confirmation email. The
 * button is outlined; while the panel is open its Book button is the one filled action, so the
 * caller passes `onOpenChange` to step its own main button down.
 */
export function BookACall({
  enquiry,
  onOpenChange,
}: {
  enquiry: EnquiryDetail
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  return (
    <>
      <Button variant="outline" aria-expanded={open} className={wide} onClick={() => toggle(!open)}>
        Book a call
      </Button>
      {open && <BookCallPanel enquiry={enquiry} onDone={() => onOpenChange?.(false)} />}
    </>
  )
}

export function BookCallPanel({ enquiry, onDone }: { enquiry: EnquiryDetail; onDone: () => void }) {
  const options = useCallOptions(enquiry.id, true)
  const book = useBookCall(enquiry.id)
  const [slot, setSlot] = useState<VisitSlot | null>(null)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [problem, setProblem] = useState<string | null>(null)
  const [booked, setBooked] = useState<string | null>(null)
  const first = text(enquiry.answers.name).split(/\s+/)[0] || 'The customer'
  const data = options.data

  if (booked)
    return (
      <output className="block text-sm">
        Call booked for {formatShortWhen(booked)}. {first} gets the usual confirmation email.
      </output>
    )
  if (options.isPending) return <Skeleton className="h-40 w-full" />
  if (options.isError || !data)
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load free times.</AlertDescription>
      </Alert>
    )
  if (data.status === 'already_booked')
    return <p className="text-sm">An appointment is already booked. Move it instead.</p>
  const times = callTimes(data)
  if (!times)
    return <p className="text-sm">The calendar is not available, so times cannot be checked.</p>
  if (times.eligibility === 'phone_required')
    return (
      <p className="text-sm">
        There is no phone number on this enquiry, so a call cannot be booked.
      </p>
    )

  const submit = () => {
    if (!slot) return setProblem('Choose a time.')
    setProblem(null)
    book.mutate(
      { start: slot.start, idempotencyKey: key },
      {
        onSuccess: (r) => {
          if (r.status === 'booked') {
            setBooked(slot.start)
            return onDone()
          }
          setKey(crypto.randomUUID())
          if (r.status === 'slot_unavailable') {
            setSlot(null)
            setProblem('That time has just gone. Choose another.')
          } else if (r.status === 'already_booked') setProblem('An appointment is already booked.')
          else setProblem('The call was not booked. Try again.')
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <p className="text-sm">
        Pick a time for the call. {first} gets the usual confirmation email.
      </p>
      {times.slots.length === 0 ? (
        <p className="text-sm">No free call times in the booking window.</p>
      ) : (
        <SlotPicker
          slots={times.slots}
          selected={slot}
          onSelect={(s) => {
            setSlot(s)
            setProblem(null)
          }}
        />
      )}
      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      <Button className={wide} disabled={book.isPending} onClick={submit}>
        {book.isPending
          ? 'Booking…'
          : slot
            ? `Book ${formatShortWhen(slot.start)}`
            : 'Book the call'}
      </Button>
      {book.isError && (
        <p role="alert" className="text-destructive text-sm">
          The call was not booked: {book.error.message}
        </p>
      )}
    </div>
  )
}

type MissedChoice = 'none' | 'call' | 'visit' | 'link'

/**
 * Next step after a missed call or site visit (marked No-show): ring them (the one filled action),
 * or book another time: a call, or the site visit and its booking link email. Uses the panels the
 * after-call card has; no new email.
 */
export function MissedAppointment({
  enquiry,
  mode,
  when,
}: {
  enquiry: EnquiryDetail
  /** The missed appointment's mode: `phone` or `on_site`. */
  mode: string
  when: string | null
}) {
  const [choice, setChoice] = useState<MissedChoice>('none')
  const ring = telHref(enquiry.answers.phone)
  const first = text(enquiry.answers.name).split(/\s+/)[0] || 'them'
  const visit = mode === 'on_site'
  const toggle = (next: MissedChoice) => setChoice((c) => (c === next ? 'none' : next))
  return (
    <>
      <p className="font-medium">
        {visit ? 'Missed site visit' : 'Missed call'}
        {when ? ` ${formatShortWhen(when)}` : ''}
      </p>
      <p className="text-sm">Ring them, or book another time.</p>
      <div className="flex flex-col gap-2">
        {ring && (
          <a
            href={ring}
            className={buttonVariants({
              // One filled action at a time: while a panel is open, its own button leads.
              variant: choice === 'none' ? 'default' : 'outline',
              className: wide,
            })}
          >
            Ring {first}
          </a>
        )}
        {visit ? (
          <>
            <Button
              variant="outline"
              aria-expanded={choice === 'visit'}
              className={`${wide} ${opened}`}
              onClick={() => toggle('visit')}
            >
              Book the site visit
              <ChevronDown
                className={`size-4 transition-transform ${choice === 'visit' ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </Button>
            <Button
              variant="outline"
              aria-expanded={choice === 'link'}
              className={`${wide} ${opened}`}
              onClick={() => toggle('link')}
            >
              Send a booking link
              <ChevronDown
                className={`size-4 transition-transform ${choice === 'link' ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            aria-expanded={choice === 'call'}
            className={`${wide} ${opened}`}
            onClick={() => toggle('call')}
          >
            Book a call
            <ChevronDown
              className={`size-4 transition-transform ${choice === 'call' ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
      {choice === 'call' && <BookCallPanel enquiry={enquiry} onDone={() => undefined} />}
      {choice === 'visit' && (
        <BookVisitPanel enquiry={enquiry} onUseLink={() => setChoice('link')} />
      )}
      {choice === 'link' && <SendLinkPanel enquiry={enquiry} onClose={() => setChoice('none')} />}
    </>
  )
}
