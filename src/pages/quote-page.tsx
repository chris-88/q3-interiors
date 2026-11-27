import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { BookingApiError, InvalidLinkError } from '@/api/booking'
import {
  useAskForChange,
  useCustomerQuote,
  useDownloadQuotePdf,
  type CustomerQuote,
} from '@/api/customer-quote'
import { PublicLayout } from '@/components/public-layout'
import { TroubleMessage } from '@/components/trouble-message'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatEuro } from '../../supabase/functions/_shared/estimate.ts'
import { longDate, renderQuoteDocument } from '../../supabase/functions/_shared/quote-document.ts'

export const CHANGE_THANKS = 'Thanks. We’ll ring you about it and send an updated quote.'
const CHANGE_MAX = 1000

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/** Loads the quote for one of its pages; the expired-link and trouble states are shared. */
function WithQuote({
  children,
}: {
  children: (q: CustomerQuote, token: string, id: string) => ReactNode
}) {
  const { token = '', quoteId = '' } = useParams()
  const quote = useCustomerQuote(token, quoteId)
  let content: ReactNode
  if (quote.isPending) {
    content = (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your quote">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  } else if (quote.isError) {
    const gone =
      quote.error instanceof InvalidLinkError ||
      (quote.error instanceof BookingApiError && quote.error.reason === 'not_found')
    content = gone ? (
      <>
        <h1 className="text-section text-ink font-medium">This link has expired</h1>
        <p className="text-muted-foreground mt-2">
          Links in our emails work for 30 days. Reply to the email or ring us and we’ll send it
          again.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex min-h-12 items-center underline underline-offset-4"
        >
          Go to the home page
        </Link>
      </>
    ) : (
      <TroubleMessage
        error={quote.error}
        title="We could not load your quote"
        keptNote="Your quote is safe."
      />
    )
  } else {
    content = children(quote.data, token, quoteId)
  }
  return (
    <PublicLayout>
      <div aria-live="polite">{content}</div>
    </PublicLayout>
  )
}

function Newer({ q }: { q: CustomerQuote }) {
  if (q.current) return null
  return (
    <p className="mt-4 rounded-md border p-3 text-sm">
      There is a newer version of this quote. Use the link in our latest email.
    </p>
  )
}

const action = buttonVariants({ variant: 'outline', className: 'h-12 w-full sm:w-auto sm:px-6' })

/** "View my quote": the quote itself, a PDF download, and the two next steps. */
export function QuotePage() {
  return <WithQuote>{(q, token, id) => <QuoteView q={q} token={token} id={id} />}</WithQuote>
}

function QuoteView({ q, token, id }: { q: CustomerQuote; token: string; id: string }) {
  const download = useDownloadQuotePdf(token, id)
  return (
    <>
      <h1 className="text-section text-ink font-medium">
        Your quote {q.number}
        {q.version > 1 ? ` (version ${q.version})` : ''}
      </h1>
      <p className="text-title text-ink mt-2 font-bold tabular-nums">
        {formatEuro(q.price)}, VAT included
      </p>
      <p className="text-muted-foreground mt-1">Good until {longDate(q.validUntil)}</p>
      <Newer q={q} />
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {q.hasPdf && (
          <Button
            className="h-12 w-full sm:w-auto sm:px-6"
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            {download.isPending ? 'Getting the PDF…' : 'Download the PDF'}
          </Button>
        )}
        <Link to={`/quote/${token}/${id}/deposit`} className={action}>
          Pay my deposit
        </Link>
        <Link to={`/quote/${token}/${id}/change`} className={action}>
          Ask for a change
        </Link>
      </div>
      {download.isError && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          The PDF could not be downloaded. It is also attached to your quote email.
        </p>
      )}
      <iframe
        title={`Quote ${q.number}`}
        sandbox=""
        srcDoc={renderQuoteDocument(q.document)}
        className="mt-6 h-[60rem] w-full rounded-md border bg-white"
      />
    </>
  )
}

/** "Ask for a change": a text box and Send (the only thing on these pages that records). */
export function QuoteChangePage() {
  return <WithQuote>{(q, token, id) => <ChangeForm q={q} token={token} id={id} />}</WithQuote>
}

function ChangeForm({ q, token, id }: { q: CustomerQuote; token: string; id: string }) {
  const ask = useAskForChange(token, id)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  if (ask.isSuccess)
    return (
      <>
        <h1 className="text-section text-ink font-medium" tabIndex={-1}>
          {CHANGE_THANKS}
        </h1>
        <Link
          to={`/quote/${token}/${id}`}
          className="mt-6 inline-flex min-h-12 items-center underline underline-offset-4"
        >
          Back to your quote
        </Link>
      </>
    )
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const clean = text.trim()
        if (!clean) return setProblem('Tell us what you’d like changed or added.')
        if (clean.length > CHANGE_MAX) return setProblem(`Keep it under ${CHANGE_MAX} characters.`)
        setProblem(null)
        ask.mutate(clean)
      }}
    >
      <h1 className="text-section text-ink font-medium">Ask for a change</h1>
      <p className="text-muted-foreground mt-2">
        To quote {q.number}, {formatEuro(q.price)}.
      </p>
      <Newer q={q} />
      <label htmlFor="change-text" className="mt-6 block font-medium">
        Tell us what you’d like changed or added
      </label>
      <Textarea
        id="change-text"
        rows={6}
        className="mt-2 text-base md:text-base"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setProblem(null)
        }}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? 'change-error' : undefined}
      />
      {problem && (
        <p id="change-error" role="alert" className="text-destructive mt-1 text-sm">
          {problem}
        </p>
      )}
      <Button type="submit" className="mt-6 h-12 w-full sm:w-auto sm:px-8" disabled={ask.isPending}>
        {ask.isPending ? 'Sending…' : 'Send'}
      </Button>
      {ask.isError && (
        <TroubleMessage
          error={ask.error}
          title="Your message did not reach us"
          keptNote="Nothing was lost."
        />
      )}
    </form>
  )
}

/** "Pay my deposit": online payment is coming; for now, ring or reply. Records nothing. */
export function QuoteDepositPage() {
  return (
    <WithQuote>
      {(q, token, id) => {
        const phone = q.businessPhone?.trim() || q.document.business.phone
        return (
          <>
            <h1 className="text-section text-ink font-medium">Paying online is coming soon.</h1>
            <p className="mt-4">
              Your deposit is {formatEuro(q.depositEur)}, which is {q.depositPercent}% of your
              quote.
            </p>
            <p className="mt-4">
              To pay it now, ring us on{' '}
              {phone ? (
                <a href={tel(phone)} className="underline underline-offset-4">
                  {phone}
                </a>
              ) : (
                'the number in your quote'
              )}{' '}
              or reply to your quote email and we’ll sort it with you.
            </p>
            <p className="mt-4">We confirm your start date once the deposit is in.</p>
            <Link
              to={`/quote/${token}/${id}`}
              className="mt-6 inline-flex min-h-12 items-center underline underline-offset-4"
            >
              Back to your quote
            </Link>
          </>
        )
      }}
    </WithQuote>
  )
}
