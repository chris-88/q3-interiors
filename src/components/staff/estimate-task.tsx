// "Write the estimate" as its own screen (review P5, `#/enquiries/:id/estimate`): step 1 the form
// (price, plus or minus as chips, the tick-list, a note, the live range on one line), step 2
// "Check and send" with the exact email and one button that names the person. The draft is kept
// on this device until it is sent.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useBusinessDetails } from '@/api/business'
import type { EnquiryDetail } from '@/api/enquiries'
import {
  estimateFormSchema,
  offeredItems,
  parsePrice,
  useSendEstimate,
  useWorkItems,
} from '@/api/estimates'
import { useWordingOverrides } from '@/api/wording'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { DocumentViewer } from '@/components/staff/document-viewer'
import type { EstimateSource } from '@/components/staff/estimate-section'
import { TaskFrame } from '@/components/staff/task-frame'
import { orderTicked, WorkItemsPicker } from '@/components/staff/work-items-picker'
import { enquiryName } from '@/components/staff/enquiry-text'
import { currentEstimate } from '@/lib/enquiry-stage'
import {
  clearDraft,
  draftHasContent,
  estimateDraftSchema,
  readDraft,
  writeDraft,
  type EstimateDraft,
} from '@/lib/task-draft'
import {
  estimateRange,
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

/** The plus-or-minus chips; any other allowed value is under "Other". */
export const PERCENT_CHIPS = [5, 10, 15, 20]

const textOf = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function sendError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('no email address')) return 'This enquiry has no email address to send to.'
  if (message.includes('site visits only')) return 'Estimates go with a site visit, not a call.'
  if (message.includes('call not held')) return 'The call is not recorded as held yet.'
  if (message.includes('not confirmed')) return 'The site visit is not confirmed.'
  if (message.includes('not allowed')) return 'Your account cannot send estimates.'
  return 'The estimate was not sent. Try again.'
}

const START: EstimateDraft = { price: '', percent: String(PERCENT_DEFAULT), work: '', ticked: [] }

export function EstimateTask({
  enquiry,
  source,
}: {
  enquiry: EnquiryDetail
  source: EstimateSource
}) {
  const navigate = useNavigate()
  const wording = useWordingOverrides()
  const business = useBusinessDetails()
  const send = useSendEstimate(enquiry.id)
  const workItems = useWorkItems()
  const current = currentEstimate(enquiry.estimates)
  const base = (current as { id?: string } | null)?.id ?? null
  const [values, setValues] = useState<EstimateDraft>(
    () => readDraft('estimate', enquiry.id, base, estimateDraftSchema) ?? START,
  )
  const [step, setStep] = useState<1 | 2>(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [other, setOther] = useState(() => !PERCENT_CHIPS.includes(Number(values.percent)))
  const { price, percent, work, ticked } = values
  const email = textOf(enquiry.answers.email)
  const name = textOf(enquiry.answers.name)
  const first = name.split(/\s+/)[0] || 'them'
  const projectType = textOf(enquiry.answers.project_type) || null
  const items = orderTicked(offeredItems(workItems.data ?? [], projectType), ticked)
  const kept = draftHasContent(values, START)

  // Kept on this device as it is typed, until it is sent.
  useEffect(() => {
    if (kept) writeDraft('estimate', enquiry.id, base, values)
    else clearDraft('estimate', enquiry.id)
  }, [kept, values, enquiry.id, base])
  // Step 1 starts in the price.
  useEffect(() => {
    if (step === 1) document.getElementById('estimate-price')?.focus()
  }, [step])

  const set = (patch: Partial<EstimateDraft>, clear: string[] = []) => {
    setValues((v) => ({ ...v, ...patch }))
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k))))
  }

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
    workItems: items,
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
        const k = String(issue.path[0] ?? 'form')
        next[k] ??= issue.message
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

  const submitSend = () => {
    const checked = check()
    if (!checked) return setStep(1)
    send.mutate(
      {
        bookingId: source.bookingId,
        price: checked.price,
        percent: checked.percent,
        work: checked.work,
        items: checked.items,
      },
      {
        onSuccess: () => {
          clearDraft('estimate', enquiry.id)
          navigate(`/enquiries/${enquiry.id}`, {
            replace: true,
            state: { notice: `Estimate sent to ${email}. The email goes within a minute.` },
          })
        },
      },
    )
  }

  const title = current ? 'Send an updated estimate' : 'Write the estimate'
  const field = 'flex flex-col gap-1'
  const chip =
    'border-edge has-checked:border-action has-checked:bg-action flex min-h-12 min-w-16 cursor-pointer items-center justify-center rounded-full border px-4 text-base has-checked:text-white has-focus-visible:outline-3 has-focus-visible:outline-offset-3'

  if (step === 2 && range)
    return (
      <TaskFrame
        enquiryId={enquiry.id}
        name={enquiryName(enquiry)}
        title="Check and send"
        step={{ at: 2, of: 2, label: 'the email' }}
        about={`${formatRange(range.low, range.high)}, VAT included. This is the email exactly as ${first} gets it.`}
        saved={kept}
        bar={
          <>
            <Button
              className="h-12 flex-1"
              disabled={send.isPending || !email}
              onClick={submitSend}
            >
              {send.isPending ? 'Sending…' : `Send to ${first}`}
            </Button>
            <Button variant="outline" className="h-12 px-5" onClick={() => setStep(1)}>
              Edit
            </Button>
          </>
        }
      >
        <DocumentViewer
          title="Estimate email"
          html={preview.html}
          lines={[`To: ${email || 'no email address'}`, `Subject: ${preview.subject}`]}
        />
        <p className="text-muted-foreground text-sm">
          It goes within a minute and cannot be called back; an updated estimate can follow.
        </p>
        {send.isError && (
          <p role="alert" className="text-destructive text-sm">
            {sendError(send.error)}
          </p>
        )}
      </TaskFrame>
    )

  return (
    <TaskFrame
      enquiryId={enquiry.id}
      name={enquiryName(enquiry)}
      title={title}
      step={{ at: 1, of: 2, label: 'the estimate' }}
      about={`${source.line} All figures include VAT.`}
      saved={kept}
      bar={
        <Button type="submit" form="estimate-form" className="h-12 flex-1" disabled={!email}>
          Check and send
        </Button>
      }
    >
      <form
        id="estimate-form"
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (check()) setStep(2)
        }}
      >
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
            onChange={(e) => set({ price: e.target.value }, ['price'])}
            aria-invalid={errors.price ? true : undefined}
            aria-describedby={errors.price ? 'estimate-price-error' : undefined}
          />
          {errors.price && (
            <p id="estimate-price-error" role="alert" className="text-destructive text-sm">
              {errors.price}
            </p>
          )}
        </div>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Plus or minus</legend>
          <div className="flex flex-wrap gap-2">
            {PERCENT_CHIPS.map((o) => (
              <label key={o} className={chip}>
                <input
                  type="radio"
                  name="estimate-percent"
                  className="sr-only"
                  checked={!other && Number(percent) === o}
                  onChange={() => {
                    setOther(false)
                    set({ percent: String(o) })
                  }}
                />
                {formatPercent(o)}%
              </label>
            ))}
            <label className={chip}>
              <input
                type="radio"
                name="estimate-percent"
                className="sr-only"
                checked={other}
                onChange={() => setOther(true)}
              />
              Other
            </label>
          </div>
          {other && (
            <div className={field}>
              <label htmlFor="estimate-percent" className="text-sm">
                Other plus or minus
              </label>
              <NativeSelect
                id="estimate-percent"
                className="w-full sm:w-40 [&_select]:h-12 [&_select]:text-base"
                value={percent}
                onChange={(e) => set({ percent: e.target.value })}
              >
                {PERCENT_OPTIONS.map((o) => (
                  <NativeSelectOption key={o} value={String(o)}>
                    {formatPercent(o)}%
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
        </fieldset>
        <div id="estimate-items" tabIndex={-1} className="flex flex-col gap-1">
          <WorkItemsPicker
            projectType={projectType}
            after={source.after}
            ticked={ticked}
            invalid={Boolean(errors.items)}
            onChange={(next) => set({ ticked: next }, ['items'])}
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
            onChange={(e) => set({ work: e.target.value }, ['work', 'items'])}
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
        <p className="text-base" aria-live="polite">
          <span className="text-muted-foreground">They see </span>
          <span className="text-ink font-bold tabular-nums">
            {range
              ? `${formatRange(range.low, range.high)}, VAT included`
              : 'a range once you enter a price'}
          </span>
        </p>
        {!email && (
          <p role="alert" className="text-destructive text-sm">
            This enquiry has no email address, so the estimate cannot be sent.
          </p>
        )}
      </form>
    </TaskFrame>
  )
}
