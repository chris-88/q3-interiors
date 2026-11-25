import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { useEnquiries, useFormVersions, type EnquirySummary } from '@/api/enquiries'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { StatusBadge } from '@/components/staff/status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { findField, formatAnswer } from '@/forms/logic'
import type { FormDefinition } from '@/forms/types'
import { formatDateTime } from '@/lib/format'

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

export function EnquiryListPage() {
  const location = useLocation()
  const deleted = (location.state as { deleted?: string } | null)?.deleted ?? null
  const enquiries = useEnquiries()
  const forms = useFormVersions()

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
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {enquiries.data.map((enquiry) => {
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
                      {typeof location === 'string' ? location : 'No area given'}
                    </span>
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
