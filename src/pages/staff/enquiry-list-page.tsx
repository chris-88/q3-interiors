import { useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useEnquiries, useFormVersions, type EnquirySummary } from '@/api/enquiries'
import {
  enquiryName,
  projectType,
  storeSearch,
  storedSearch,
} from '@/components/staff/enquiry-text'
import { DueChip } from '@/components/staff/due-chip'
import { draftOf } from '@/lib/task-draft'
import { useLoadedAt } from '@/components/staff/use-loaded-at'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { GROUP_LABELS, groupStages, type StageView } from '@/lib/enquiry-stage'
import type { FormDefinition } from '@/forms/types'

type Row = EnquirySummary & { view: StageView }

const GROUP_HINTS = {
  your_move: 'overdue first',
  diary: 'next first',
  waiting: 'soonest good-until first',
} as const

/** Two lines: the name and the due chip; what has happened and the job. Nothing that matters is cut. */
function EnquiryRow({ enquiry, form }: { enquiry: Row; form: FormDefinition | undefined }) {
  const { view } = enquiry
  const job = projectType(enquiry, form)
  return (
    <li>
      <Link
        to={`/enquiries/${enquiry.id}`}
        className="hover:bg-soft flex min-h-16 flex-col justify-center gap-0.5 border-t px-1 py-2.5 transition-colors"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-base leading-snug font-medium break-words">
            {enquiryName(enquiry)}
          </span>
          {view.chip && <DueChip view={view} />}
        </span>
        <span className="text-muted-foreground flex items-start justify-between gap-2 text-sm">
          <span className="min-w-0 break-words">
            {/* An estimate or quote started on this device and not sent yet. */}
            {draftOf(enquiry, view) && <span className="text-ink font-medium">Draft · </span>}
            {view.news}
            {enquiry.added_after_booking_at && ' · added after booking'}
          </span>
          {job && <span className="shrink-0">{job}</span>}
        </span>
      </Link>
    </li>
  )
}

function Group({
  id,
  title,
  hint,
  rows,
  forms,
  empty,
}: {
  id: string
  title: string
  hint?: string
  rows: Row[]
  forms: Map<string, FormDefinition> | undefined
  empty: string
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h2
        id={id}
        className="text-muted-foreground flex items-baseline justify-between gap-2 px-1 pb-1.5 text-sm font-medium"
      >
        <span>
          {title} · {rows.length}
        </span>
        {hint && rows.length > 1 && <span className="text-xs font-normal">{hint}</span>}
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground border-t px-1 py-3 text-sm">{empty}</p>
      ) : (
        <ul aria-labelledby={id} className="border-b">
          {rows.map((e) => (
            <EnquiryRow
              key={e.id}
              enquiry={e}
              form={forms?.get(`${e.form_id}@${e.form_version}`)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The customers list, grouped by whose move it is: Your move, In the diary, Waiting on them. Won,
 * lost and closed are behind "Finished" (`?show=finished`).
 */
export function EnquiryListPage() {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const finished = params.get('show') === 'finished'
  const deleted = (location.state as { deleted?: string } | null)?.deleted ?? null
  const enquiries = useEnquiries()
  const forms = useFormVersions()
  const [query, setQuery] = useState(storedSearch)
  // Due dates and "upcoming" are judged against the moment the list was loaded.
  const now = useLoadedAt(enquiries.dataUpdatedAt)
  const all = enquiries.data ?? []
  const groups = groupStages(all, query, now)
  const open = groups.your_move.length + groups.diary.length + groups.waiting.length
  const refreshing = enquiries.isFetching && !enquiries.isPending
  const searching = query.trim() !== ''

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
        <h1 className="text-section text-ink font-medium">{finished ? 'Finished' : 'Enquiries'}</h1>
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

      {enquiries.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading enquiries">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
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
      ) : finished ? (
        <section aria-label="Enquiries" className="flex flex-col gap-3">
          <Group
            id="group-finished"
            title="Won, lost and closed"
            rows={groups.finished}
            forms={forms.data}
            empty={
              searching ? `Nothing finished matches “${query.trim()}”.` : 'Nothing finished yet.'
            }
          />
          <Link
            to="/"
            onClick={() => setParams({})}
            className="inline-flex min-h-12 items-center self-start px-1 underline underline-offset-4"
          >
            Back to open enquiries
          </Link>
        </section>
      ) : (
        <>
          <section aria-label="Enquiries" className="flex flex-col gap-4">
            {searching && open === 0 && (
              <p className="text-muted-foreground px-1 text-sm">
                No open enquiry matches “{query.trim()}”.
                {groups.finished.length > 0 &&
                  ` ${groups.finished.length} finished ${groups.finished.length === 1 ? 'one does' : 'ones do'}.`}
              </p>
            )}
            {(['your_move', 'diary', 'waiting'] as const).map((g) => (
              <Group
                key={g}
                id={`group-${g}`}
                title={GROUP_LABELS[g]}
                hint={GROUP_HINTS[g]}
                rows={groups[g]}
                forms={forms.data}
                empty={
                  g === 'your_move'
                    ? 'Nothing for you to do.'
                    : g === 'diary'
                      ? 'Nothing booked.'
                      : 'Nobody to wait on.'
                }
              />
            ))}
          </section>
          <Link
            to="/?show=finished"
            className="inline-flex min-h-12 items-center self-start px-1 underline underline-offset-4"
          >
            Finished ({groups.finished.length})
          </Link>
        </>
      )}
    </div>
  )
}
