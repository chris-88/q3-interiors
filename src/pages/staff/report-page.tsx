import { useState } from 'react'
import { useCampaignCosts } from '@/api/campaigns'
import { useFunnelReport } from '@/api/staff-booking'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { costRows, formatCost, formatEuroCents, type CostRow } from '@/lib/campaigns'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { PilotMeasures } from '@/components/staff/pilot-measures'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRate, stages, totals, type FunnelRow } from '@/lib/funnel'

const euro = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

/** YYYY-MM-DD in Irish time. */
function dublinDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(d)
}

function FunnelCard({ row, title, cost }: { row: FunnelRow; title: string; cost?: CostRow }) {
  return (
    <section aria-label={title} className="bg-background rounded-xl border p-4">
      <h2 className="font-medium">{title}</h2>
      <table className="mt-3 w-full text-sm tabular-nums">
        <caption className="sr-only">
          {title}: enquiries, booked, attended and won, with conversion rates
        </caption>
        <thead>
          <tr className="text-muted-foreground text-left">
            <th scope="col" className="py-1 font-normal">
              Stage
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Count
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              From previous
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Of enquiries
            </th>
          </tr>
        </thead>
        <tbody>
          {stages(row).map((s) => (
            <tr key={s.label} className="border-t">
              <th scope="row" className="py-2 text-left font-normal">
                {s.label}
              </th>
              <td className="py-2 text-right font-medium">{s.count}</td>
              <td className="py-2 text-right">
                {s.fromPrevious === null && s.label === 'Enquiries'
                  ? ''
                  : formatRate(s.fromPrevious)}
              </td>
              <td className="py-2 text-right">
                {s.label === 'Enquiries' ? '' : formatRate(s.fromStart)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Cancelled</dt>
          <dd className="tabular-nums">{row.cancelled}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">No-shows</dt>
          <dd className="tabular-nums">{row.no_shows}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Won value</dt>
          <dd className="tabular-nums">{euro.format(row.won_value)}</dd>
        </div>
      </dl>
      {cost && (
        <dl className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Spend in range</dt>
            <dd className="tabular-nums">
              {cost.spendCents === null ? 'No spend entered' : formatEuroCents(cost.spendCents)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Per enquiry</dt>
            <dd className="tabular-nums">
              {formatCost(cost.perEnquiry, cost.spendCents, cost.enquiries)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Per booked appointment</dt>
            <dd className="tabular-nums">
              {formatCost(cost.perBooked, cost.spendCents, cost.booked)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Per won job</dt>
            <dd className="tabular-nums">{formatCost(cost.perWon, cost.spendCents, cost.won)}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

export function ReportPage() {
  const [from, setFrom] = useState(() => dublinDate(-89))
  const [to, setTo] = useState(() => dublinDate(0))
  const report = useFunnelReport(from, to)
  // Spend is admin-only end to end; staff see the funnel without costs.
  const isAdmin = useCurrentStaff().role === 'admin'
  const costs = useCampaignCosts(from, to, isAdmin)
  const invalid = from === '' || to === '' || from > to
  const rows = report.data ? costRows(report.data, costs.data ?? []) : []

  return (
    <div className="flex flex-col gap-4">
      <ExceptionsBanner />
      <h1 className="text-section text-ink font-medium">Funnel report</h1>
      <p className="text-muted-foreground -mt-2 text-sm">
        Enquiries received in the date range (Irish dates), and what became of them. Booked means an
        appointment was confirmed, even if later cancelled.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="report-from">From</FieldLabel>
          <Input
            id="report-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 min-w-0 px-2 text-base"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="report-to">To</FieldLabel>
          <Input
            id="report-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 min-w-0 px-2 text-base"
          />
        </Field>
      </div>
      {invalid ? (
        <Alert variant="destructive">
          <AlertDescription>Choose a start date on or before the end date.</AlertDescription>
        </Alert>
      ) : report.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading report">
          <Skeleton className="h-48 w-full" />
        </div>
      ) : report.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load the report</AlertTitle>
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
      ) : rows.length === 0 ? (
        <p className="bg-background text-muted-foreground rounded-xl border p-6 text-center">
          No enquiries in this range yet. Numbers appear here as enquiries come in.
        </p>
      ) : (
        <>
          <FunnelCard row={totals(rows)} title="All campaigns" />
          <h2 className="text-muted-foreground mt-2 text-sm font-medium">By campaign</h2>
          {isAdmin && costs.isError && (
            <Alert variant="destructive">
              <AlertDescription>Could not load spend; costs are not shown.</AlertDescription>
            </Alert>
          )}
          {rows.map((row) => (
            <FunnelCard
              key={row.campaign}
              row={row}
              cost={isAdmin && costs.data && row.campaign !== '(unknown)' ? row : undefined}
              title={
                row.campaign === '(unknown)'
                  ? 'No campaign tag'
                  : row.name
                    ? `${row.name} (${row.campaign})`
                    : `${row.campaign} (tag, no campaign set up)`
              }
            />
          ))}
        </>
      )}
      {!invalid && <PilotMeasures from={from} to={to} />}
    </div>
  )
}
