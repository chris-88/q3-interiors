import { useEffect, useMemo, useState } from 'react'
import { useBusinessDetails } from '@/api/business'
import type { EnquiryDetail } from '@/api/enquiries'
import { parsePrice } from '@/api/estimates'
import {
  currentQuote,
  depositOn,
  QUOTE_DEPOSIT_PERCENT,
  QUOTE_NOTE_MAX,
  useQuotePdf,
  useSendQuote,
  type Quote,
} from '@/api/quotes'
import { useWordingOverrides } from '@/api/wording'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { WorkItemsPicker } from '@/components/staff/work-items-picker'
import { Confirm } from '@/components/staff/confirm'
import { currentEstimate, siteAddress, updatedQuoteDueLine } from '@/lib/enquiry-stage'
import { formatDayMonth } from '@/lib/format'
import { formatEuro, PRICE_MAX, PRICE_MIN } from '../../../supabase/functions/_shared/estimate.ts'
import { WORDING } from '../../../supabase/functions/_shared/messages.ts'
import {
  longDate,
  renderQuoteDocument,
} from '../../../supabase/functions/_shared/quote-document.ts'
import { SITE_URL } from '../../../supabase/functions/_shared/site.ts'
import { BUSINESS_TZ, toLocal } from '../../../supabase/functions/_shared/time.ts'
import {
  addWorkingDays,
  QUOTE_VALID_WORKING_DAYS,
} from '../../../supabase/functions/_shared/working-days.ts'

/** The Next step's "Write the quote" opens the form here. */
export const WRITE_QUOTE_EVENT = 'q3:write-quote'

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** The document's inputs for the preview and the staff view (fonts from the site). */
function documentFor(
  enquiry: EnquiryDetail,
  q: Pick<
    Quote,
    | 'number'
    | 'version'
    | 'included'
    | 'excluded'
    | 'note'
    | 'price_eur'
    | 'deposit_percent'
    | 'deposit_eur'
    | 'valid_until'
    | 'terms'
  > & { sentOn: string },
  business: {
    legal_name?: string | null
    contact_phone?: string | null
    contact_email?: string | null
  } | null,
) {
  const project = text(enquiry.answers.project_type)
  return renderQuoteDocument({
    number: q.number,
    version: q.version,
    sentOn: q.sentOn,
    validUntil: q.valid_until,
    customerName: text(enquiry.answers.name) ?? '',
    jobAddress:
      text(enquiry.site_details?.site_address) ??
      siteAddress(enquiry.answers, enquiry.site_details),
    jobLine: [project, text(enquiry.answers.location)].filter(Boolean).join(', ') || null,
    business: {
      legalName: business?.legal_name ?? null,
      phone: business?.contact_phone ?? null,
      email: business?.contact_email ?? null,
    },
    included: q.included,
    excluded: q.excluded,
    note: q.note,
    price: q.price_eur,
    depositPercent: q.deposit_percent,
    depositEur: q.deposit_eur,
    terms: q.terms,
    fontBase: `${SITE_URL}/quote/`,
  })
}

function sendError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('no email address')) return 'This enquiry has no email address to send to.'
  if (message.includes('enquiry closed')) return 'This enquiry is marked won or lost.'
  if (message.includes('not allowed')) return 'Your account cannot send quotes.'
  return 'The quote was not sent. Try again.'
}

/** The current quote: its line, the change asked for, View and Download PDF. */
export function QuoteSummary({
  enquiry,
  quote,
  now,
}: {
  enquiry: EnquiryDetail
  quote: Quote
  now: number
}) {
  const [view, setView] = useState(false)
  const pdf = useQuotePdf(quote.pdf_path, false)
  const business = useBusinessDetails()
  const save = async () => {
    const { data } = await pdf.refetch()
    if (!data) return
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `${quote.number}${quote.version > 1 ? `-v${quote.version}` : ''}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        Quote {quote.number}
        {quote.version > 1 ? ` (version ${quote.version})` : ''} sent{' '}
        {formatDayMonth(quote.sent_at)}: {formatEuro(quote.price_eur)}
      </p>
      <p className="text-muted-foreground text-sm">
        Good until {longDate(quote.valid_until)} · deposit {formatEuro(quote.deposit_eur)}
        {quote.created_by_name ? ` · ${quote.created_by_name}` : ''}
      </p>
      {quote.change_requested_at && (
        <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">
          <p className="text-sm font-medium">
            Change asked for {formatDayMonth(quote.change_requested_at)} ·{' '}
            {updatedQuoteDueLine(quote, now)}
          </p>
          {quote.change_request_text && (
            <p className="mt-1 text-sm break-words whitespace-pre-line">
              {quote.change_request_text}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          className="h-12 sm:px-6"
          aria-expanded={view}
          onClick={() => setView((v) => !v)}
        >
          {view ? 'Hide the quote' : 'View'}
        </Button>
        <Button
          variant="outline"
          className="h-12 sm:px-6"
          disabled={!quote.pdf_path || pdf.isFetching}
          onClick={() => void save()}
        >
          {quote.pdf_path ? 'Download PDF' : 'PDF not made yet'}
        </Button>
      </div>
      {pdf.isError && (
        <p role="alert" className="text-destructive text-sm">
          Could not download the PDF.
        </p>
      )}
      {view && (
        <iframe
          title={`Quote ${quote.number}`}
          sandbox=""
          srcDoc={documentFor(
            enquiry,
            { ...quote, sentOn: toLocal(Date.parse(quote.sent_at), BUSINESS_TZ).date },
            business.data ?? null,
          )}
          className="h-[48rem] w-full rounded-md border bg-white"
        />
      )}
    </div>
  )
}

function QuoteForm({
  enquiry,
  previous,
  onSent,
  onCancel,
}: {
  enquiry: EnquiryDetail
  previous: Quote | null
  onSent: (to: string) => void
  onCancel: () => void
}) {
  const estimate = currentEstimate(enquiry.estimates)
  const send = useSendQuote(enquiry.id)
  const wording = useWordingOverrides()
  const business = useBusinessDetails()
  const projectType = text(enquiry.answers.project_type)
  const [price, setPrice] = useState(previous ? String(previous.price_eur) : '')
  const [included, setIncluded] = useState<string[]>(
    previous?.included ?? estimate?.work_items ?? [],
  )
  const [excluded, setExcluded] = useState<string[]>(previous?.excluded ?? [])
  const [note, setNote] = useState(previous?.note ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const email = text(enquiry.answers.email)

  const n = parsePrice(price)
  const validPrice = n !== null && n >= PRICE_MIN && n <= PRICE_MAX
  const deposit = validPrice ? depositOn(n) : null
  // Today in Ireland, and good for 15 working days, as send_quote will set them.
  const [today] = useState(() => toLocal(Date.now(), BUSINESS_TZ).date)
  const until = addWorkingDays(`${today}T12:00:00Z`, QUOTE_VALID_WORKING_DAYS)
  const terms = (wording.data?.quote_terms?.trim() || WORDING.quote_terms.default).replace(
    '{date}',
    longDate(until),
  )
  const preview = useMemo(
    () =>
      documentFor(
        enquiry,
        {
          number: previous?.number ?? 'Q3-Q-0000',
          version: previous ? previous.version + 1 : 1,
          included: included.length ? included : ['The work you tick appears here'],
          excluded,
          note: note.trim() || null,
          price_eur: validPrice ? n : 0,
          deposit_percent: QUOTE_DEPOSIT_PERCENT,
          deposit_eur: deposit ?? 0,
          valid_until: until,
          terms,
          sentOn: today,
        },
        business.data ?? null,
      ),
    [
      enquiry,
      previous,
      included,
      excluded,
      note,
      validPrice,
      n,
      deposit,
      until,
      terms,
      today,
      business.data,
    ],
  )

  const check = () => {
    const next: Record<string, string> = {}
    if (!validPrice) next.price = `Enter the price in whole euro, at least €${PRICE_MIN}.`
    if (included.length === 0) next.included = 'Tick at least one thing that is included.'
    if (note.trim().length > QUOTE_NOTE_MAX)
      next.note = `Keep it under ${QUOTE_NOTE_MAX} characters.`
    setErrors(next)
    const first = Object.keys(next)[0]
    if (first) document.getElementById(`quote-${first}`)?.focus()
    return first ? null : { price: n as number }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (check()) setConfirming(true)
      }}
    >
      <p className="text-muted-foreground text-sm">
        One price, VAT included.
        {estimate && !previous ? ' Pre-ticked from the estimate.' : ''}
        {previous ? ` This replaces ${previous.number} version ${previous.version}.` : ''}
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="quote-price" className="text-sm font-medium">
          Price in euro
        </label>
        <Input
          id="quote-price"
          inputMode="numeric"
          autoComplete="off"
          className="h-12 text-base"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value)
            setConfirming(false)
            setErrors(({ price: _p, ...rest }) => rest)
          }}
          aria-invalid={errors.price ? true : undefined}
        />
        {errors.price && (
          <p role="alert" className="text-destructive text-sm">
            {errors.price}
          </p>
        )}
        <p className="text-sm" aria-live="polite">
          {deposit !== null
            ? `Deposit: ${formatEuro(deposit)} (${QUOTE_DEPOSIT_PERCENT}% of the price)`
            : `Deposit: ${QUOTE_DEPOSIT_PERCENT}% of the price`}
        </p>
      </div>
      <div id="quote-included" tabIndex={-1} className="flex flex-col gap-1">
        <WorkItemsPicker
          projectType={projectType}
          legend="What’s included"
          idPrefix="quote-in"
          ticked={included}
          invalid={Boolean(errors.included)}
          onChange={(next) => {
            setIncluded(next)
            setConfirming(false)
            setErrors(({ included: _i, ...rest }) => rest)
          }}
        />
        {errors.included && (
          <p role="alert" className="text-destructive text-sm">
            {errors.included}
          </p>
        )}
      </div>
      <WorkItemsPicker
        projectType={null}
        kind="excluded"
        legend="What’s not included"
        idPrefix="quote-out"
        ticked={excluded}
        onChange={(next) => {
          setExcluded(next)
          setConfirming(false)
        }}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="quote-note" className="text-sm font-medium">
          Note (optional)
        </label>
        <Textarea
          id="quote-note"
          rows={3}
          className="text-base md:text-base"
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            setConfirming(false)
            setErrors(({ note: _n, ...rest }) => rest)
          }}
          aria-invalid={errors.note ? true : undefined}
        />
        {errors.note && (
          <p role="alert" className="text-destructive text-sm">
            {errors.note}
          </p>
        )}
      </div>
      <details className="group" open>
        <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium">
          The quote
        </summary>
        <p className="text-muted-foreground mb-2 text-xs">
          Good until {longDate(until)} (15 working days). Emailed to {email ?? 'no email address'}{' '}
          with this as a PDF.
        </p>
        <iframe
          title="Quote preview"
          sandbox=""
          srcDoc={preview}
          className="h-[48rem] w-full rounded-md border bg-white"
        />
      </details>
      {!email && (
        <p role="alert" className="text-destructive text-sm">
          This enquiry has no email address, so the quote cannot be sent.
        </p>
      )}
      {confirming && validPrice ? (
        <Confirm
          question={`Send the quote for ${formatEuro(n)} to ${email}?`}
          detail="The email and its PDF go within a minute. The enquiry is marked quoted."
          confirm="Yes, send it"
          pendingLabel="Sending…"
          pending={send.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            if (!check()) return setConfirming(false)
            send.mutate(
              {
                price: n,
                included,
                excluded,
                note,
                estimateId: previous?.estimate_id ?? estimate?.id ?? null,
              },
              { onSuccess: () => onSent(email ?? '') },
            )
          }}
        />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="h-12 sm:px-6" disabled={!email}>
            {previous ? 'Send the updated quote' : 'Send quote'}
          </Button>
          <Button type="button" variant="ghost" className="h-12" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {send.isError && (
        <p role="alert" className="text-destructive text-sm">
          {sendError(send.error)}
        </p>
      )}
    </form>
  )
}

/** The Quote section: the current quote and the form, once there is an estimate or a quote. */
export function QuoteSection({ enquiry, now }: { enquiry: EnquiryDetail; now: number }) {
  const [open, setOpen] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const current = currentQuote(enquiry.quotes)
  const closed = enquiry.outcome === 'won' || enquiry.outcome === 'lost'
  useEffect(() => {
    const show = () => {
      setOpen(true)
      setSentTo(null)
      // The section may be folded on the enquiry page: open it, then bring it into view.
      document.getElementById('fold-quote')?.setAttribute('open', '')
      window.requestAnimationFrame(() =>
        document.getElementById('quote')?.scrollIntoView({ behavior: 'smooth' }),
      )
    }
    window.addEventListener(WRITE_QUOTE_EVENT, show)
    return () => window.removeEventListener(WRITE_QUOTE_EVENT, show)
  }, [])
  if (!current && enquiry.estimates.length === 0) return null
  const earlier = [...enquiry.quotes].sort((a, b) => b.version - a.version).slice(1)
  return (
    <section
      id="quote"
      aria-labelledby="quote-heading"
      className="bg-background flex scroll-mt-4 flex-col gap-3 rounded-md border p-4"
    >
      <h2 id="quote-heading" className="text-base font-medium">
        Quote
      </h2>
      {current ? (
        <QuoteSummary enquiry={enquiry} quote={current} now={now} />
      ) : (
        <p className="text-muted-foreground text-sm">No quote sent from here yet.</p>
      )}
      <output className="block text-sm">
        {sentTo ? `Quote sent to ${sentTo}. The email and PDF go within a minute.` : ''}
      </output>
      {!closed && !open && (
        <Button
          variant={current && !current.change_requested_at ? 'outline' : 'default'}
          className="h-12 w-full sm:w-auto sm:self-start sm:px-6"
          onClick={() => {
            setOpen(true)
            setSentTo(null)
          }}
        >
          {current ? 'Send an updated quote' : 'Write the quote'}
        </Button>
      )}
      {!closed && open && (
        <QuoteForm
          enquiry={enquiry}
          previous={current}
          onCancel={() => setOpen(false)}
          onSent={(to) => {
            setOpen(false)
            setSentTo(to)
          }}
        />
      )}
      {earlier.length > 0 && (
        <details>
          <summary className="text-muted-foreground flex min-h-12 cursor-pointer items-center text-sm">
            Earlier versions ({earlier.length})
          </summary>
          <ul className="flex flex-col gap-2">
            {earlier.map((q) => (
              <li key={q.id} className="text-sm">
                Version {q.version}, sent {formatDayMonth(q.sent_at)}: {formatEuro(q.price_eur)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
