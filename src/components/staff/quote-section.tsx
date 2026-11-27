import { useState } from 'react'
import { Link } from 'react-router'
import { useBusinessDetails } from '@/api/business'
import type { EnquiryDetail } from '@/api/enquiries'
import { currentQuote, useQuotePdf, type Quote } from '@/api/quotes'
import { Button, buttonVariants } from '@/components/ui/button'
import { DocumentViewer } from '@/components/staff/document-viewer'
import { siteAddress, updatedQuoteDueLine } from '@/lib/enquiry-stage'
import { formatEuro as formatAmount } from '@/lib/outcome'
import { formatDayMonth } from '@/lib/format'
import { formatEuro } from '../../../supabase/functions/_shared/estimate.ts'
import {
  longDate,
  renderQuoteDocument,
} from '../../../supabase/functions/_shared/quote-document.ts'
import { SITE_URL } from '../../../supabase/functions/_shared/site.ts'
import { BUSINESS_TZ, toLocal } from '../../../supabase/functions/_shared/time.ts'

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** The document's inputs for the preview and the staff view (fonts from the site). */
export function documentFor(
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
      <Button
        variant="outline"
        className="h-12 self-start sm:px-6"
        aria-expanded={view}
        onClick={() => setView((v) => !v)}
      >
        {view ? 'Hide the quote' : 'View the quote and PDF'}
      </Button>
      {view && (
        <DocumentViewer
          title={`Quote ${quote.number}`}
          tall
          html={documentFor(
            enquiry,
            { ...quote, sentOn: toLocal(Date.parse(quote.sent_at), BUSINESS_TZ).date },
            business.data ?? null,
          )}
          pdf={{
            ready: Boolean(quote.pdf_path),
            busy: pdf.isFetching,
            failed: pdf.isError,
            onDownload: () => void save(),
          }}
        />
      )}
    </div>
  )
}

/** The Quote section: the current quote and the form, once there is an estimate or a quote. */
export function QuoteSection({ enquiry, now }: { enquiry: EnquiryDetail; now: number }) {
  const current = currentQuote(enquiry.quotes)
  const closed = enquiry.outcome === 'won' || enquiry.outcome === 'lost'
  if (!current && enquiry.estimates.length === 0 && enquiry.quote_amount == null) return null
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
        <p className="text-muted-foreground text-sm">
          {enquiry.quote_amount != null
            ? `Recorded ${formatAmount(enquiry.quote_amount)}${enquiry.quote_date ? ` on ${formatDayMonth(`${enquiry.quote_date}T12:00:00Z`)}` : ''}, sent another way. No quote sent from here yet.`
            : 'No quote sent from here yet.'}
        </p>
      )}
      {!closed && (
        // Folded sections never draw a filled button: the bar holds the one primary action.
        <Link
          to={`/enquiries/${enquiry.id}/quote`}
          className={buttonVariants({
            variant: 'outline',
            className: 'h-12 w-full sm:w-auto sm:self-start sm:px-6',
          })}
        >
          {current ? 'Send an updated quote' : 'Write the quote'}
        </Link>
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
