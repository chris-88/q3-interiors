import { useMemo, useState } from 'react'
import { useAppointmentTypes, type AppointmentTypeSettings } from '@/api/staff-booking'
import {
  PREPARE_DEFAULTS,
  PREPARE_MAX,
  useResetWording,
  useSavePrepare,
  useSaveWording,
  useWordingOverrides,
} from '@/api/wording'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { AdminOnly, BackToSettings, SettingsCard } from '@/components/staff/settings-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  WORDING,
  WORDING_KEYS,
  renderEstimate,
  renderMessage,
  renderStaffAlert,
  wordingProblem,
  type Wording,
  type WordingKey,
} from '../../../supabase/functions/_shared/messages.ts'
import type { BookingContext, EnquirySummary } from '../../../supabase/functions/_shared/types.ts'
import { SITE_URL, STAFF_URL } from '../../../supabase/functions/_shared/site.ts'

/** The emails, each with the blocks inside it, in the order a customer meets them. */
const GROUPS: { title: string; keys: WordingKey[] }[] = [
  {
    title: 'Booking confirmation',
    keys: [
      'booking_confirmation.intro',
      'visit_disclaimer',
      'call_disclaimer',
      'booking_confirmation.closing',
    ],
  },
  { title: 'Reminder', keys: ['booking_reminder.intro', 'booking_reminder.closing'] },
  { title: 'New time', keys: ['booking_rescheduled.intro', 'booking_rescheduled.closing'] },
  { title: 'Cancellation', keys: ['booking_cancelled.intro', 'booking_cancelled.closing'] },
  { title: 'Estimate', keys: ['estimate_caveats'] },
  { title: 'Every customer email', keys: ['sign_off'] },
  {
    title: 'Staff alerts',
    keys: ['staff_new_enquiry.intro', 'staff_new_enquiry.note', 'staff_callback_request.intro'],
  },
]

const PREVIEWS = {
  confirmation_visit: 'Confirmation (site visit)',
  confirmation_call: 'Confirmation (call)',
  reminder: 'Reminder',
  rescheduled: 'New time',
  cancelled: 'Cancellation',
  estimate: 'Estimate',
  staff_new: 'Staff alert: new enquiry',
  staff_callback: 'Staff alert: call back requested',
} as const
type PreviewKind = keyof typeof PREVIEWS

function sampleContext(mode: 'phone' | 'on_site', prepare: string): BookingContext {
  const start = new Date(Date.now() + 3 * 86_400_000)
  start.setUTCHours(10, 0, 0, 0)
  return {
    booking: { starts_at: start.toISOString() },
    enquiry: {
      id: 'sample',
      reference: 'Q3-SAMPLE',
      answers: { name: 'Ann Murphy', phone: '087 123 4567' },
      site_details: { site_address: '12 Example Road, Dublin 7' },
    },
    staff: { display_name: 'Pat Quinn' },
    type: { mode, duration_minutes: mode === 'phone' ? 20 : 60, what_to_prepare: prepare },
  } as unknown as BookingContext
}

function render(kind: PreviewKind, wording: Wording, prepare: Record<string, string>) {
  // Customer links point at the public site; staff links at the staff site.
  const site = SITE_URL
  const common = {
    manageUrl: `${site}/#/book/sample-link`,
    businessPhone: null,
    privacyUrl: `${site}/#/privacy`,
    siteUrl: site,
    wording,
  }
  const visit = sampleContext('on_site', prepare.site_visit ?? '')
  const call = sampleContext('phone', prepare.phone_consultation ?? '')
  switch (kind) {
    case 'confirmation_visit':
      return renderMessage('booking_confirmation', { ...common, ctx: visit })
    case 'confirmation_call':
      return renderMessage('booking_confirmation', { ...common, ctx: call })
    case 'reminder':
      return renderMessage('booking_reminder', { ...common, ctx: visit })
    case 'rescheduled':
      return renderMessage('booking_rescheduled', { ...common, ctx: visit })
    case 'cancelled':
      return renderMessage('booking_cancelled', {
        ...common,
        ctx: visit,
        cancelledStart: visit.booking.starts_at,
      })
    case 'estimate':
      return renderEstimate({
        customerName: 'Ann Murphy',
        workLookedAt: 'Kitchen: strip out, new units and worktop, tiled floor.',
        low: 9500,
        high: 10500,
        caveats: wording.estimate_caveats?.trim() || WORDING.estimate_caveats.default,
        quoteUrl: `${site}/#/estimate/sample`,
        businessPhone: common.businessPhone,
        privacyUrl: common.privacyUrl,
        siteUrl: site,
      })
    default: {
      const summary = {
        id: 'sample',
        reference: 'Q3-SAMPLE',
        answers: { project_type_other: 'Kitchen', location: 'Dublin 7' },
        schema: null,
        contact_request_reason: kind === 'staff_callback' ? 'No times suited' : null,
      } as unknown as EnquirySummary
      return renderStaffAlert(
        kind === 'staff_new' ? 'staff_new_enquiry' : 'staff_callback_request',
        {
          summary,
          staffUrl: `${STAFF_URL}/#/`,
          siteUrl: site,
          wording,
        },
      )
    }
  }
}

function BlockEditor({
  k,
  saved,
  draft,
  onDraft,
}: {
  k: WordingKey
  saved: string | undefined
  draft: string
  onDraft: (text: string) => void
}) {
  const me = useCurrentStaff()
  const save = useSaveWording()
  const reset = useResetWording()
  const block = WORDING[k]
  const id = `wording-${k.replace('.', '-')}`
  const problem = wordingProblem(k, draft)
  const current = saved ?? block.default
  const changed = draft.trim() !== current.trim()
  const tokens = block.tokens as readonly string[]
  return (
    <div className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <label htmlFor={id} className="font-medium">
        {block.label}
      </label>
      <Textarea
        id={id}
        rows={3}
        className="text-base"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-hint${problem ? ` ${id}-error` : ''}`}
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-sm">
        {block.where}. {[...draft.trim()].length}/{block.max} characters.
        {tokens.length > 0 && ` You can use ${tokens.map((t) => `{${t}}`).join(' and ')}.`}
        {saved === undefined ? ' Using the default.' : ' Reworded.'}
      </p>
      {problem && (
        <p id={`${id}-error`} className="text-destructive text-sm" role="alert">
          {problem}
        </p>
      )}
      {(save.isError || reset.isError) && (
        <p className="text-destructive text-sm" role="alert">
          Not saved. Please try again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-12 px-6"
          disabled={!changed || problem !== null || save.isPending}
          onClick={() => save.mutate({ key: k, body: draft, by: me.display_name })}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saved !== undefined && (
          <Button
            variant="outline"
            className="h-12"
            disabled={reset.isPending}
            onClick={() => reset.mutate(k, { onSuccess: () => onDraft(block.default) })}
          >
            Reset to default
          </Button>
        )}
      </div>
    </div>
  )
}

function PrepareEditor({
  type,
  draft,
  onDraft,
}: {
  type: AppointmentTypeSettings
  draft: string
  onDraft: (t: string) => void
}) {
  const save = useSavePrepare()
  const id = `prepare-${type.id}`
  const length = [...draft.trim()].length
  const problem =
    length === 0
      ? 'This cannot be empty.'
      : length > PREPARE_MAX
        ? `Use at most ${PREPARE_MAX} characters.`
        : null
  const fallback = PREPARE_DEFAULTS[type.id]
  return (
    <div className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <label htmlFor={id} className="font-medium">
        {type.label}
      </label>
      <Textarea
        id={id}
        rows={3}
        className="text-base"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-hint${problem ? ` ${id}-error` : ''}`}
      />
      <p id={`${id}-hint`} className="text-muted-foreground text-sm">
        Shown on the booked page and in the confirmation and reminder emails. {length}/{PREPARE_MAX}{' '}
        characters.
      </p>
      {problem && (
        <p id={`${id}-error`} className="text-destructive text-sm" role="alert">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-12 px-6"
          disabled={
            draft.trim() === type.what_to_prepare.trim() || problem !== null || save.isPending
          }
          onClick={() => save.mutate({ id: type.id, text: draft })}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {fallback && draft.trim() !== fallback && (
          <Button variant="outline" className="h-12" onClick={() => onDraft(fallback)}>
            Use the default text
          </Button>
        )}
      </div>
    </div>
  )
}

function Preview({ wording, prepare }: { wording: Wording; prepare: Record<string, string> }) {
  const [kind, setKind] = useState<PreviewKind>('confirmation_visit')
  const message = useMemo(() => render(kind, wording, prepare), [kind, wording, prepare])
  return (
    <SettingsCard title="Preview" id="preview-heading">
      <p className="text-muted-foreground mb-3 text-sm">
        Shows your unsaved changes, with a made-up customer. Times and links are filled in for each
        real email.
      </p>
      <label htmlFor="preview-kind" className="text-sm font-medium">
        Email
      </label>
      <NativeSelect
        id="preview-kind"
        className="mt-1 h-12 w-full text-base"
        value={kind}
        onChange={(e) => setKind(e.target.value as PreviewKind)}
      >
        {Object.entries(PREVIEWS).map(([value, label]) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <p className="mt-3 text-sm">
        <span className="font-medium">Subject:</span> {message.subject}
      </p>
      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={message.html}
        className="mt-2 h-[32rem] w-full rounded-md border"
      />
      <details className="mt-2">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">
          Plain-text version
        </summary>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-sm whitespace-pre-wrap">
          {message.text}
        </pre>
      </details>
    </SettingsCard>
  )
}

function WordingEditor({ saved, types }: { saved: Wording; types: AppointmentTypeSettings[] }) {
  const [drafts, setDrafts] = useState<Wording>(() =>
    Object.fromEntries(WORDING_KEYS.map((k) => [k, saved[k] ?? WORDING[k].default])),
  )
  const [prepare, setPrepare] = useState<Record<string, string>>(() =>
    Object.fromEntries(types.map((t) => [t.id, t.what_to_prepare])),
  )
  return (
    <>
      <Preview wording={drafts} prepare={prepare} />
      <SettingsCard title="What to prepare" id="prepare-heading">
        <div className="flex flex-col gap-3">
          {types.map((t) => (
            <PrepareEditor
              key={t.id}
              type={t}
              draft={prepare[t.id] ?? ''}
              onDraft={(text) => setPrepare((p) => ({ ...p, [t.id]: text }))}
            />
          ))}
        </div>
      </SettingsCard>
      {GROUPS.map((g) => (
        <SettingsCard
          key={g.title}
          title={g.title}
          id={`group-${g.title.replace(/\W+/g, '-').toLowerCase()}`}
        >
          <div className="flex flex-col gap-3">
            {g.keys.map((k) => (
              <BlockEditor
                key={k}
                k={k}
                saved={saved[k]}
                draft={drafts[k] ?? ''}
                onDraft={(text) => setDrafts((d) => ({ ...d, [k]: text }))}
              />
            ))}
          </div>
        </SettingsCard>
      ))}
    </>
  )
}

export function WordingPage() {
  const overrides = useWordingOverrides()
  const types = useAppointmentTypes()
  return (
    <AdminOnly>
      <div className="flex flex-col gap-4">
        <BackToSettings />
        <h1 className="text-section text-ink font-medium">Wording</h1>
        <p className="text-muted-foreground text-sm">
          Reword the parts of each email in your own words. The date and time, the reference, the
          Change-or-cancel button and the privacy link are always added for you.
        </p>
        {overrides.isPending || types.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : overrides.isError || types.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>Could not load the wording. Please try again.</AlertDescription>
          </Alert>
        ) : (
          <WordingEditor saved={overrides.data} types={types.data} />
        )}
      </div>
    </AdminOnly>
  )
}
