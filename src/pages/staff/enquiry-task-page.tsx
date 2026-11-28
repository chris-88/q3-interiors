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
import { siteAddress } from '@/lib/enquiry-stage'
import {
  useJobPlan,
  useProducts,
  useStageTemplate,
  useStartPlan,
  useTradespeople,
} from '@/api/job-plan'
import { PlanLists, PlanView } from '@/components/staff/job-plan'

export const TASKS = ['estimate', 'quote', 'visit', 'call', 'plan'] as const
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
    <TaskFrame enquiryId={enquiry.id} name={enquiryName(enquiry)} title={title} focusTitle>
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
      focusTitle
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
    <TaskFrame
      enquiryId={enquiry.id}
      name={enquiryName(enquiry)}
      title="Book a call"
      padded
      focusTitle
    >
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

/** The job plan (won jobs): start it from the job type's stages, then stages and materials. */
function PlanTask({ enquiry }: { enquiry: EnquiryDetail }) {
  const plan = useJobPlan(enquiry.id)
  const products = useProducts()
  const people = useTradespeople()
  const projectType =
    typeof enquiry.answers.project_type === 'string' ? enquiry.answers.project_type : null
  const notStarted = plan.data?.stages.length === 0
  const template = useStageTemplate(projectType, notStarted)
  const start = useStartPlan(enquiry.id)
  const address = siteAddress(enquiry.answers, enquiry.site_details)
  const failed = plan.isError || products.isError || people.isError
  return (
    <TaskFrame
      enquiryId={enquiry.id}
      name={enquiryName(enquiry)}
      title="Job plan"
      about={[address, 'Stages, materials and who does each stage. Only staff see this.']
        .filter(Boolean)
        .join(' · ')}
      layout="stacked"
      focusTitle
      bar={
        notStarted ? (
          <Button
            className="h-12 flex-1"
            disabled={start.isPending || !template.data}
            onClick={() => start.mutate()}
          >
            {start.isPending ? 'Starting…' : 'Start the plan'}
          </Button>
        ) : undefined
      }
    >
      {failed ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not load the plan</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              className="mt-2 h-12"
              onClick={() => {
                void plan.refetch()
                void products.refetch()
                void people.refetch()
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !plan.data || !products.data || !people.data ? (
        <Skeleton className="h-64 w-full" />
      ) : notStarted ? (
        <div className="flex flex-col gap-3">
          <p>
            Start from the usual stages for this kind of job. You can rename, reorder, add and
            remove them after.
          </p>
          {template.isError ? (
            <p role="alert" className="text-destructive text-sm">
              Could not load the usual stages. Reload to try again.
            </p>
          ) : !template.data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ol aria-label="The usual stages" className="list-decimal pl-6">
              {template.data.map((name) => (
                <li key={name} className="py-0.5">
                  {name}
                </li>
              ))}
            </ol>
          )}
          {start.isError && (
            <p role="alert" className="text-destructive text-sm">
              {start.error.message.includes('not won')
                ? 'A plan starts once the job is won.'
                : 'The plan was not started. Try again.'}
            </p>
          )}
          <PlanLists />
        </div>
      ) : (
        <PlanView
          enquiryId={enquiry.id}
          plan={plan.data}
          products={products.data}
          people={people.data}
        />
      )}
    </TaskFrame>
  )
}

function TaskView({ enquiry, task, now }: { enquiry: EnquiryDetail; task: Task; now: number }) {
  const bookings = useEnquiryBookings(enquiry.id)
  const closed = enquiry.outcome === 'won' || enquiry.outcome === 'lost'
  if (task === 'visit') return <BookVisitTask enquiry={enquiry} />
  if (task === 'call') return <BookCallTask enquiry={enquiry} />
  if (task === 'plan')
    return enquiry.outcome === 'won' ? (
      <PlanTask enquiry={enquiry} />
    ) : (
      <Unavailable enquiry={enquiry} title="Job plan" why="A plan starts once the job is won." />
    )
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
