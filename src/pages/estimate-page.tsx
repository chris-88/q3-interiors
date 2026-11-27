import { Link, useParams } from 'react-router'
import { BookingApiError, InvalidLinkError } from '@/api/booking'
import { useCustomerEstimate, useRequestQuote } from '@/api/quote'
import { PublicLayout } from '@/components/public-layout'
import { TroubleMessage } from '@/components/trouble-message'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRange } from '../../supabase/functions/_shared/estimate.ts'

export const QUOTE_THANKS = 'We’ll send your quote: one price, with what’s included and what isn’t.'

function Thanks() {
  return (
    <>
      <h1 className="text-section text-ink font-medium" tabIndex={-1}>
        Thanks.
      </h1>
      <p className="mt-2">{QUOTE_THANKS}</p>
    </>
  )
}

/**
 * The estimate email's "Get my quote" (`/#/estimate/<token>/<estimate id>`). Opening it shows the
 * estimate and one button; only the button records the yes.
 */
export function EstimatePage() {
  const { token = '', estimateId = '' } = useParams()
  const estimate = useCustomerEstimate(token, estimateId)
  const request = useRequestQuote(token, estimateId)

  let content
  if (estimate.isPending) {
    content = (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your estimate">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  } else if (estimate.isError) {
    const gone =
      estimate.error instanceof InvalidLinkError ||
      (estimate.error instanceof BookingApiError && estimate.error.reason === 'not_found')
    content = gone ? (
      <>
        <h1 className="text-section text-ink font-medium">This link has expired</h1>
        <p className="text-muted-foreground mt-2">
          Links in our emails work for 30 days. Reply to the email or ring us and we’ll send your
          quote.
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
        error={estimate.error}
        title="We could not load your estimate"
        keptNote="Your estimate is safe."
      />
    )
  } else if (estimate.data.quoteRequested || request.isSuccess) {
    content = <Thanks />
  } else {
    const e = estimate.data
    content = (
      <>
        <h1 className="text-section text-ink font-medium">Get your quote</h1>
        <p className="text-muted-foreground mt-4 text-sm">Your estimate</p>
        <p className="text-title text-ink font-bold tabular-nums">
          {formatRange(e.low, e.high)}, VAT included
        </p>
        <p className="mt-4 text-sm">The work we looked at:</p>
        {e.workItems.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {e.workItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        {(e.note ?? e.workLookedAt) && (
          <p className="mt-1 text-sm break-words whitespace-pre-line">{e.note ?? e.workLookedAt}</p>
        )}
        <p className="mt-6">
          Tell us to go ahead and we’ll send your quote: one price, with what’s included and what
          isn’t. You don’t commit to anything until you accept the quote.
        </p>
        <Button
          className="mt-6 h-12 w-full sm:w-auto sm:px-8"
          disabled={request.isPending}
          onClick={() => request.mutate()}
        >
          {request.isPending ? 'Sending…' : 'Get my quote'}
        </Button>
        {request.isError && (
          <TroubleMessage
            error={request.error}
            title="Your request did not reach us"
            keptNote="Nothing was lost."
          />
        )}
      </>
    )
  }

  return (
    <PublicLayout>
      <div aria-live="polite">{content}</div>
    </PublicLayout>
  )
}
