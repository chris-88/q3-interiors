import { useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { useEnquiries, useFormVersions, type EnquirySummary } from '@/api/enquiries'
import { Chips } from '@/components/staff/chips'
import {
  enquiryName,
  projectLine,
  storeFilter,
  storeSearch,
  storedFilter,
  storedSearch,
} from '@/components/staff/enquiry-text'
import { useLoadedAt } from '@/components/staff/use-loaded-at'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { StageBadge } from '@/components/staff/stage-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ENQUIRY_FILTERS,
  NEEDS_ACTION,
  filterCounts,
  stageLine,
  visibleEnquiries,
  type EnquiryFilter,
  type Staged,
} from '@/lib/enquiry-stage'
import { formatDateTime, shortAge } from '@/lib/format'
import type { FormDefinition } from '@/forms/types'

function EnquiryRow({
  enquiry,
  form,
  now,
  marked,
}: {
  enquiry: Staged<EnquirySummary>
  form: FormDefinition | undefined
  now: number
  marked: boolean
}) {
  const line = stageLine(enquiry, enquiry.stage, now)
  return (
    <li>
      <Link
        to={`/enquiries/${enquiry.id}`}
        className="bg-background hover:bg-muted/50 flex min-h-12 gap-3 rounded-md border p-3 transition-colors"
      >
        <span
          className={`mt-1.5 size-2 shrink-0 rounded-full ${marked ? 'bg-action' : 'bg-transparent'}`}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-base font-medium">{enquiryName(enquiry)}</span>
            <time
              dateTime={enquiry.submitted_at}
              title={formatDateTime(enquiry.submitted_at)}
              className="text-muted-foreground shrink-0 text-xs tabular-nums"
            >
              <span className="sr-only">Received </span>
              {shortAge(enquiry.submitted_at, now)}
              <span className="sr-only"> ago</span>
            </time>
          </span>
          <span className="text-muted-foreground truncate text-sm">
            {projectLine(enquiry, form)}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm">
              {marked && <span className="sr-only">Needs action: </span>}
              {line}
              {enquiry.added_after_booking_at && (
                <span className="text-muted-foreground"> · Added after booking</span>
              )}
            </span>
            <StageBadge stage={enquiry.stage} />
          </span>
        </span>
      </Link>
    </li>
  )
}

export function EnquiryListPage() {
  const location = useLocation()
  const deleted = (location.state as { deleted?: string } | null)?.deleted ?? null
  const enquiries = useEnquiries()
  const forms = useFormVersions()
  const [filter, setFilter] = useState<EnquiryFilter>(storedFilter)
  const [query, setQuery] = useState(storedSearch)
  // Ages and "upcoming" are judged against the moment the list was loaded.
  const now = useLoadedAt(enquiries.dataUpdatedAt)
  const all = enquiries.data ?? []
  const shown = visibleEnquiries(all, filter, query, now)
  const counts = filterCounts(all, query, now)
  const filterLabel = ENQUIRY_FILTERS.find(([k]) => k === filter)?.[1] ?? ''
  const refreshing = enquiries.isFetching && !enquiries.isPending

  return (
    <div className="flex flex-col gap-3">
      <ExceptionsBanner />
      {deleted && (
        <Alert>
          <AlertDescription>
            {deleted} was deleted. A note of the deletion (reference, time, who) is kept.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-section text-ink font-medium">Enquiries</h1>
        <Button
          variant="ghost"
          size="icon"
          className="size-12"
          aria-label={refreshing ? 'Refreshing' : 'Refresh'}
          onClick={() => void enquiries.refetch()}
          disabled={enquiries.isFetching}
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </Button>
      </div>

      <div className="relative">
        <label htmlFor="enquiry-search" className="sr-only">
          Search enquiries
        </label>
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id="enquiry-search"
          type="search"
          autoComplete="off"
          placeholder="Name, phone, email, town or reference"
          className="h-12 ps-9 text-base md:text-base"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            storeSearch(e.target.value)
          }}
        />
      </div>

      <Chips
        name="enquiry-filter"
        legend="Show"
        options={ENQUIRY_FILTERS}
        value={filter}
        counts={enquiries.data ? counts : undefined}
        onChange={(next) => {
          setFilter(next)
          storeFilter(next)
        }}
      />

      {enquiries.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading enquiries">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : enquiries.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not load enquiries</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              className="mt-2 h-12"
              onClick={() => void enquiries.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : all.length === 0 ? (
        <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
          No enquiries yet. New ones appear here as soon as they are sent.
        </p>
      ) : shown.length === 0 ? (
        <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
          {query.trim()
            ? `Nothing under “${filterLabel}” matches “${query.trim()}”.`
            : `Nothing under “${filterLabel}”.`}
        </p>
      ) : (
        <ul aria-label="Enquiries" className="flex flex-col gap-2">
          {shown.map((enquiry) => (
            <EnquiryRow
              key={enquiry.id}
              enquiry={enquiry}
              form={forms.data?.get(`${enquiry.form_id}@${enquiry.form_version}`)}
              now={now}
              marked={filter === 'open' && NEEDS_ACTION.has(enquiry.stage.key)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
