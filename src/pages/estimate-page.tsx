import { Link, useParams } from 'react-router'
import { BookingApiError, InvalidLinkError } from '@/api/booking'
import { useCustomerEstimate, useRequestQuote, type CustomerEstimate } from '@/api/quote'
import { PublicLayout } from '@/components/public-layout'
import { TroubleMessage } from '@/components/trouble-message'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { estimateWords, formatRange } from '../../supabase/functions/_shared/estimate.ts'
import { quoteSteps } from '../../supabase/functions/_shared/quote-page.ts'

export const QUOTE_THANKS = 'Thanks. We’re preparing your quote.'

/** "What happens next", the same list before and after the click. */
function NextSteps({ text }: { text: string }) {
  return (
    <>
      <h2 className="text-ink mt-6 text-base font-medium">What happens next</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-6">
        {quoteSteps(text).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </>
  )
}

function Thanks({ e }: { e: CustomerEstimate }) {
  const phone = e.businessPhone?.trim()
  return (
    <>
      <h1 className="text-section text-ink font-medium" tabIndex={-1}>
        {QUOTE_THANKS}
      </h1>
      {e.text.quote_timing && <p className="mt-2">{e.text.quote_timing}</p>}
      <NextSteps text={e.text.quote_page_steps} />
      {phone && (
        <p className="mt-6">
          Any questions, ring us on{' '}
          <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="underline underline-offset-4">
            {phone}
          </a>
          .
        </p>
      )}
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
    content = <Thanks e={estimate.data} />
  } else {
    const e = estimate.data
    content = (
      <>
        <h1 className="text-section text-ink font-medium">Happy with your estimate?</h1>
        <p className="text-muted-foreground mt-4 text-sm">Your estimate</p>
        <p className="text-title text-ink font-bold tabular-nums">
          {formatRange(e.low, e.high)}, VAT included
        </p>
        <p className="mt-4 text-sm">{estimateWords(e.after).heading}</p>
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
        <p className="mt-6">{e.text.quote_page_ask}</p>
        <h2 className="text-ink mt-6 text-base font-medium">What a quote is</h2>
        <p className="mt-1">{e.text.quote_page_what}</p>
        <NextSteps text={e.text.quote_page_steps} />
        <p className="mt-6">{e.text.quote_page_commit}</p>
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
