// A focused task on one enquiry (review P5): `#/enquiries/:id/estimate`, `/quote`, `/visit`,
// `/call`. The enquiry page's sections and stage bar are not shown; the task's own action is.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { useEnquiry, type EnquiryDetail } from '@/api/enquiries'
import { currentQuote } from '@/api/quotes'
import { useEnquiryBookings } from '@/api/staff-booking'
import { BookCallPanel, BookVisitPanel, SendLinkPanel } from '@/components/staff/after-call'
import { enquiryName } from '@/components/staff/enquiry-text'
import { EstimateTask } from '@/components/staff/estimate-task'
import { estimateSource } from '@/components/staff/estimate-section'
import { QuoteTask } from '@/components/staff/quote-task'
import { TaskFrame } from '@/components/staff/task-frame'
import { useLoadedAt } from '@/components/staff/use-loaded-at'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatShortWhen } from '@/lib/format'

export const TASKS = ['estimate', 'quote', 'visit', 'call'] as const
type Task = (typeof TASKS)[number]

/** A task that cannot start here (nothing to estimate yet, already won): say so, and the way back. */
function Unavailable({
  enquiry,
  title,
  why,
}: {
  enquiry: EnquiryDetail
  title: string
  why: string
}) {
  return (
    <TaskFrame enquiryId={enquiry.id} name={enquiryName(enquiry)} title={title}>
      <p>{why}</p>
    </TaskFrame>
  )
}

function BookVisitTask({ enquiry }: { enquiry: EnquiryDetail }) {
  const navigate = useNavigate()
  const [link, setLink] = useState(false)
  const back = (notice: string) =>
    navigate(`/enquiries/${enquiry.id}`, { replace: true, state: { notice } })
  return (
    <TaskFrame
      enquiryId={enquiry.id}
      name={enquiryName(enquiry)}
      title={link ? 'Send a booking link' : 'Book the site visit'}
      padded={!link}
    >
      {link ? (
        <SendLinkPanel enquiry={enquiry} onClose={() => setLink(false)} />
      ) : (
        <BookVisitPanel
          enquiry={enquiry}
          onUseLink={() => setLink(true)}
          onBooked={(start) =>
            back(
              `Site visit booked for ${formatShortWhen(start)}. They are emailed the confirmation.`,
            )
          }
        />
      )}
    </TaskFrame>
  )
}

function BookCallTask({ enquiry }: { enquiry: EnquiryDetail }) {
  const navigate = useNavigate()
  return (
    <TaskFrame enquiryId={enquiry.id} name={enquiryName(enquiry)} title="Book a call" padded>
      <BookCallPanel
        enquiry={enquiry}
        onBooked={(start) =>
          navigate(`/enquiries/${enquiry.id}`, {
            replace: true,
            state: {
              notice: `Call booked for ${formatShortWhen(start)}. They get the usual confirmation email.`,
            },
          })
        }
      />
    </TaskFrame>
  )
}

function TaskView({ enquiry, task, now }: { enquiry: EnquiryDetail; task: Task; now: number }) {
  const bookings = useEnquiryBookings(enquiry.id)
  const closed = enquiry.outcome === 'won' || enquiry.outcome === 'lost'
  if (task === 'visit') return <BookVisitTask enquiry={enquiry} />
  if (task === 'call') return <BookCallTask enquiry={enquiry} />
  if (task === 'quote')
    return closed ? (
      <Unavailable
        enquiry={enquiry}
        title="Write the quote"
        why="This enquiry is marked won or lost, so a quote cannot be sent from here."
      />
    ) : (
      <QuoteTask enquiry={enquiry} previous={currentQuote(enquiry.quotes)} />
    )
  if (bookings.isPending) return <Skeleton className="h-64 w-full" />
  if (bookings.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Could not load the appointments</AlertTitle>
        <AlertDescription>
          <Button variant="outline" className="mt-2 h-12" onClick={() => void bookings.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  const source = estimateSource(enquiry, bookings.data ?? [], now)
  return source ? (
    <EstimateTask enquiry={enquiry} source={source} />
  ) : (
    <Unavailable
      enquiry={enquiry}
      title="Write the estimate"
      why="An estimate follows a site visit or a call that was held; neither is recorded yet."
    />
  )
}

export function EnquiryTaskPage() {
  const { id = '', task = '' } = useParams()
  const enquiry = useEnquiry(id)
  const now = useLoadedAt(enquiry.dataUpdatedAt)
  const known = (TASKS as readonly string[]).includes(task)

  if (enquiry.isPending)
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading enquiry">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  if (enquiry.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Could not load this enquiry</AlertTitle>
        <AlertDescription>
          <Button variant="outline" className="mt-2 h-12" onClick={() => void enquiry.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  if (!enquiry.data || !known)
    return (
      <div className="flex flex-col gap-2">
        <Link
          to={enquiry.data ? `/enquiries/${id}` : '/'}
          className="text-primary inline-flex min-h-12 items-center gap-1 self-start text-sm underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {enquiry.data ? 'Back to the enquiry' : 'All enquiries'}
        </Link>
        <p className="bg-background text-muted-foreground rounded-md border p-6">
          {enquiry.data ? 'Nothing to do at this link.' : 'No enquiry with this link.'}
        </p>
      </div>
    )
  return <TaskView key={`${id}-${task}`} enquiry={enquiry.data} task={task as Task} now={now} />
}
