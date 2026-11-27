// Where an enquiry stands, derived in the browser from fields it already has (status, outcome,
// contact request, bookings), so one badge per row replaces a pile of pills. Also the list's
// chips, search and order, and the one next step the enquiry page offers. Pure, so it is tested
// without a browser.
import { formatRange } from '../../supabase/functions/_shared/estimate.ts'
import {
  addWorkingDays,
  isPastDate,
  QUOTE_DUE_WORKING_DAYS,
} from '../../supabase/functions/_shared/working-days.ts'
import { formatDayMonth, formatShortDay, formatShortWhen } from './format'
import { reasonLabel } from './outcome'

export type StageBooking = {
  starts_at: string
  confirmed_at: string | null
  state: string
  /** The appointment type's mode (`phone`, `on_site`), when the read included it. */
  mode?: string | null
  /** Attended or no-show, once recorded. */
  attendance?: string | null
}

/** An estimate sent after a site visit (the newest is the current one). */
export type StageEstimate = {
  sent_at: string
  valid_until: string
  low_eur: number
  high_eur: number
  quote_requested_at: string | null
}

/** A quote sent from here (the newest version is current). */
export type StageQuote = {
  number: string
  version: number
  price_eur: number
  sent_at: string
  change_requested_at: string | null
  /** YYYY-MM-DD; absent from older test data. */
  valid_until?: string
}

export type StageInput = {
  status: string
  outcome: string | null
  contact_requested_at: string | null
  bookings: StageBooking[]
  /** Absent from older reads and tests: no estimate. */
  estimates?: StageEstimate[]
  /** Absent from older reads and tests: no quote. */
  quotes?: StageQuote[]
  /** "We already spoke" (the call held early or without a booking). */
  call_held_at?: string | null
  /** The latest "Book your site visit" link emailed. */
  visit_link_sent_at?: string | null
}

export const STAGES = [
  'new',
  'contact',
  'in_review',
  'contacted',
  'booked',
  'call_held',
  'link_sent',
  'missed_call',
  'missed_visit',
  'awaiting_quote',
  'estimate_sent',
  'quote_requested',
  'no_answer',
  'quoted',
  'change_requested',
  'won',
  'lost',
  'closed',
  'other',
] as const
export type StageKey = (typeof STAGES)[number]

export const STAGE_LABELS: Record<Exclude<StageKey, 'other'>, string> = {
  new: 'New',
  contact: 'Call back',
  in_review: 'In review',
  contacted: 'Contacted',
  booked: 'Booked',
  call_held: 'Call held',
  link_sent: 'Site visit link sent',
  missed_call: 'Missed call',
  missed_visit: 'Missed visit',
  // After a site visit the next thing is the estimate (the key is kept for stored chips).
  awaiting_quote: 'Estimate to write',
  estimate_sent: 'Estimate sent',
  // Asked for their quote: the next thing is to write it (due in 3 working days).
  quote_requested: 'Quote to write',
  no_answer: 'No answer in 10 days',
  quoted: 'Quote sent',
  change_requested: 'Change asked for',
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}

/** Stages where someone at Q3 has to do something next. */
export const NEEDS_ACTION: ReadonlySet<StageKey> = new Set([
  'new',
  'contact',
  'call_held',
  'missed_call',
  'missed_visit',
  'awaiting_quote',
  'quote_requested',
  'no_answer',
  'change_requested',
])
const FINISHED: ReadonlySet<StageKey> = new Set(['won', 'lost', 'closed'])

const LIVE = new Set(['reserved', 'calendar_pending', 'confirmed'])

/** The next live appointment that has not started, if any. */
export function upcomingBooking<T extends StageBooking>(bookings: T[], now: number): T | null {
  return (
    bookings
      .filter((b) => LIVE.has(b.state) && Date.parse(b.starts_at) > now)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] ?? null
  )
}

/** The latest appointment that was confirmed, not cancelled, and has started. */
export function passedBooking<T extends StageBooking>(bookings: T[], now: number): T | null {
  return (
    bookings
      .filter(
        (b) => b.confirmed_at !== null && b.state !== 'cancelled' && Date.parse(b.starts_at) <= now,
      )
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0] ?? null
  )
}

/** The current (newest) estimate, if any. */
export function currentEstimate<T extends StageEstimate>(estimates: T[] | undefined): T | null {
  return (
    [...(estimates ?? [])].sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0] ?? null
  )
}

/** Where the current estimate stands: asked for a quote, past its 10 days, or open. */
export function estimateState(
  e: StageEstimate,
  now: number,
): 'quote_requested' | 'no_answer' | 'estimate_sent' {
  if (e.quote_requested_at) return 'quote_requested'
  return Date.parse(e.valid_until) <= now ? 'no_answer' : 'estimate_sent'
}

/** "Estimate sent 27 Nov: €9,500 to €10,500" */
export function estimateLine(e: StageEstimate): string {
  return `Estimate sent ${formatDayMonth(e.sent_at)}: ${formatRange(e.low_eur, e.high_eur)}`
}

/** The date the quote is due (3 working days after "Get my quote"), as YYYY-MM-DD. */
export function quoteDueDate(e: StageEstimate): string | null {
  return e.quote_requested_at ? addWorkingDays(e.quote_requested_at, QUOTE_DUE_WORKING_DAYS) : null
}

/** Asked for a quote and the due date has passed. */
export function quoteOverdue(e: StageEstimate, now: number): boolean {
  const due = quoteDueDate(e)
  return due !== null && isPastDate(due, now)
}

/**
 * "Quote requested 29 Nov · Quote due Wed 2 Dec" (or "Quote overdue, was due Wed 2 Dec"),
 * "No answer in 10 days", or null while it is open.
 */
export function estimateFollowUp(e: StageEstimate, now: number): string | null {
  const state = estimateState(e, now)
  const due = quoteDueDate(e)
  if (state === 'quote_requested' && e.quote_requested_at && due) {
    const day = formatShortDay(`${due}T12:00:00Z`)
    return `Quote requested ${formatDayMonth(e.quote_requested_at)} · ${
      isPastDate(due, now) ? `Quote overdue, was due ${day}` : `Quote due ${day}`
    }`
  }
  if (state === 'no_answer') return 'No answer in 10 days'
  return null
}

/**
 * The list's line for an estimate, news first so the important part survives a narrow screen:
 * "Quote requested 29 Nov · €9,500 to €10,500" (or "Quote overdue, was due Wed 2 Dec · …"),
 * "No answer in 10 days · …", "Estimate sent 20 Nov · …".
 */
export function estimateNews(e: StageEstimate, now: number): string {
  const range = formatRange(e.low_eur, e.high_eur)
  const state = estimateState(e, now)
  const due = quoteDueDate(e)
  if (state === 'quote_requested' && e.quote_requested_at) {
    return due && isPastDate(due, now)
      ? `Quote overdue, was due ${formatShortDay(`${due}T12:00:00Z`)} · ${range}`
      : `Quote due ${due ? formatShortDay(`${due}T12:00:00Z`) : formatDayMonth(e.quote_requested_at)} · ${range}`
  }
  if (state === 'no_answer') return `No answer in 10 days · ${range}`
  return `Estimate sent ${formatDayMonth(e.sent_at)} · ${range}`
}

/**
 * When the call was held, if the next thing is to move them on: "We already spoke", or the latest
 * past appointment was a call marked attended. Null once a later appointment has started.
 */
export function callHeldAt(e: StageInput, now: number): string | null {
  const passed = passedBooking(e.bookings, now)
  const attended =
    passed && passed.mode === 'phone' && passed.attendance === 'attended' ? passed.starts_at : null
  const early = e.call_held_at ?? null
  // A visit (or another call) after the early "We already spoke" is what counts now.
  if (early && passed && Date.parse(passed.starts_at) > Date.parse(early)) return attended
  if (early && attended) return Date.parse(early) > Date.parse(attended) ? early : attended
  return early ?? attended
}

/** The booking link sent since the call was held, if any. */
export function visitLinkSentAt(e: StageInput, now: number): string | null {
  const held = callHeldAt(e, now)
  const sent = e.visit_link_sent_at ?? null
  return held && sent && Date.parse(sent) >= Date.parse(held) ? sent : null
}

/** The newest quote version, if any. */
export function latestQuote<T extends StageQuote>(quotes: T[] | undefined): T | null {
  return [...(quotes ?? [])].sort((a, b) => b.version - a.version)[0] ?? null
}

/** "Quote Q3-Q-0001 sent 28 Nov: €10,200 · good until Fri 18 Dec" */
export function quoteLine(q: StageQuote): string {
  const until = q.valid_until ? ` · good until ${formatShortDay(`${q.valid_until}T12:00:00Z`)}` : ''
  return `Quote ${q.number}${q.version > 1 ? ` (v${q.version})` : ''} sent ${formatDayMonth(q.sent_at)}: ${euroShort(q.price_eur)}${until}`
}

/** The updated quote is due 3 working days after the change was asked for (YYYY-MM-DD). */
export function updatedQuoteDue(q: StageQuote): string | null {
  return q.change_requested_at
    ? addWorkingDays(q.change_requested_at, QUOTE_DUE_WORKING_DAYS)
    : null
}

/** "Updated quote due Wed 2 Dec", or "Updated quote overdue, was due Wed 2 Dec". */
export function updatedQuoteDueLine(q: StageQuote, now: number): string | null {
  const due = updatedQuoteDue(q)
  if (!due) return null
  const day = formatShortDay(`${due}T12:00:00Z`)
  return isPastDate(due, now) ? `Updated quote overdue, was due ${day}` : `Updated quote due ${day}`
}

/**
 * The latest finished appointment, when it was marked No-show and nothing has happened since: no
 * call held after it and no estimate sent after it. (An appointment still to come is checked
 * first.) Null otherwise.
 */
export function missedBooking<T extends StageBooking>(
  e: Omit<StageInput, 'bookings'> & { bookings: T[] },
  now: number,
): T | null {
  const passed = passedBooking(e.bookings, now)
  if (!passed || passed.attendance !== 'no_show') return null
  const after = (iso: string | null | undefined) =>
    !!iso && Date.parse(iso) > Date.parse(passed.starts_at)
  if (after(e.call_held_at)) return null
  if (after(currentEstimate(e.estimates)?.sent_at)) return null
  return passed
}

export type Stage = { key: StageKey; label: string }

/**
 * The one stage, first match wins:
 * 1. outcome won -> Won; outcome lost -> Lost;
 * 2. status unsuitable -> Closed;
 * 3. outcome quoted -> Quoted; any other outcome (a newer release's) -> its raw value;
 * 4. a live appointment (reserved, confirming or confirmed) not yet started -> Booked (an
 *    appointment still to come is never hidden, even behind an estimate);
 * 4a. the latest finished appointment marked No-show, nothing held or sent since -> Missed call
 *    / Missed visit (Needs action: ring or rebook);
 * 4b. an estimate sent: a site visit that has happened since it was sent -> Estimate to write
 *    (the visit is the basis for a new one); quote requested -> Quote requested; past its
 *    10 days with no request -> No answer in 10 days; otherwise -> Estimate sent;
 * 4c. a call held (attended, or "We already spoke"): a site visit link sent since -> Site visit
 *     link sent; otherwise -> Call held;
 * 5. a confirmed, not cancelled appointment that has started -> Estimate to write;
 * 6. asked to be contacted and status still new or in review -> Call back;
 * 7. status contacted -> Contacted; in review -> In review; new -> New;
 *    any other status (a newer release's) -> its raw value.
 */
export function enquiryStage(e: StageInput, now: number): Stage {
  const known = (key: Exclude<StageKey, 'other'>): Stage => ({ key, label: STAGE_LABELS[key] })
  if (e.outcome === 'won') return known('won')
  if (e.outcome === 'lost') return known('lost')
  if (e.status === 'unsuitable') return known('closed')
  if (e.outcome === 'quoted')
    return known(latestQuote(e.quotes)?.change_requested_at ? 'change_requested' : 'quoted')
  if (e.outcome !== null) return { key: 'other', label: e.outcome }
  if (upcomingBooking(e.bookings, now)) return known('booked')
  const missed = missedBooking(e, now)
  if (missed) return known(missed.mode === 'on_site' ? 'missed_visit' : 'missed_call')
  const estimate = currentEstimate(e.estimates)
  if (estimate) {
    const passed = passedBooking(e.bookings, now)
    const visitSince =
      passed?.mode === 'on_site' && Date.parse(passed.starts_at) > Date.parse(estimate.sent_at)
    return known(visitSince ? 'awaiting_quote' : estimateState(estimate, now))
  }
  if (callHeldAt(e, now)) return known(visitLinkSentAt(e, now) ? 'link_sent' : 'call_held')
  if (passedBooking(e.bookings, now)) return known('awaiting_quote')
  if (e.contact_requested_at && (e.status === 'new' || e.status === 'in_review'))
    return known('contact')
  if (e.status === 'contacted') return known('contacted')
  if (e.status === 'in_review') return known('in_review')
  if (e.status === 'new') return known('new')
  return { key: 'other', label: e.status }
}

const euroShort = (value: number) =>
  new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)

export function appointmentKind(mode: string | null | undefined): string {
  if (mode === 'on_site') return 'Site visit'
  if (mode === 'phone') return 'Call'
  return 'Appointment'
}

export type LineInput = StageInput & {
  answers: Record<string, unknown>
  quote_amount?: number | null
  outcome_value?: number | null
  outcome_reason?: string | null
}

/** The row's one line on where it stands or what is next. */
export function stageLine(e: LineInput, stage: Stage, now: number): string {
  switch (stage.key) {
    case 'booked': {
      const b = upcomingBooking(e.bookings, now)
      if (!b) return 'Booked'
      const when = `${appointmentKind(b.mode)} ${formatShortWhen(b.starts_at)}`
      const line = b.state === 'confirmed' ? when : `${when} (not confirmed yet)`
      // An estimate already out is secondary news after the appointment.
      const estimate = currentEstimate(e.estimates)
      return estimate ? `${line} · Estimate sent ${formatDayMonth(estimate.sent_at)}` : line
    }
    case 'call_held': {
      const held = callHeldAt(e, now)
      return held ? `Call held ${formatDayMonth(held)}, next step to choose` : stage.label
    }
    case 'link_sent': {
      const sent = visitLinkSentAt(e, now)
      return sent ? `Site visit link sent ${formatDayMonth(sent)}` : stage.label
    }
    case 'awaiting_quote': {
      const b = passedBooking(e.bookings, now)
      return b
        ? `${appointmentKind(b.mode)} ${formatShortDay(b.starts_at)}, no estimate yet`
        : stage.label
    }
    case 'estimate_sent':
    case 'quote_requested':
    case 'no_answer': {
      const estimate = currentEstimate(e.estimates)
      return estimate ? estimateNews(estimate, now) : stage.label
    }
    case 'missed_call':
    case 'missed_visit': {
      const b = missedBooking(e, now)
      return `${stage.label}${b ? ` ${formatShortDay(b.starts_at)}` : ''} · ring or rebook`
    }
    case 'contact':
      return 'Asked to be contacted'
    case 'quoted': {
      const q = latestQuote(e.quotes)
      if (q) return quoteLine(q)
      return e.quote_amount ? `Quoted ${euroShort(e.quote_amount)}` : 'Quoted'
    }
    case 'change_requested': {
      const q = latestQuote(e.quotes)
      return q?.change_requested_at
        ? `${updatedQuoteDueLine(q, now)} · Change asked for ${formatDayMonth(q.change_requested_at)} on ${q.number}`
        : stage.label
    }
    case 'won':
      return e.outcome_value ? `Won ${euroShort(e.outcome_value)}` : 'Won'
    case 'lost':
      return e.outcome_reason ? `Lost: ${reasonLabel(e.outcome_reason)}` : 'Lost'
    case 'closed':
      return 'Not suitable'
    case 'contacted':
      return 'Contacted, nothing booked yet'
    case 'in_review':
      return 'In review, nothing booked yet'
    case 'new': {
      const p = e.answers.appointment_preference
      return p === 'phone'
        ? 'Wants a call, not booked yet'
        : p === 'on_site'
          ? 'Wants a site visit, not booked yet'
          : 'Not booked yet'
    }
    default:
      return stage.label
  }
}

// ---------------------------------------------------------------------------------------------
// The list: chips, search, order
// ---------------------------------------------------------------------------------------------

export const ENQUIRY_FILTERS = [
  ['open', 'Open'],
  ['action', 'Needs action'],
  ['booked', 'Booked'],
  ['quoted', 'Quoted'],
  ['won', 'Won'],
  ['lost', 'Lost'],
  ['all', 'All'],
] as const
export type EnquiryFilter = (typeof ENQUIRY_FILTERS)[number][0]

/**
 * The remembered chip. Values older builds stored still mean something ("awaiting_quote" is now
 * part of Needs action); anything else falls back to Open.
 */
export function readEnquiryFilter(stored: string | null): EnquiryFilter {
  if (stored === 'awaiting_quote') return 'action'
  return ENQUIRY_FILTERS.some(([key]) => key === stored) ? (stored as EnquiryFilter) : 'open'
}

export function matchesStage(stage: StageKey, filter: EnquiryFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'open':
      return !FINISHED.has(stage)
    case 'action':
      return NEEDS_ACTION.has(stage)
    default:
      return stage === filter
  }
}

export type Searchable = { reference: string; answers: Record<string, unknown> }

const text = (v: unknown) => (typeof v === 'string' ? v : '')
const digits = (v: string) => v.replace(/\D/g, '')

/** Name, phone, email, town or reference contains what was typed (case and spacing ignored). */
export function matchesSearch(e: Searchable, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return true
  const a = e.answers
  const fields = [text(a.name), text(a.email), text(a.location), e.reference]
  if (fields.some((f) => f.toLowerCase().replace(/\s+/g, ' ').includes(q))) return true
  const qDigits = digits(q)
  const phone = digits(text(a.phone))
  if (qDigits.length >= 3 && /^[\d\s+()-]+$/.test(q)) {
    // "087 123" and "+353 87 123" both find 087 123 4567.
    const local = qDigits.replace(/^353/, '0')
    return (
      phone.includes(qDigits) ||
      phone.includes(local) ||
      phone.replace(/^0/, '353').includes(qDigits)
    )
  }
  return false
}

export type Staged<T> = T & { stage: Stage }

/**
 * What a chip shows for a search: matching rows in the loaded order (newest first), except that
 * under Open the ones needing action come first.
 */
export function visibleEnquiries<T extends StageInput & Searchable>(
  enquiries: T[],
  filter: EnquiryFilter,
  query: string,
  now: number,
): Staged<T>[] {
  const rows = enquiries
    .filter((e) => matchesSearch(e, query))
    .map((e) => ({ ...e, stage: enquiryStage(e, now) }))
    .filter((e) => matchesStage(e.stage.key, filter))
  if (filter !== 'open') return rows
  const first = (e: Staged<T>) => (NEEDS_ACTION.has(e.stage.key) ? 0 : 1)
  return rows
    .map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => first(a) - first(b) || i - j)
    .map(([e]) => e)
}

/** How many rows each chip would show for this search. */
export function filterCounts<T extends StageInput & Searchable>(
  enquiries: T[],
  query: string,
  now: number,
): Record<EnquiryFilter, number> {
  const stages = enquiries.filter((e) => matchesSearch(e, query)).map((e) => enquiryStage(e, now))
  return Object.fromEntries(
    ENQUIRY_FILTERS.map(([key]) => [key, stages.filter((s) => matchesStage(s.key, key)).length]),
  ) as Record<EnquiryFilter, number>
}

// ---------------------------------------------------------------------------------------------
// The enquiry page's Next step
// ---------------------------------------------------------------------------------------------

export type NextStep =
  /** No booking, they asked us to contact them: ring, then mark contacted. */
  | 'contact'
  /** No booking yet (new or in review): ring or email, then mark contacted. */
  | 'reach'
  /** Contacted, nothing booked: waiting on them; an outcome can still be recorded. */
  | 'waiting'
  /** An appointment to come: when, with Move and Cancel. */
  | 'appointment'
  /** The appointment happened, no estimate yet: attendance and Write the estimate. */
  | 'record'
  /** A call held: write the estimate, book the site visit, or send a booking link. */
  | 'after_call'
  /** A missed call or visit: ring them, or book another time. */
  | 'missed'
  /** An estimate is out: where it stands, an updated one, and Record quote. */
  | 'estimate'
  /** Quoted: Mark won or lost, Edit quote. */
  | 'quoted'
  /** The customer asked for a change to the quote: their words, and an updated quote. */
  | 'quote_change'
  /** Won or lost: the result, with Edit. */
  | 'result'
  /** Marked unsuitable. */
  | 'closed'
  /** A stage or outcome a newer release wrote: shown plainly. */
  | 'newer'

export function nextStep(stage: StageKey): NextStep {
  switch (stage) {
    case 'contact':
      return 'contact'
    case 'new':
    case 'in_review':
      return 'reach'
    case 'contacted':
      return 'waiting'
    case 'booked':
      return 'appointment'
    case 'awaiting_quote':
      return 'record'
    case 'call_held':
    case 'link_sent':
      return 'after_call'
    case 'missed_call':
    case 'missed_visit':
      return 'missed'
    case 'estimate_sent':
    case 'quote_requested':
    case 'no_answer':
      return 'estimate'
    case 'quoted':
      return 'quoted'
    case 'change_requested':
      return 'quote_change'
    case 'won':
    case 'lost':
      return 'result'
    case 'closed':
      return 'closed'
    default:
      return 'newer'
  }
}

// ---------------------------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------------------------

export function telHref(phone: unknown): string | null {
  const n = typeof phone === 'string' ? phone.replace(/[^\d+]/g, '') : ''
  return n.length >= 6 ? `tel:${n}` : null
}

export function mailHref(email: unknown): string | null {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+$/.test(email.trim())
    ? `mailto:${email.trim()}`
    : null
}

/** Google Maps directions to an address (opens the app on a phone). */
export function directionsHref(address: string | null | undefined): string | null {
  const a = address?.trim()
  return a ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}` : null
}

/** The address to drive to: the site details' address, else the street and town answered. */
export function siteAddress(
  answers: Record<string, unknown>,
  siteDetails: Record<string, unknown> | null | undefined,
): string | null {
  const stored = siteDetails?.site_address
  if (typeof stored === 'string' && stored.trim()) return stored.trim()
  const parts = [answers.site_unit, answers.site_street, answers.location].filter(
    (p): p is string => typeof p === 'string' && p.trim() !== '',
  )
  return answers.site_street ? parts.join(', ') : null
}
