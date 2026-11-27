// The enquiry page's top (review P3, P7): the five-step strip, the read-only "now" card, the one
// primary action in a bar, and the other actions in a sheet. Everything reads `stageOf()`; the
// actions reuse the forms and panels the page already had, so every server action is unchanged.
import { useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { ENQUIRY_STATUSES, type EnquiryDetail } from '@/api/enquiries'
import { currentQuote } from '@/api/quotes'
import type { StaffBooking } from '@/api/staff-booking'
import { AfterCallChoices, SendLinkPanel } from '@/components/staff/after-call'
import { BookingActions } from '@/components/staff/booking-actions'
import { HowDidItGo, outcomeTarget, outcomeTitle } from '@/components/staff/how-did-it-go'
import { enquiryName } from '@/components/staff/enquiry-text'
import { OutcomeForm, type CurrentOutcome } from '@/components/staff/outcome-form'
import { QuoteSummary } from '@/components/staff/quote-section'
import { StatusForm } from '@/components/staff/status-form'
import { Button, buttonVariants } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import {
  appointmentKind,
  mailHref,
  passedBooking,
  STEP_LABELS,
  stripSteps,
  telHref,
  upcomingBooking,
  type ActionKey,
  type StageInput,
  type StageView,
} from '@/lib/enquiry-stage'
import { formatShortDay, formatShortWhen } from '@/lib/format'
import { draftOf, draftTitle, type DraftKind } from '@/lib/task-draft'
import { isKnown } from '@/lib/tolerant'
import { OUTCOME_STAGES } from '@/lib/outcome'

const firstName = (e: EnquiryDetail) => enquiryName(e).split(' ')[0] ?? ''
/** The customer's words on the change they asked for, on the current quote. */
const changeText = (e: EnquiryDetail) => currentQuote(e.quotes)?.change_request_text ?? null

/**
 * Where they are: Call, Site visit, Estimate, Quote, Deposit, each done (a tick), now (boxed and
 * bold), skipped (dashed, "skipped") or to come, from the record (`stripSteps`).
 */
export function StageStrip({
  enquiry,
  view,
  now,
}: {
  enquiry: StageInput
  view: StageView
  now: number
}) {
  return (
    <ol aria-label="Where they are" className="flex gap-1 text-xs">
      {stripSteps(enquiry, view, now).map(({ step, state }) => (
        <li
          key={step}
          aria-current={state === 'now' ? 'step' : undefined}
          className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 pt-1.5 text-center ${
            state === 'done'
              ? 'border-action text-ink border-t-4'
              : state === 'won'
                ? 'border-action text-ink border-t-4 font-bold'
                : state === 'now'
                  ? 'border-action bg-soft text-ink outline-edge rounded-b border-t-4 pb-1 font-bold outline outline-1'
                  : state === 'skipped'
                    ? 'border-rule text-muted-foreground border-t-4 border-dashed'
                    : 'border-rule text-muted-foreground border-t-4'
          }`}
        >
          <span className="flex items-center gap-0.5">
            {state === 'done' && <Check className="size-3 shrink-0" aria-hidden="true" />}
            {/* Nothing records a deposit yet: a win is shown as itself, not as "Deposit" done. */}
            {state === 'won' ? 'Won' : STEP_LABELS[step]}
          </span>
          {state === 'skipped' && <span className="text-[0.6875rem]">skipped</span>}
          {state === 'now' && <span className="text-[0.6875rem] font-medium">now</span>}
          {state === 'done' && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  )
}

const dueLine = (view: StageView): string | null => {
  if (!view.due || view.due.kind !== 'due') return null
  const day = formatShortDay(`${view.due.date}T12:00:00Z`)
  if (view.urgency === 'overdue') return `Overdue since ${day}`
  if (view.urgency === 'today') return 'Due today'
  return `Due ${day}`
}

/** One read-only card: whose move it is, and what. */
/** A task started on this device and not sent yet (its draft is kept here until it is). */
export function draftLine(enquiry: EnquiryDetail, view: StageView): string | null {
  const draft = draftOf(enquiry, view)
  return draft === 'estimate'
    ? 'Estimate started, not sent (saved on this device)'
    : draft === 'quote'
      ? 'Quote started, not sent (saved on this device)'
      : null
}

/** An action's title, or "Carry on with …" while its draft waits on this device. */
const titleOf = (key: ActionKey, first: string, draft: DraftKind | null) =>
  draftTitle(key, draft) ?? ACTIONS[key].title(first)

export function NowCard({ enquiry, view }: { enquiry: EnquiryDetail; view: StageView }) {
  const first = firstName(enquiry)
  const kicker =
    view.whose === 'q3'
      ? 'Your move'
      : view.whose === 'diary'
        ? 'In the diary'
        : view.whose === 'customer'
          ? `Waiting on ${first}`
          : view.key === 'closed'
            ? 'Closed'
            : 'Result'
  const title =
    view.whose === 'q3' && view.primary
      ? titleOf(view.primary, first, draftOf(enquiry, view))
      : view.whose === 'diary' && view.next
        ? `${appointmentKind(view.next.mode)} ${formatShortWhen(view.next.starts_at)}`
        : view.whose === 'none'
          ? view.news
          : view.label
  const draft = draftLine(enquiry, view)
  const lines = [view.news, dueLine(view), view.whose === 'customer' ? view.chip : null].filter(
    (x, i, all): x is string => !!x && x !== title && all.indexOf(x) === i,
  )
  return (
    <section
      aria-label="Now"
      className={`bg-background rounded-md p-3 ${view.whose === 'none' ? 'border' : 'border-action border-2'}`}
    >
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{kicker}</p>
      <h2 id="now-title" className="text-ink text-lg leading-snug font-medium">
        {title}
      </h2>
      {lines.map((l) => (
        <p key={l} className="text-muted-foreground text-sm">
          {l}
        </p>
      ))}
      {draft && <p className="text-ink text-sm font-medium">{draft}</p>}
      {view.key === 'contact' && enquiry.contact_request_reason && (
        <p className="text-sm break-words">Why: {enquiry.contact_request_reason}</p>
      )}
      {view.key === 'change_requested' && changeText(enquiry) && (
        <blockquote className="mt-2 border-l-2 pl-3 text-sm break-words whitespace-pre-line">
          {changeText(enquiry)}
        </blockquote>
      )}
      {view.key === 'other' && (
        <p className="text-sm">
          This was set by a newer version of the console. Reload to change it here.
        </p>
      )}
    </section>
  )
}

type Ctx = {
  enquiry: EnquiryDetail
  view: StageView
  bookings: StaffBooking[]
  now: number
  close: () => void
  /** Show another action's panel in the sheet. */
  goto: (key: ActionKey) => void
  /** A panel that moves on to another step names it in the sheet's title. */
  retitle: (title: string | null) => void
}

type ActionDef = {
  title: (first: string) => string
  line: string
  danger?: boolean
  /** A link: the phone, email, or a task screen (estimate, quote, booking a visit or call). */
  href?: (e: EnquiryDetail) => string | null
  /** A panel shown in the sheet. */
  panel?: (c: Ctx) => ReactNode
  /** The sheet's title while the panel is open, when it depends on the enquiry. */
  panelTitle?: (c: Ctx) => string
}

function outcomeOf(e: EnquiryDetail): CurrentOutcome {
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

/** One small outcome form (quote, won or lost) that ends the panel, or the summary with its corrections. */
const outcomePanel =
  (start: 'quoted' | 'won' | 'lost' | null) =>
  ({ enquiry, close }: Ctx) => (
    <OutcomeForm
      enquiryId={enquiry.id}
      current={outcomeOf(enquiry)}
      badge={false}
      primary="none"
      start={start ?? undefined}
      onDone={close}
    />
  )

/** The appointment the stage is about: the next one, or the one that just happened. */
function aboutBooking(c: Ctx): StaffBooking | null {
  const rows = c.bookings.map((b) => ({
    ...b,
    confirmed_at: b.state === 'confirmed' ? b.starts_at : null,
    mode: b.appointment_types.mode,
  }))
  return upcomingBooking(rows, c.now) ?? passedBooking(rows, c.now)
}

const bookingPanel =
  (kind: 'move' | 'attendance') =>
  (c: Ctx): ReactNode => {
    const b = aboutBooking(c)
    if (!b) return <p className="text-sm">No appointment to change. Reload to see the latest.</p>
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          {b.appointment_types.label}, {formatShortWhen(b.starts_at)}
        </p>
        <BookingActions
          booking={b}
          moveCancel={kind === 'move'}
          attendance={kind === 'attendance'}
        />
      </div>
    )
  }

/** Every action a stage can offer, with what it does in one line. */
export const ACTIONS: Record<ActionKey, ActionDef> = {
  ring: {
    title: (f) => `Ring ${f}`,
    line: 'Opens the phone',
    href: (e) => telHref(e.answers.phone),
  },
  email: {
    title: (f) => `Email ${f}`,
    line: 'Opens your email',
    href: (e) => mailHref(e.answers.email),
  },
  record_outcome: {
    title: () => 'How did it go?',
    line: 'It went ahead, you spoke earlier, they didn’t show, or it moved',
    panelTitle: ({ bookings, now }) => outcomeTitle(outcomeTarget(bookings, now)),
    panel: ({ enquiry, bookings, now, close, retitle }) => (
      <HowDidItGo enquiry={enquiry} bookings={bookings} now={now} close={close} retitle={retitle} />
    ),
  },
  choose_next: {
    title: () => 'Choose the next step',
    line: 'Book the visit, send a link or write the estimate',
    panel: ({ enquiry, now }) => <AfterCallChoices enquiry={enquiry} now={now} />,
  },
  book_call: {
    title: () => 'Book a call',
    line: 'Pick a time; they get the confirmation email',
    href: (e) => `#/enquiries/${e.id}/call`,
  },
  book_visit: {
    title: () => 'Book the site visit',
    line: 'Pick a time; they get the confirmation email',
    href: (e) => `#/enquiries/${e.id}/visit`,
  },
  send_link: {
    title: () => 'Send a booking link',
    line: 'Emails a link to pick their own visit time',
    panel: ({ enquiry, close }) => <SendLinkPanel enquiry={enquiry} onClose={close} />,
  },
  move: {
    title: () => 'Move or cancel',
    line: 'Pick another time, or cancel; they are emailed',
    panel: bookingPanel('move'),
  },
  cancel: {
    title: () => 'Cancel the appointment',
    line: 'They are emailed and the time is freed',
    danger: true,
    panel: bookingPanel('move'),
  },
  write_estimate: {
    title: () => 'Write the estimate',
    line: 'A price range and the work; you check the email before it goes',
    href: (e) => `#/enquiries/${e.id}/estimate`,
  },
  updated_estimate: {
    title: () => 'Send an updated estimate',
    line: 'A new range, good for a fresh 10 days',
    href: (e) => `#/enquiries/${e.id}/estimate`,
  },
  write_quote: {
    title: () => 'Write the quote',
    line: 'One price, what is and is not included, with a PDF',
    href: (e) => `#/enquiries/${e.id}/quote`,
  },
  revise_quote: {
    title: () => 'Send an updated quote',
    line: 'A new version, good for a fresh 15 working days',
    href: (e) => `#/enquiries/${e.id}/quote`,
  },
  record_quote: {
    title: () => 'Record a quote or result',
    line: 'A quote sent another way, or a win or loss',
    panel: outcomePanel(null),
  },
  view_quote: {
    title: () => 'View or download the quote',
    line: 'The document and its PDF',
    panel: ({ enquiry, now }) => {
      const q = currentQuote(enquiry.quotes)
      return q ? (
        <QuoteSummary enquiry={enquiry} quote={q} now={now} />
      ) : (
        <p>No quote sent from here.</p>
      )
    },
  },
  mark_won: {
    title: () => 'Mark won',
    line: 'They said yes (deposit or not)',
    panel: outcomePanel('won'),
  },
  mark_lost: {
    title: () => 'Mark lost',
    line: 'Note why',
    danger: true,
    panel: outcomePanel('lost'),
  },
  not_suitable: {
    title: () => 'Not suitable',
    line: 'Closes the enquiry with a reason',
    danger: true,
    panel: ({ enquiry }) =>
      isKnown(ENQUIRY_STATUSES, enquiry.status) ? (
        <StatusForm enquiryId={enquiry.id} current={enquiry.status} />
      ) : (
        <p>Status {enquiry.status}: reload to change it.</p>
      ),
  },
  edit_result: {
    title: () => 'Correct the result',
    line: 'Change or clear the outcome',
    panel: outcomePanel(null),
  },
}

/** The bar's action: the stage's primary, or for a diary stage its first other action. */
export function barAction(view: StageView): ActionKey | null {
  if (view.primary) return view.primary
  return view.whose === 'diary' ? (view.others[0] ?? null) : null
}

/**
 * The one primary action and the "more" button. Below 1024px it is a bar fixed to the bottom of
 * the screen (in thumb reach); from 1024px it sits under the now card.
 */
export function ActionBar({
  enquiry,
  view,
  bookings,
  now,
}: {
  enquiry: EnquiryDetail
  view: StageView
  bookings: StaffBooking[]
  now: number
}) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<ActionKey | null>(null)
  // Opened straight from the bar there is no list to go back to.
  const [fromList, setFromList] = useState(false)
  const [retitled, setRetitled] = useState<string | null>(null)
  // Focus lands on the sheet's title, never on its first (possibly destructive) row.
  const title = useRef<HTMLHeadingElement>(null)
  const first = firstName(enquiry)
  const draft = draftOf(enquiry, view)
  const primary = barAction(view)
  const others = view.others.filter((k) => k !== primary)
  const show = (key: ActionKey | null, listed = false) => {
    setPanel(key)
    setRetitled(null)
    setFromList(listed)
    setOpen(true)
  }
  const ctx: Ctx = {
    enquiry,
    view,
    bookings,
    now,
    close: () => setOpen(false),
    retitle: setRetitled,
    goto: (key) => {
      setPanel(key)
      setRetitled(null)
      setFromList(true)
    },
  }
  const pdef = primary ? ACTIONS[primary] : null
  const href = pdef?.href?.(enquiry) ?? null

  return (
    <>
      <section
        aria-label="Actions"
        data-action-bar=""
        className="bg-background fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t px-4 pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:static lg:border-0 lg:p-0"
      >
        {pdef &&
          primary &&
          (pdef.href ? (
            href && (
              <a href={href} className={buttonVariants({ className: 'h-12 flex-1' })}>
                {titleOf(primary, first, draft)}
              </a>
            )
          ) : (
            <Button className="h-12 flex-1" onClick={() => show(primary)}>
              {titleOf(primary, first, draft)}
            </Button>
          ))}
        <Button
          variant="outline"
          className={`h-12 ${pdef ? 'w-14 px-0' : 'flex-1'}`}
          aria-label={pdef ? 'More actions' : undefined}
          aria-haspopup="dialog"
          onClick={() => show(null)}
        >
          {pdef ? <MoreHorizontal className="size-5" aria-hidden="true" /> : 'Actions'}
        </Button>
      </section>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          initialFocus={title}
          className="bg-background max-h-[85dvh] gap-3 overflow-y-auto rounded-t-xl px-4 pt-4 pb-6 lg:mx-auto lg:max-w-xl"
        >
          {panel ? (
            <>
              <div className="flex min-h-12 items-center gap-1 pr-12">
                {fromList && (
                  <Button
                    variant="ghost"
                    className="h-12 px-2"
                    onClick={() => setPanel(null)}
                    aria-label="Back to the actions"
                  >
                    <ChevronLeft className="size-5" aria-hidden="true" />
                  </Button>
                )}
                <SheetTitle ref={title} tabIndex={-1} className="text-lg outline-none">
                  {retitled ?? ACTIONS[panel].panelTitle?.(ctx) ?? ACTIONS[panel].title(first)}
                </SheetTitle>
              </div>
              <SheetDescription className="sr-only">{ACTIONS[panel].line}</SheetDescription>
              {ACTIONS[panel].panel?.(ctx)}
            </>
          ) : (
            <>
              <SheetTitle
                ref={title}
                tabIndex={-1}
                className="flex min-h-12 items-center pr-12 text-lg outline-none"
              >
                {view.label}: other actions
              </SheetTitle>
              <SheetDescription className="sr-only">
                Each action says what it does. Ones that change or close something ask first.
              </SheetDescription>
              <ul className="flex flex-col gap-2">
                {others.map((key) => {
                  const def = ACTIONS[key]
                  const link = def.href?.(enquiry)
                  const body = (
                    <>
                      <span className="flex flex-col text-left">
                        <span className={`font-medium ${def.danger ? 'text-destructive' : ''}`}>
                          {titleOf(key, first, draft)}
                        </span>
                        <span className="text-muted-foreground text-sm font-normal">
                          {def.line}
                        </span>
                      </span>
                      <ChevronRight
                        className="text-muted-foreground size-5 shrink-0"
                        aria-hidden="true"
                      />
                    </>
                  )
                  const row =
                    'border-edge hover:bg-soft flex min-h-14 w-full items-center justify-between gap-3 rounded-md border px-3 py-2'
                  return (
                    <li key={key}>
                      {def.href ? (
                        link ? (
                          <a href={link} className={row}>
                            {body}
                          </a>
                        ) : null
                      ) : (
                        <button type="button" className={row} onClick={() => show(key, true)}>
                          {body}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
