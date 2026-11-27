import { ENQUIRY_STATUSES, useSetEnquiryStatus, type EnquiryDetail } from '@/api/enquiries'
import { Button } from '@/components/ui/button'
import { isKnown } from '@/lib/tolerant'

/** Records that someone was in touch (status contacted). Hidden once it is, or for a newer status. */
export function MarkContacted({ enquiry }: { enquiry: EnquiryDetail }) {
  const setStatus = useSetEnquiryStatus()
  if (enquiry.status === 'contacted' || !isKnown(ENQUIRY_STATUSES, enquiry.status))
    return <p className="text-sm">Already marked as contacted.</p>
  return (
    <>
      <Button
        variant="outline"
        className="h-12 w-full sm:w-auto sm:px-6"
        disabled={setStatus.isPending}
        onClick={() => setStatus.mutate({ id: enquiry.id, status: 'contacted', reason: null })}
      >
        {setStatus.isPending ? 'Saving…' : 'Mark as contacted'}
      </Button>
      {setStatus.isError && (
        <p role="alert" className="text-destructive text-sm">
          Not saved. Try again.
        </p>
      )}
    </>
  )
}
