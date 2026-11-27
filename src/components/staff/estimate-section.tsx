import { Link } from 'react-router'
import type { EnquiryDetail } from '@/api/enquiries'
import type { Estimate } from '@/api/estimates'
import type { StaffBooking } from '@/api/staff-booking'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  callHeldAt,
  currentEstimate,
  estimateFollowUp,
  estimateLine,
  estimateState,
  quoteOverdue,
} from '@/lib/enquiry-stage'
import { formatDayMonth, formatShortWhen } from '@/lib/format'
import { formatEuro, formatPercent } from '../../../supabase/functions/_shared/estimate.ts'

/** The site visits an estimate can hang off: confirmed visits, newest first. */
export function estimateVisits(bookings: StaffBooking[]): StaffBooking[] {
  return bookings
    .filter((b) => b.appointment_types.mode === 'on_site' && b.state === 'confirmed')
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
}

/** What a new estimate follows: the latest confirmed site visit, else a call that was held. */
export type EstimateSource = { after: 'visit' | 'call'; bookingId: string | null; line: string }

export function estimateSource(
  enquiry: EnquiryDetail,
  bookings: StaffBooking[],
  now: number,
): EstimateSource | null {
  const visit = estimateVisits(bookings)[0]
  if (visit)
    return {
      after: 'visit',
      bookingId: visit.id,
      line: `For the site visit on ${formatShortWhen(visit.starts_at)}.`,
    }
  const call = bookings
    .filter(
      (b) =>
        b.appointment_types.mode === 'phone' &&
        b.state === 'confirmed' &&
        b.attendance === 'attended',
    )
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0]
  const early = enquiry.call_held_at
  if (call && (!early || Date.parse(call.starts_at) >= Date.parse(early)))
    return {
      after: 'call',
      bookingId: call.id,
      line: `After the call on ${formatShortWhen(call.starts_at)}, no site visit.`,
    }
  if (early && callHeldAt(enquiry, now))
    return {
      after: 'call',
      bookingId: null,
      line: `After the call on ${formatDayMonth(early)}, no site visit.`,
    }
  return null
}

/** The current estimate's line, its follow-up and, under it, what it covered. */
export function EstimateSummary({ estimate, now }: { estimate: Estimate; now: number }) {
  const state = estimateState(estimate, now)
  const follow = estimateFollowUp(estimate, now)
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{estimateLine(estimate)}</p>
      {follow ? (
        <div>
          <Badge
            variant={state === 'quote_requested' ? 'default' : 'outline'}
            className={
              state === 'no_answer' || quoteOverdue(estimate, now)
                ? 'border-amber-400 bg-amber-50 text-amber-950'
                : ''
            }
          >
            {follow}
          </Badge>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Good until {formatDayMonth(estimate.valid_until)}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        {formatEuro(estimate.price_eur)}, plus or minus {formatPercent(estimate.plus_minus_percent)}
        %{estimate.created_by_name ? ` · ${estimate.created_by_name}` : ''}
      </p>
      {estimate.work_items.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {estimate.work_items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {estimate.work_looked_at && (
        <p className="text-sm break-words whitespace-pre-line">{estimate.work_looked_at}</p>
      )}
    </div>
  )
}

/** The Estimate section on an enquiry with a site visit: the current one, and the form. */
export function EstimateSection({
  enquiry,
  bookings,
  now,
  offeredAbove = false,
}: {
  enquiry: EnquiryDetail
  bookings: StaffBooking[]
  now: number
  /** Next step already offers "Write the estimate": no second button here. */
  offeredAbove?: boolean
}) {
  const visit = estimateSource(enquiry, bookings, now)
  const all = [...enquiry.estimates].sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))
  const current = currentEstimate(all)
  if (!visit && !current) return null
  const earlier = all.slice(1)
  return (
    <section
      id="estimate"
      aria-labelledby="estimate-heading"
      className="bg-background flex scroll-mt-4 flex-col gap-3 rounded-md border p-4"
    >
      <h2 id="estimate-heading" className="text-base font-medium">
        Estimate
      </h2>
      {current ? (
        <EstimateSummary estimate={current} now={now} />
      ) : (
        <p className="text-muted-foreground text-sm">No estimate sent yet.</p>
      )}
      {visit && !(offeredAbove && !current) && (
        // Folded sections never draw a filled button: the bar holds the one primary action.
        <Link
          to={`/enquiries/${enquiry.id}/estimate`}
          className={buttonVariants({
            variant: 'outline',
            className: 'h-12 w-full sm:w-auto sm:self-start sm:px-6',
          })}
        >
          {current ? 'Send an updated estimate' : 'Write the estimate'}
        </Link>
      )}
      {earlier.length > 0 && (
        <details>
          <summary className="text-muted-foreground flex min-h-12 cursor-pointer items-center text-sm">
            Earlier estimates ({earlier.length})
          </summary>
          <ul className="flex flex-col gap-2">
            {earlier.map((e) => (
              <li key={e.id} className="text-sm">
                {estimateLine(e)}
                {e.quote_requested_at
                  ? ` · Quote requested ${formatDayMonth(e.quote_requested_at)}`
                  : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
