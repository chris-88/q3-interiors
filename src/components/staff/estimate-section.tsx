import { useEffect, useState } from 'react'
import { useBusinessDetails } from '@/api/business'
import type { EnquiryDetail } from '@/api/enquiries'
import {
  estimateFormSchema,
  offeredItems,
  parsePrice,
  useSendEstimate,
  useWorkItems,
  type Estimate,
} from '@/api/estimates'
import type { StaffBooking } from '@/api/staff-booking'
import { useWordingOverrides } from '@/api/wording'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { WRITE_ESTIMATE_EVENT } from '@/components/staff/after-call'
import { orderTicked, WorkItemsPicker } from '@/components/staff/work-items-picker'
import {
  callHeldAt,
  currentEstimate,
  estimateFollowUp,
  estimateLine,
  estimateState,
  quoteOverdue,
} from '@/lib/enquiry-stage'
import { formatDayMonth, formatShortWhen } from '@/lib/format'
import {
  estimateRange,
  formatEuro,
  formatPercent,
  formatRange,
  isValidPercent,
  PERCENT_DEFAULT,
  PERCENT_OPTIONS,
  PRICE_MAX,
  PRICE_MIN,
  WORK_MAX,
} from '../../../supabase/functions/_shared/estimate.ts'
import { renderEstimate, WORDING } from '../../../supabase/functions/_shared/messages.ts'
import { SITE_URL } from '../../../supabase/functions/_shared/site.ts'

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

const textOf = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

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

function sendError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('no email address')) return 'This enquiry has no email address to send to.'
  if (message.includes('site visits only')) return 'Estimates go with a site visit, not a call.'
  if (message.includes('call not held')) return 'The call is not recorded as held yet.'
  if (message.includes('not confirmed')) return 'The site visit is not confirmed.'
  if (message.includes('not allowed')) return 'Your account cannot send estimates.'
  return 'The estimate was not sent. Try again.'
}

function EstimateForm({
  enquiry,
  source,
  onSent,
  onCancel,
}: {
  enquiry: EnquiryDetail
  source: EstimateSource
  onSent: (to: string) => void
  onCancel: () => void
}) {
  const wording = useWordingOverrides()
  const business = useBusinessDetails()
  const send = useSendEstimate(enquiry.id)
  const [price, setPrice] = useState('')
  const [percent, setPercent] = useState(String(PERCENT_DEFAULT))
  const [work, setWork] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  const workItems = useWorkItems()
  // The enquiry's project type value ("kitchen"); "any job" items are offered with it.
  const projectType =
    typeof enquiry.answers.project_type === 'string' && enquiry.answers.project_type
      ? enquiry.answers.project_type
      : null
  const items = orderTicked(offeredItems(workItems.data ?? [], projectType), ticked)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const email = textOf(enquiry.answers.email)
  const name = textOf(enquiry.answers.name)

  const n = parsePrice(price)
  const p = Number(percent)
  const range =
    n !== null && n >= PRICE_MIN && n <= PRICE_MAX && isValidPercent(p) ? estimateRange(n, p) : null
  const caveats =
    source.after === 'call'
      ? wording.data?.estimate_call_caveats?.trim() || WORDING.estimate_call_caveats.default
      : wording.data?.estimate_caveats?.trim() || WORDING.estimate_caveats.default
  const preview = renderEstimate({
    customerName: name,
    workItems: items.length || work.trim() ? items : ['The work you tick appears here'],
    note: work.trim() || null,
    low: range?.low ?? 0,
    high: range?.high ?? 0,
    caveats,
    quoteUrl: `${SITE_URL}/#/estimate/preview`,
    businessPhone: business.data?.contact_phone ?? null,
    privacyUrl: `${SITE_URL}/#/privacy`,
    siteUrl: SITE_URL,
    after: source.after,
  })

  const check = () => {
    const parsed = estimateFormSchema.safeParse({ price, percent, work })
    const next: Record<string, string> = {}
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        next[key] ??= issue.message
      }
    // An estimate needs at least one ticked item or a note (send_estimate checks the same).
    if (items.length === 0 && !work.trim())
      next.items = 'Tick what you looked at, or write a note under Anything else.'
    if (parsed.success && Object.keys(next).length === 0) {
      setErrors({})
      return { ...parsed.data, items }
    }
    setErrors(next)
    document.getElementById(`estimate-${Object.keys(next)[0] ?? 'price'}`)?.focus()
    return null
  }

  const field = 'flex flex-col gap-1'
  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (check()) setConfirming(true)
      }}
    >
      <p className="text-muted-foreground text-sm">{source.line} All figures include VAT.</p>
      <div className={field}>
        <label htmlFor="estimate-price" className="text-sm font-medium">
          Price in euro
        </label>
        <Input
          id="estimate-price"
          inputMode="numeric"
          autoComplete="off"
          className="h-12 text-base"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value)
            setConfirming(false)
            setErrors(({ price: _p, ...rest }) => rest)
          }}
          aria-invalid={errors.price ? true : undefined}
          aria-describedby={errors.price ? 'estimate-price-error' : undefined}
        />
        {errors.price && (
          <p id="estimate-price-error" role="alert" className="text-destructive text-sm">
            {errors.price}
          </p>
        )}
      </div>
      <div className={field}>
        <label htmlFor="estimate-percent" className="text-sm font-medium">
          Plus or minus
        </label>
        <NativeSelect
          id="estimate-percent"
          className="w-full sm:w-40 [&_select]:h-12 [&_select]:text-base"
          value={percent}
          onChange={(e) => {
            setPercent(e.target.value)
            setConfirming(false)
          }}
        >
          {PERCENT_OPTIONS.map((o) => (
            <NativeSelectOption key={o} value={String(o)}>
              {formatPercent(o)}%
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div id="estimate-items" tabIndex={-1} className="flex flex-col gap-1">
        <WorkItemsPicker
          projectType={projectType}
          after={source.after}
          ticked={ticked}
          invalid={Boolean(errors.items)}
          onChange={(next) => {
            setTicked(next)
            setConfirming(false)
            setErrors(({ items: _i, ...rest }) => rest)
          }}
        />
        {errors.items && (
          <p role="alert" className="text-destructive text-sm">
            {errors.items}
          </p>
        )}
      </div>
      <div className={field}>
        <label htmlFor="estimate-work" className="text-sm font-medium">
          Anything else (optional)
        </label>
        <Textarea
          id="estimate-work"
          rows={3}
          maxLength={WORK_MAX + 50}
          className="text-base md:text-base"
          value={work}
          onChange={(e) => {
            setWork(e.target.value)
            setConfirming(false)
            setErrors(({ work: _w, items: _i, ...rest }) => rest)
          }}
          aria-invalid={errors.work ? true : undefined}
          aria-describedby={`estimate-work-hint${errors.work ? ' estimate-work-error' : ''}`}
        />
        <p id="estimate-work-hint" className="text-muted-foreground text-xs">
          A line under the list in the email. {[...work.trim()].length}/{WORK_MAX}
        </p>
        {errors.work && (
          <p id="estimate-work-error" role="alert" className="text-destructive text-sm">
            {errors.work}
          </p>
        )}
      </div>

      <div className="bg-soft rounded-md p-3" aria-live="polite">
        <p className="text-muted-foreground text-xs">The customer sees</p>
        <p className="text-title text-ink font-bold tabular-nums">
          {range ? `${formatRange(range.low, range.high)}, VAT included` : 'Enter a price'}
        </p>
      </div>

      <details className="group" open>
        <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium">
          The email
        </summary>
        <p className="text-muted-foreground mb-2 text-xs">
          Subject: {preview.subject}. To: {email || 'no email address'}.
        </p>
        <iframe
          title="Estimate email preview"
          sandbox=""
          srcDoc={preview.html}
          className="h-[36rem] w-full rounded-md border bg-white"
        />
      </details>

      {!email && (
        <p role="alert" className="text-destructive text-sm">
          This enquiry has no email address, so the estimate cannot be sent.
        </p>
      )}
      {confirming && range ? (
        <div
          role="alertdialog"
          aria-labelledby="estimate-confirm"
          className="rounded-md border p-3"
        >
          <p id="estimate-confirm" className="font-medium">
            Send {formatRange(range.low, range.high)} to {email}?
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            The email goes within a minute. It cannot be called back; an updated estimate can
            follow.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="h-12 sm:px-6"
              disabled={send.isPending}
              onClick={() => {
                const values = check()
                if (!values) return setConfirming(false)
                send.mutate(
                  {
                    bookingId: source.bookingId,
                    price: values.price,
                    percent: values.percent,
                    work: values.work,
                    items: values.items,
                  },
                  { onSuccess: () => onSent(email) },
                )
              }}
            >
              {send.isPending ? 'Sending…' : 'Yes, send it'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 sm:px-6"
              onClick={() => setConfirming(false)}
            >
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="h-12 sm:px-6" disabled={!email}>
            Send estimate
          </Button>
          <Button type="button" variant="ghost" className="h-12" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {send.isError && (
        <p role="alert" className="text-destructive text-sm">
          {sendError(send.error)}
        </p>
      )}
    </form>
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
  const [open, setOpen] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const visit = estimateSource(enquiry, bookings, now)
  // The Next step's "Write the estimate" opens the form here.
  useEffect(() => {
    const show = () => {
      setOpen(true)
      setSentTo(null)
      window.requestAnimationFrame(() =>
        document.getElementById('estimate')?.scrollIntoView({ behavior: 'smooth' }),
      )
    }
    window.addEventListener(WRITE_ESTIMATE_EVENT, show)
    return () => window.removeEventListener(WRITE_ESTIMATE_EVENT, show)
  }, [])
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
      <output className="block text-sm">
        {sentTo ? `Estimate sent to ${sentTo}. The email goes within a minute.` : ''}
      </output>
      {visit && !open && !(offeredAbove && !current) && (
        <Button
          variant={current ? 'outline' : 'default'}
          className="h-12 w-full sm:w-auto sm:self-start sm:px-6"
          onClick={() => {
            setOpen(true)
            setSentTo(null)
          }}
        >
          {current ? 'Send an updated estimate' : 'Write the estimate'}
        </Button>
      )}
      {visit && open && (
        <EstimateForm
          enquiry={enquiry}
          source={visit}
          onCancel={() => setOpen(false)}
          onSent={(to) => {
            setOpen(false)
            setSentTo(to)
          }}
        />
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
