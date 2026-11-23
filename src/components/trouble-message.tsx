import { RateLimitedError } from '@/api/errors'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { contactLine } from '@/config/business'

/**
 * What a customer sees when the server refused (too many requests) or could not be reached.
 * Contact details come from the static business config, because the server may be the thing
 * that is down; while they are placeholders (null) the line is left out.
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
  const contact = contactLine()
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
