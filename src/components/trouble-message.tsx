import { RateLimitedError } from '@/api/errors'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { contactLine, usePublicBusiness } from '@/api/business'

/**
 * What a customer sees when the server refused (too many requests) or could not be reached.
 * Contact details come from the business details: the server's, or the last copy this browser
 * saw (the server may be the thing that is down). A first-time visitor who cannot reach the
 * server sees no contact line; nothing unconfirmed is ever shown.
 */
export function TroubleMessage({
  error,
  title,
  keptNote,
}: {
  error: unknown
  title: string
  /** What is safe, e.g. "Your answers are still here." */
  keptNote: string
}) {
  const contact = contactLine(usePublicBusiness())
  const limited = error instanceof RateLimitedError
  return (
    <Alert variant="destructive" className="mt-6" role="alert">
      <AlertTitle>{limited ? 'Please try again later' : title}</AlertTitle>
      <AlertDescription>
        <p>
          {limited
            ? 'We have had a lot of requests from your connection in the last hour, so we have paused them for a while. '
            : 'We could not reach our system just now. '}
          {keptNote}{' '}
          {limited
            ? 'Please try again in an hour.'
            : 'Check your connection and try again; it will not be sent twice.'}
        </p>
        {contact && <p className="mt-2">You can also contact us on {contact}.</p>}
      </AlertDescription>
    </Alert>
  )
}
