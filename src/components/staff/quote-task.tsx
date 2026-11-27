// "Write the quote" as its own screen (review P5, `#/enquiries/:id/quote`): step 1 the form (price,
// what is and is not included, a note, the deposit), step 2 "Check and send" with the document
// exactly as it goes out and one button that names the person. The draft is kept on this device
// until it is sent.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useBusinessDetails } from '@/api/business'
import type { EnquiryDetail } from '@/api/enquiries'
import { parsePrice } from '@/api/estimates'
import {
  depositOn,
  QUOTE_DEPOSIT_PERCENT,
  QUOTE_NOTE_MAX,
  useSendQuote,
  type Quote,
} from '@/api/quotes'
import { useWordingOverrides } from '@/api/wording'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DocumentViewer } from '@/components/staff/document-viewer'
import { enquiryName } from '@/components/staff/enquiry-text'
import { documentFor } from '@/components/staff/quote-section'
import { TaskFrame } from '@/components/staff/task-frame'
import { WorkItemsPicker } from '@/components/staff/work-items-picker'
import { currentEstimate } from '@/lib/enquiry-stage'
import {
  clearDraft,
  draftHasContent,
  quoteDraftSchema,
  readDraft,
  writeDraft,
  type QuoteDraft,
} from '@/lib/task-draft'
import { formatEuro, PRICE_MAX, PRICE_MIN } from '../../../supabase/functions/_shared/estimate.ts'
import { WORDING } from '../../../supabase/functions/_shared/messages.ts'
import { longDate } from '../../../supabase/functions/_shared/quote-document.ts'
import { BUSINESS_TZ, toLocal } from '../../../supabase/functions/_shared/time.ts'
import {
  addWorkingDays,
  QUOTE_VALID_WORKING_DAYS,
} from '../../../supabase/functions/_shared/working-days.ts'

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function sendError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('no email address')) return 'This enquiry has no email address to send to.'
  if (message.includes('enquiry closed')) return 'This enquiry is marked won or lost.'
  if (message.includes('not allowed')) return 'Your account cannot send quotes.'
  return 'The quote was not sent. Try again.'
}

export function QuoteTask({
  enquiry,
  previous,
}: {
  enquiry: EnquiryDetail
  previous: Quote | null
}) {
  const navigate = useNavigate()
  const estimate = currentEstimate(enquiry.estimates)
  const send = useSendQuote(enquiry.id)
  const wording = useWordingOverrides()
  const business = useBusinessDetails()
  const projectType = text(enquiry.answers.project_type)
  const base = previous?.id ?? null
  const start = useMemo<QuoteDraft>(
    () => ({
      price: previous ? String(previous.price_eur) : '',
      included: previous?.included ?? estimate?.work_items ?? [],
      excluded: previous?.excluded ?? [],
      note: previous?.note ?? '',
    }),
    [previous, estimate],
  )
  const [values, setValues] = useState<QuoteDraft>(
    () => readDraft('quote', enquiry.id, base, quoteDraftSchema) ?? start,
  )
  const [step, setStep] = useState<1 | 2>(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { price, included, excluded, note } = values
  const email = text(enquiry.answers.email)
  const first = (text(enquiry.answers.name) ?? '').split(/\s+/)[0] || 'them'
  const kept = draftHasContent(values, start)

  useEffect(() => {
    if (kept) writeDraft('quote', enquiry.id, base, values)
    else clearDraft('quote', enquiry.id)
  }, [kept, values, enquiry.id, base])
  useEffect(() => {
    if (step === 1) document.getElementById('quote-price')?.focus()
  }, [step])

  const set = (patch: Partial<QuoteDraft>, clear: string[] = []) => {
    setValues((v) => ({ ...v, ...patch }))
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k))))
  }

  const n = parsePrice(price)
  const validPrice = n !== null && n >= PRICE_MIN && n <= PRICE_MAX
  const deposit = validPrice ? depositOn(n) : null
  // Today in Ireland, and good for 15 working days, as send_quote will set them.
  const [today] = useState(() => toLocal(Date.now(), BUSINESS_TZ).date)
  const until = addWorkingDays(`${today}T12:00:00Z`, QUOTE_VALID_WORKING_DAYS)
  const terms = (wording.data?.quote_terms?.trim() || WORDING.quote_terms.default).replace(
    '{date}',
    longDate(until),
  )
  const preview = documentFor(
    enquiry,
    {
      number: previous?.number ?? 'Q3-Q-0000',
      version: previous ? previous.version + 1 : 1,
      included,
      excluded,
      note: note.trim() || null,
      price_eur: validPrice ? n : 0,
      deposit_percent: QUOTE_DEPOSIT_PERCENT,
      deposit_eur: deposit ?? 0,
      valid_until: until,
      terms,
      sentOn: today,
    },
    business.data ?? null,
  )

  const check = () => {
    const next: Record<string, string> = {}
    if (!validPrice) next.price = `Enter the price in whole euro, at least €${PRICE_MIN}.`
    if (included.length === 0) next.included = 'Tick at least one thing that is included.'
    if (note.trim().length > QUOTE_NOTE_MAX)
      next.note = `Keep it under ${QUOTE_NOTE_MAX} characters.`
    setErrors(next)
    const firstError = Object.keys(next)[0]
    if (firstError) document.getElementById(`quote-${firstError}`)?.focus()
    return firstError ? null : { price: n as number }
  }

  const submitSend = () => {
    const checked = check()
    if (!checked) return setStep(1)
    send.mutate(
      {
        price: checked.price,
        included,
        excluded,
        note,
        estimateId: previous?.estimate_id ?? estimate?.id ?? null,
      },
      {
        onSuccess: () => {
          clearDraft('quote', enquiry.id)
          navigate(`/enquiries/${enquiry.id}`, {
            replace: true,
            state: { notice: `Quote sent to ${email}. The email and PDF go within a minute.` },
          })
        },
      },
    )
  }

  const title = previous ? 'Send an updated quote' : 'Write the quote'

  if (step === 2 && validPrice)
    return (
      <TaskFrame
        enquiryId={enquiry.id}
        name={enquiryName(enquiry)}
        title="Check and send"
        step={{ at: 2, of: 2, label: 'the quote' }}
        about={`${formatEuro(n)}, VAT included. This is the quote exactly as ${first} gets it, as the email’s PDF.`}
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
          title="Quote"
          html={preview}
          tall
          lines={[
            `To: ${email ?? 'no email address'}, with this as a PDF`,
            `Good until ${longDate(until)} (15 working days)`,
            previous ? `This replaces ${previous.number} version ${previous.version}.` : null,
          ].filter((l): l is string => l !== null)}
        />
        <p className="text-muted-foreground text-sm">
          It goes within a minute and the enquiry is marked quoted.
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
      step={{ at: 1, of: 2, label: 'the quote' }}
      about={`One price, VAT included.${estimate && !previous ? ' Pre-ticked from the estimate.' : ''}${previous ? ` This replaces ${previous.number} version ${previous.version}.` : ''}`}
      saved={kept}
      bar={
        <Button type="submit" form="quote-form" className="h-12 flex-1" disabled={!email}>
          Check and send
        </Button>
      }
    >
      <form
        id="quote-form"
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (check()) setStep(2)
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-price" className="text-sm font-medium">
            Price in euro
          </label>
          <Input
            id="quote-price"
            inputMode="numeric"
            autoComplete="off"
            className="h-12 text-base"
            value={price}
            onChange={(e) => set({ price: e.target.value }, ['price'])}
            aria-invalid={errors.price ? true : undefined}
          />
          {errors.price && (
            <p role="alert" className="text-destructive text-sm">
              {errors.price}
            </p>
          )}
          <p className="text-sm" aria-live="polite">
            {deposit !== null
              ? `Deposit: ${formatEuro(deposit)} (${QUOTE_DEPOSIT_PERCENT}% of the price)`
              : `Deposit: ${QUOTE_DEPOSIT_PERCENT}% of the price`}
          </p>
        </div>
        <div id="quote-included" tabIndex={-1} className="flex flex-col gap-1">
          <WorkItemsPicker
            projectType={projectType}
            legend="What’s included"
            idPrefix="quote-in"
            ticked={included}
            invalid={Boolean(errors.included)}
            onChange={(next) => set({ included: next }, ['included'])}
          />
          {errors.included && (
            <p role="alert" className="text-destructive text-sm">
              {errors.included}
            </p>
          )}
        </div>
        <WorkItemsPicker
          projectType={null}
          kind="excluded"
          legend="What’s not included"
          idPrefix="quote-out"
          ticked={excluded}
          onChange={(next) => set({ excluded: next })}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="quote-note" className="text-sm font-medium">
            Note (optional)
          </label>
          <Textarea
            id="quote-note"
            rows={3}
            className="text-base md:text-base"
            value={note}
            onChange={(e) => set({ note: e.target.value }, ['note'])}
            aria-invalid={errors.note ? true : undefined}
          />
          {errors.note && (
            <p role="alert" className="text-destructive text-sm">
              {errors.note}
            </p>
          )}
        </div>
        {!email && (
          <p role="alert" className="text-destructive text-sm">
            This enquiry has no email address, so the quote cannot be sent.
          </p>
        )}
      </form>
    </TaskFrame>
  )
}
