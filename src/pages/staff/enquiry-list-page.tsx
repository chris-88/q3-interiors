import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { useEnquiries, useFormVersions, type EnquirySummary } from '@/api/enquiries'
import { EnquiryFlags } from '@/components/staff/enquiry-flags'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { StatusBadge } from '@/components/staff/status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { findField, formatAnswer } from '@/forms/logic'
import type { FormDefinition } from '@/forms/types'
import { formatDateTime } from '@/lib/format'
import {
  OUTCOME_FILTERS,
  matchesOutcomeFilter,
  stageLabel,
  type OutcomeFilter,
} from '@/lib/outcome'

function projectSummary(enquiry: EnquirySummary, form: FormDefinition | undefined): string {
  const type = enquiry.answers.project_type
  if (
    enquiry.answers.project_type_other &&
    typeof enquiry.answers.project_type_other === 'string'
  ) {
    return enquiry.answers.project_type_other
  }
  const field = form ? findField(form, 'project_type') : undefined
  return (field ? formatAnswer(field, type) : null) ?? (typeof type === 'string' ? type : 'Project')
}

/** Form v2's project follow-up (kitchen layout or rooms), for the list line. */
function projectFollowUp(enquiry: EnquirySummary, form: FormDefinition | undefined): string | null {
  for (const id of ['kitchen_layout', 'rooms_involved']) {
    const field = form ? findField(form, id) : undefined
    const value = field ? formatAnswer(field, enquiry.answers[id]) : null
    if (value) return id === 'kitchen_layout' ? `Layout: ${value}` : `Rooms: ${value}`
  }
  return null
}

/** The outcome on a list row: the stage, or "Awaiting quote" once an appointment has happened. */
function outcomeLine(enquiry: EnquirySummary, now: number): string | null {
  if (enquiry.outcome !== null) return `Outcome: ${stageLabel(enquiry.outcome)}`
  return matchesOutcomeFilter(enquiry, 'awaiting_quote', now) ? 'Awaiting quote' : null
}

const FILTER_KEY = 'q3.staff.enquiryFilter'

function readFilter(): OutcomeFilter {
  try {
    const v = window.sessionStorage.getItem(FILTER_KEY)
    return OUTCOME_FILTERS.some(([key]) => key === v) ? (v as OutcomeFilter) : 'all'
  } catch {
    return 'all'
  }
}

export function EnquiryListPage() {
  const location = useLocation()
  const deleted = (location.state as { deleted?: string } | null)?.deleted ?? null
  const enquiries = useEnquiries()
  const forms = useFormVersions()
  const [filter, setFilter] = useState<OutcomeFilter>(readFilter)
  const [now] = useState(() => Date.now())
  const choose = (next: OutcomeFilter) => {
    setFilter(next)
    try {
      window.sessionStorage.setItem(FILTER_KEY, next)
    } catch {
      // storage blocked: the filter still works for this visit
    }
  }
  const shown = enquiries.data?.filter((e) => matchesOutcomeFilter(e, filter, now)) ?? []

  return (
    <>
      <ExceptionsBanner />
      {deleted && (
        <Alert className="mb-4">
          <AlertDescription>
            {deleted} was deleted. A note of the deletion (reference, time, who) is kept.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Enquiries</h1>
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => void enquiries.refetch()}
          disabled={enquiries.isFetching}
        >
          {enquiries.isFetching && !enquiries.isPending ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <fieldset className="mt-3 min-w-0">
        <legend className="sr-only">Show</legend>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {OUTCOME_FILTERS.map(([key, label]) => (
            <label
              key={key}
              className="border-edge has-[:checked]:border-action has-[:checked]:bg-action has-[:focus-visible]:outline-action inline-flex min-h-12 shrink-0 cursor-pointer items-center rounded-full border px-4 text-sm has-[:checked]:text-white has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid"
            >
              <input
                type="radio"
                name="outcome-filter"
                className="sr-only"
                checked={filter === key}
                onChange={() => choose(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {enquiries.isPending ? (
        <div className="mt-4 flex flex-col gap-2" aria-busy="true" aria-label="Loading enquiries">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : enquiries.isError ? (
        <Alert variant="destructive" role="alert" className="mt-4">
          <AlertTitle>Could not load enquiries</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void enquiries.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : enquiries.data.length === 0 ? (
        <p className="bg-background text-muted-foreground mt-6 rounded-xl border p-6 text-center">
          No enquiries yet. New ones appear here as soon as they are sent.
        </p>
      ) : shown.length === 0 ? (
        <p className="bg-background text-muted-foreground mt-6 rounded-xl border p-6 text-center">
          No enquiries match “{OUTCOME_FILTERS.find(([k]) => k === filter)?.[1]}”.
        </p>
      ) : (
        <ul aria-label="Enquiries" className="mt-4 flex flex-col gap-2">
          {shown.map((enquiry) => {
            const outcome = outcomeLine(enquiry, now)
            const form = forms.data?.get(`${enquiry.form_id}@${enquiry.form_version}`)
            const location = enquiry.answers.location
            return (
              <li key={enquiry.id}>
                <Link
                  to={`/enquiries/${enquiry.id}`}
                  className="bg-background hover:bg-muted/50 focus-visible:ring-ring/50 flex items-center gap-3 rounded-xl border p-4 transition-colors focus-visible:ring-3 focus-visible:outline-none"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{projectSummary(enquiry, form)}</span>
                      <StatusBadge status={enquiry.status} />
                    </div>
                    <span className="text-muted-foreground truncate text-sm">
                      {[
                        typeof location === 'string' ? location : 'No area given',
                        projectFollowUp(enquiry, form),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {outcome && <span className="text-sm font-medium">{outcome}</span>}
                    <EnquiryFlags
                      answers={enquiry.answers}
                      contactRequestedAt={enquiry.contact_requested_at}
                      addedAfterBookingAt={enquiry.added_after_booking_at}
                    />
                    <span className="text-muted-foreground text-xs">
                      <span className="font-mono">{enquiry.reference}</span> ·{' '}
                      <time dateTime={enquiry.submitted_at}>
                        {formatDateTime(enquiry.submitted_at)}
                      </time>
                    </span>
                  </div>
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
