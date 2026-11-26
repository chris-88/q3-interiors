import { useId, useState } from 'react'
import { usePilotReport, usePilotReportByContent } from '@/api/pilot'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRate } from '@/lib/funnel'
import { formatEuro } from '@/lib/outcome'
import {
  countedFromDate,
  formatDuration,
  formatPer100,
  per100,
  rowLabel,
  rowsFor,
  sessionsFor,
  share,
  type PilotReport,
  type PilotRow,
} from '@/lib/pilot'

/*
 * The pilot measures (enquiry form v2, part C): landing sessions counted first-party, what came
 * of them, and the brief's two headline measures. Sessions exist only from the day counting
 * began, so earlier periods and form v1 say "not counted" rather than zero.
 */

const longDate = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Dublin',
})

function Measure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-background flex flex-col gap-1 rounded-xl border p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-muted-foreground text-xs">{note}</dd>
    </div>
  )
}

function RowCard({
  row,
  report,
  to,
  children,
}: {
  row: PilotRow
  report: PilotReport
  to: string
  children?: React.ReactNode
}) {
  const sessions = sessionsFor(row, report, to)
  const line = (label: string, value: number) => (
    <tr className="border-t">
      <th scope="row" className="py-1.5 text-left font-normal">
        {label}
      </th>
      <td className="py-1.5 text-right font-medium">{value}</td>
      <td className="py-1.5 text-right">{formatPer100(per100(value, sessions), sessions)}</td>
    </tr>
  )
  return (
    <section aria-label={rowLabel(row)} className="bg-background rounded-xl border p-4">
      <h4 className="font-medium">{rowLabel(row)}</h4>
      <table className="mt-2 w-full text-sm tabular-nums">
        <caption className="sr-only">{rowLabel(row)}: counts and per 100 landing sessions</caption>
        <thead>
          <tr className="text-muted-foreground text-left">
            <th scope="col" className="py-1 font-normal">
              Measure
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Count
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-normal">
              Per 100 sessions
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t">
            <th scope="row" className="py-1.5 text-left font-normal">
              Landing sessions
            </th>
            <td className="py-1.5 text-right font-medium">
              {sessions === null ? 'not counted' : sessions}
            </td>
            <td className="py-1.5 text-right">–</td>
          </tr>
          {line('Saved enquiries', row.saved)}
          {line('Confirmed bookings', row.booked)}
          {line('Attended appointments', row.attended)}
          {line('Suitable and attended', row.suitable_attended)}
          {line('Quoted', row.quoted)}
          {line('Won', row.won)}
        </tbody>
      </table>
      <dl className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Landing to saved (median)</dt>
          <dd className="tabular-nums">{formatDuration(row.median_to_saved_seconds)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Landing to booked (median)</dt>
          <dd className="tabular-nums">{formatDuration(row.median_to_booked_seconds)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Won value (incl. VAT)</dt>
          <dd className="tabular-nums">{formatEuro(row.won_value)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bookings that needed chasing</dt>
          <dd className="tabular-nums">
            {row.chased} of {row.booked} ({formatRate(share(row.chased, row.booked))})
          </dd>
        </div>
      </dl>
      {children}
    </section>
  )
}

/** A campaign's ads: opened on demand, one card per utm_content (capped on the server). */
function ByAd({
  campaign,
  report,
  from,
  to,
}: {
  campaign: string
  report: PilotReport
  from: string
  to: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ads = usePilotReportByContent(from, to, campaign, open)
  return (
    <div className="mt-3 border-t pt-3">
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-base"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide each ad' : 'Show each ad'}
      </Button>
      {open && (
        <div id={id} className="mt-3 flex flex-col gap-3">
          {ads.isPending ? (
            <Skeleton className="h-32 w-full" aria-label="Loading the ads" />
          ) : ads.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                Could not load the ads.{' '}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => void ads.refetch()}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : ads.data.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No sessions or enquiries for this campaign.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                One card per ad (the link&apos;s utm_content). The {ads.data.cap} biggest have their
                own card; any others are added together.
              </p>
              {ads.data.rows.map((row) => (
                <RowCard key={`content:${row.key}`} row={row} report={report} to={to} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function PilotMeasures({ from, to }: { from: string; to: string }) {
  const report = usePilotReport(from, to)
  if (report.isPending)
    return (
      <div aria-busy="true" aria-label="Loading pilot measures">
        <Skeleton className="h-48 w-full" />
      </div>
    )
  if (report.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load the pilot measures</AlertTitle>
        <AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void report.refetch()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  const data = report.data
  const all = rowsFor(data, 'all')[0]
  const counted = countedFromDate(data)
  const instagramSessions = to < counted ? null : data.headline.instagram_sessions
  return (
    <section aria-labelledby="pilot-heading" className="flex flex-col gap-3">
      <h2 id="pilot-heading" className="text-title text-ink mt-4 font-medium">
        Pilot measures
      </h2>
      <p className="text-muted-foreground text-sm">
        Landing sessions are counted on this site from{' '}
        {longDate.format(new Date(data.counted_from))}
        {from < counted ? '; days before that show “not counted”' : ''}. Form v1 enquiries have no
        sessions. A session is one browser tab arriving on the landing page or the form; no personal
        details or cookies.
      </p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Measure
          label="Suitable, attended appointments per 100 Instagram landing sessions"
          value={formatPer100(
            per100(data.headline.instagram_suitable_attended, instagramSessions),
            instagramSessions,
          )}
          note={`${data.headline.instagram_suitable_attended} from ${instagramSessions ?? 'not counted'} sessions. Suitable: the appointment was attended and the enquiry is not marked unsuitable. Instagram: the link was tagged utm_source=instagram (or ig).`}
        />
        <Measure
          label="Bookings that needed chasing for details"
          value={all ? formatRate(share(all.chased, all.booked)) : '–'}
          note={`${all?.chased ?? 0} of ${all?.booked ?? 0} confirmed bookings were flagged “Had to chase details”.`}
        />
      </dl>
      {data.rows.length === 0 ? (
        <p className="bg-background text-muted-foreground rounded-xl border p-6 text-center">
          Nothing in this range yet.
        </p>
      ) : (
        <>
          {all && <RowCard row={all} report={data} to={to} />}
          {(['version', 'route', 'campaign'] as const).map((dim) => {
            const rows = rowsFor(data, dim)
            if (rows.length === 0) return null
            return (
              <div key={dim} className="flex flex-col gap-3">
                <h3 className="text-muted-foreground mt-2 text-sm font-medium">
                  {dim === 'version'
                    ? 'By form version'
                    : dim === 'route'
                      ? 'By route'
                      : 'By campaign'}
                </h3>
                {rows.map((row) => (
                  <RowCard key={`${row.dim}:${row.key}`} row={row} report={data} to={to}>
                    {dim === 'campaign' && (
                      <ByAd campaign={row.key} report={data} from={from} to={to} />
                    )}
                  </RowCard>
                ))}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
