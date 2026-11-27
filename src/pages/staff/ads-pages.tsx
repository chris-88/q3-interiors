import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, Copy, Play } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'
import {
  adErrorMessage,
  adEventLabel,
  adStatusLabel,
  downloadAdFile,
  latestVersion,
  REQUEST_MAX,
  requestSizeLabel,
  useAd,
  useAdFileUrl,
  useAdHtml,
  useAds,
  useApproveAd,
  useArchiveAd,
  useRequestChange,
  useWithdrawRequest,
  type Ad,
  type AdRequest,
  type AdVersion,
} from '@/api/ads'
import { AdFrame } from '@/components/staff/ad-frame'
import { AdCampaign, EnquiriesFromAd } from '@/components/staff/ad-campaign'
import { ListWalk } from '@/components/staff/list-walk'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  adOrder,
  neighbours,
  previewOptions,
  readAdFilter,
  adListPath,
  canApproveVersion,
  versionApproved,
  type AdFilter,
  type PreviewOption,
} from '@/lib/ads/screens'
import { parseWalk, walkIds, WALK_KEY } from '@/lib/ads/by-campaign'
import { campaignLink } from '@/lib/campaigns'
import { formatDateTime } from '@/lib/format'
import { SITE_URL } from '../../../supabase/functions/_shared/site.ts'

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'new' ? 'default' : 'outline'}>{adStatusLabel(status)}</Badge>
}

// ---------------------------------------------------------------------------------------------
// The list: posters in a grid, grouped by set, filtered by chips.
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// The ad page: preview first, then review, the words to post, and everything else under More.
// ---------------------------------------------------------------------------------------------

/** Saves a file from the private bucket under a plain name, with the staff member's session. */
async function saveAdFile(objectPath: string, filename: string) {
  const blob = await downloadAdFile(objectPath)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function useDownload() {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const start = (path: string, filename: string) => {
    setState('busy')
    saveAdFile(path, filename).then(
      () => setState('idle'),
      () => setState('failed'),
    )
  }
  return { state, start }
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** The published MP4: autoplay, muted, looping; tap to pause. Reduced motion: poster and Play. */
function AdVideo({ option, title }: { option: PreviewOption; title: string }) {
  const [reduce] = useState(prefersReducedMotion)
  const video = useAdFileUrl(option.path)
  const poster = useAdFileUrl(option.poster)
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !video.url) return
    el.muted = true
    if (!reduce) void el.play().catch(() => setPlaying(false))
  }, [video.url, reduce])
  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }
  if (video.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Could not load the video. Please try again.</AlertDescription>
      </Alert>
    )
  return (
    <div
      className="relative w-full overflow-hidden rounded-md bg-black"
      style={{ aspectRatio: `${option.width} / ${option.height}` }}
    >
      {video.url ? (
        <video
          ref={ref}
          src={video.url}
          poster={poster.url ?? undefined}
          muted
          loop
          playsInline
          preload="auto"
          aria-label={title}
          className="size-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
      {video.url && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause the video' : 'Play the video'}
          className="absolute inset-0 flex items-center justify-center focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-white"
        >
          {!playing && (
            <span className="flex size-16 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="size-8" aria-hidden="true" />
            </span>
          )}
        </button>
      )}
    </div>
  )
}

function AdImage({ option, title }: { option: PreviewOption; title: string }) {
  const image = useAdFileUrl(option.path)
  return (
    <div
      className="w-full overflow-hidden rounded-md bg-black"
      style={{ aspectRatio: `${option.width} / ${option.height}` }}
    >
      {image.url ? (
        <img src={image.url} alt={title} className="size-full object-contain" />
      ) : image.isError ? (
        <p role="alert" className="p-4 text-sm text-white">
          Could not load the still. Please try again.
        </p>
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
    </div>
  )
}

function FramePreview({ option, title }: { option: PreviewOption; title: string }) {
  const html = useAdHtml(option.path)
  if (html.isPending)
    return (
      <Skeleton className="w-full" style={{ aspectRatio: `${option.width} / ${option.height}` }} />
    )
  if (html.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Could not load the preview. Please try again.</AlertDescription>
      </Alert>
    )
  return <AdFrame html={html.data} width={option.width} height={option.height} title={title} />
}

function Preview({
  ad,
  version,
  primary,
}: {
  ad: Ad
  version: AdVersion
  /** Download is the one filled button unless Approve is on offer. */
  primary: boolean
}) {
  const options = previewOptions(version.ad_variants, ad.name, version.version)
  const [key, setKey] = useState(options[0]?.key)
  const option = options.find((o) => o.key === key) ?? options[0]
  const download = useDownload()
  const extra = useDownload()
  if (!option) return <p className="text-muted-foreground">This version has no files to show.</p>
  const title = `${ad.name}, ${option.label.toLowerCase()}, version ${version.version}`
  return (
    <section aria-label="Preview" className="flex flex-col gap-3">
      {options.length > 1 && (
        <fieldset className="min-w-0">
          <legend className="sr-only">Preview</legend>
          <div className="border-edge grid auto-cols-fr grid-flow-col overflow-hidden rounded-md border">
            {options.map((o) => (
              <label
                key={o.key}
                className="has-[:checked]:bg-action has-[:focus-visible]:outline-action relative flex min-h-12 cursor-pointer items-center justify-center text-sm font-medium has-[:checked]:text-white has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-solid"
              >
                <input
                  type="radio"
                  name="preview"
                  className="sr-only"
                  checked={o.key === option.key}
                  onChange={() => setKey(o.key)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className={option.height > option.width * 1.5 ? 'mx-auto w-full max-w-xs' : 'w-full'}>
        {option.kind === 'video' ? (
          <AdVideo key={option.path} option={option} title={title} />
        ) : option.kind === 'image' ? (
          <AdImage key={option.path} option={option} title={title} />
        ) : (
          <FramePreview key={option.path} option={option} title={title} />
        )}
      </div>
      <p className="text-muted-foreground text-center text-sm">{option.caption}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button
          variant={primary ? 'default' : 'outline'}
          className="h-12 px-6"
          disabled={download.state === 'busy'}
          onClick={() => download.start(option.download.path, option.download.filename)}
        >
          {download.state === 'busy' ? 'Preparing…' : option.download.label}
        </Button>
        {option.extra && (
          <Button
            variant="link"
            className="h-12 px-0"
            disabled={extra.state === 'busy'}
            onClick={() => option.extra && extra.start(option.extra.path, option.extra.filename)}
          >
            {option.extra.label}
          </Button>
        )}
      </div>
      <output className="block text-sm">
        {download.state === 'failed' || extra.state === 'failed'
          ? 'The download did not work. Please try again.'
          : ''}
      </output>
    </section>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-2 border-t py-2 first:border-t-0">
      <div className="min-w-0 flex-1 py-1">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-sm break-words whitespace-pre-line">{value}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-12 shrink-0"
        aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  )
}

function RequestItem({ request }: { request: AdRequest }) {
  const me = useCurrentStaff()
  const withdraw = useWithdrawRequest()
  const state =
    request.state === 'open'
      ? 'Open'
      : request.state === 'done'
        ? `Done in version ${request.done_in_version ?? ''}`
        : request.state === 'withdrawn'
          ? 'Withdrawn'
          : request.state
  return (
    <li className="flex flex-col gap-1 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={request.state === 'open' ? 'default' : 'outline'}>{state}</Badge>
        <span className="text-muted-foreground text-sm">{requestSizeLabel(request.size)}</span>
      </div>
      <p className="break-words whitespace-pre-line">{request.body}</p>
      <span className="text-muted-foreground text-sm">
        {request.created_by_name} · {formatDateTime(request.created_at)}
      </span>
      {request.state === 'open' && request.created_by === me.user_id && (
        <Button
          variant="ghost"
          className="h-12 self-start"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate(request.id)}
        >
          Withdraw my request
        </Button>
      )}
      {withdraw.isError && (
        <p role="alert" className="text-destructive text-sm">
          {adErrorMessage(withdraw.error)}
        </p>
      )}
    </li>
  )
}

function RequestForm({ ad, onSaved }: { ad: Ad; onSaved: () => void }) {
  const send = useRequestChange()
  const [body, setBody] = useState('')
  const [size, setSize] = useState<AdRequest['size']>('both')
  const [problem, setProblem] = useState<string | null>(null)
  const sizes = [
    'both',
    ...new Set(ad.ad_versions.flatMap((v) => v.ad_variants.map((x) => x.size))),
  ]
  return (
    <form
      id="request-form"
      noValidate
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        const text = body.trim()
        if (text.length < 3) return setProblem('Say what should change (at least 3 characters).')
        if (text.length > REQUEST_MAX) return setProblem(`Use at most ${REQUEST_MAX} characters.`)
        setProblem(null)
        send.mutate({ adId: ad.id, body: text, size }, { onSuccess: onSaved })
      }}
    >
      <label htmlFor="request-body" className="font-medium">
        What should change?
      </label>
      <Textarea
        id="request-body"
        rows={4}
        className="text-base"
        value={body}
        maxLength={REQUEST_MAX + 50}
        onChange={(e) => setBody(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`request-hint${problem ? ' request-error' : ''}`}
      />
      <p id="request-hint" className="text-muted-foreground text-sm">
        {body.trim().length}/{REQUEST_MAX} characters.
      </p>
      {problem && (
        <p id="request-error" role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Which size?</legend>
        <div className="flex flex-wrap gap-2">
          {sizes.map((s) => (
            <label
              key={s}
              className="border-edge has-[:checked]:border-action has-[:checked]:bg-soft flex min-h-12 items-center gap-2 rounded-md border px-3"
            >
              <input
                type="radio"
                name="request-size"
                className="size-5"
                checked={size === s}
                onChange={() => setSize(s as AdRequest['size'])}
              />
              {requestSizeLabel(s)}
            </label>
          ))}
        </div>
      </fieldset>
      {send.isError && (
        <p role="alert" className="text-destructive text-sm">
          {adErrorMessage(send.error)}
        </p>
      )}
      <Button type="submit" className="h-12 self-start px-6" disabled={send.isPending}>
        {send.isPending ? 'Saving…' : 'Save the request'}
      </Button>
    </form>
  )
}

function Review({ ad, version, isCurrent }: { ad: Ad; version: AdVersion; isCurrent: boolean }) {
  const me = useCurrentStaff()
  const approve = useApproveAd()
  const [confirming, setConfirming] = useState(false)
  const [asking, setAsking] = useState(false)
  const [saved, setSaved] = useState(false)
  const open = ad.ad_requests
    .filter((r) => r.version_id === version.id && r.state === 'open')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const archived = ad.status === 'archived'
  const canApprove = canApproveVersion({
    role: me.role,
    isCurrent,
    adStatus: ad.status,
    approvedAt: version.approved_at,
  })
  const canAsk = isCurrent && !archived
  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-3">
      <h2 id="review-heading" className="sr-only">
        Review
      </h2>
      {version.approved_at ? (
        <p className="text-sm">
          Approved by {version.approved_by_name ?? 'an admin'} on{' '}
          {formatDateTime(version.approved_at)}.
        </p>
      ) : (
        versionApproved(version, ad.status, isCurrent) && <p className="text-sm">Approved.</p>
      )}
      {open.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {open.length === 1 ? '1 open request' : `${open.length} open requests`}
          </h3>
          <ul className="flex flex-col gap-2">
            {open.map((r) => (
              <RequestItem key={r.id} request={r} />
            ))}
          </ul>
        </div>
      )}
      {(canApprove || canAsk) && !confirming && (
        <div className="grid grid-cols-2 gap-2">
          {canApprove && (
            <Button
              className="h-12"
              disabled={approve.isPending}
              onClick={() =>
                open.length > 0
                  ? setConfirming(true)
                  : approve.mutate({ adId: ad.id, version: version.version, despiteOpen: false })
              }
            >
              Approve
            </Button>
          )}
          {canAsk && (
            <Button
              variant="outline"
              className={`h-12 ${canApprove ? '' : 'col-span-2 sm:col-span-1'}`}
              aria-expanded={asking}
              aria-controls="request-form"
              onClick={() => {
                setAsking((x) => !x)
                setSaved(false)
              }}
            >
              Ask for a change
            </Button>
          )}
        </div>
      )}
      {confirming && (
        <Alert role="alertdialog" aria-labelledby="confirm-title">
          <AlertTitle id="confirm-title">
            Approve with {open.length} open {open.length === 1 ? 'request' : 'requests'}?
          </AlertTitle>
          <AlertDescription>
            <p>
              Someone asked for changes to this version that have not been made. Approve it as it is
              anyway?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="h-12"
                disabled={approve.isPending}
                onClick={() =>
                  approve.mutate(
                    { adId: ad.id, version: version.version, despiteOpen: true },
                    { onSuccess: () => setConfirming(false) },
                  )
                }
              >
                Yes, approve as it is
              </Button>
              <Button variant="outline" className="h-12" onClick={() => setConfirming(false)}>
                Not yet
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {asking && canAsk && (
        <RequestForm
          ad={ad}
          onSaved={() => {
            setAsking(false)
            setSaved(true)
          }}
        />
      )}
      <output className="block text-sm">
        {saved ? 'Saved. The ad now shows “Changes requested”.' : ''}
      </output>
      {approve.isError && (
        <p role="alert" className="text-destructive text-sm">
          {adErrorMessage(approve.error)}
        </p>
      )}
    </section>
  )
}

function ToPost({ ad, version }: { ad: Ad; version: AdVersion }) {
  const creative = ad.campaign_creatives
  const campaign =
    creative?.campaigns &&
    campaignLink({
      siteUrl: SITE_URL,
      source: creative.campaigns.utm_source,
      medium: creative.campaigns.utm_medium,
      campaign: creative.campaigns.slug,
      content: creative.slug,
      route: creative.campaigns.landing_route,
    })
  const link = version.link_url ?? campaign ?? null
  return (
    <section aria-labelledby="post-heading" className="bg-background rounded-md border px-3 py-2">
      <h2 id="post-heading" className="pt-1 text-base font-medium">
        To post
      </h2>
      <CopyRow label="Caption" value={version.caption} />
      {version.headline && <CopyRow label="Headline" value={version.headline} />}
      {version.button_label && <CopyRow label="Instagram button" value={version.button_label} />}
      {link && <CopyRow label="Link" value={link} />}
      {campaign && campaign !== link && <CopyRow label="Campaign link" value={campaign} />}
    </section>
  )
}

function More({ ad, version, isCurrent }: { ad: Ad; version: AdVersion; isCurrent: boolean }) {
  const me = useCurrentStaff()
  const archive = useArchiveAd()
  const archived = ad.status === 'archived'
  const history = ad.ad_requests
    .filter((r) => r.state !== 'open')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const events = [...ad.ad_events].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <details className="bg-background group rounded-md border">
      <summary className="flex min-h-12 cursor-pointer items-center px-3 text-base font-medium">
        More
      </summary>
      <div className="flex flex-col gap-4 border-t p-3">
        {ad.set_name && (
          <p className="text-sm">
            Set: {ad.set_name}
            {ad.set_position ? `, number ${ad.set_position}` : ''}
          </p>
        )}
        {version.notes && (
          <div>
            <h3 className="text-sm font-medium">Notes</h3>
            <p className="text-sm break-words whitespace-pre-line">{version.notes}</p>
          </div>
        )}
        {history.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Earlier requests</h3>
            <ul className="flex flex-col gap-2">
              {history.map((r) => (
                <RequestItem key={r.id} request={r} />
              ))}
            </ul>
          </div>
        )}
        {events.length > 0 && (
          <div>
            <h3 className="text-sm font-medium">History</h3>
            <ul className="text-sm">
              {events.map((e, i) => (
                <li key={i} className="border-t py-2 first:border-t-0">
                  {adEventLabel(e.kind)}
                  {e.version ? `, version ${e.version}` : ''}
                  {e.detail ? `: ${e.detail}` : ''}
                  <span className="text-muted-foreground block">
                    {e.actor_name ?? 'Ad studio'} · {formatDateTime(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {me.role === 'admin' && isCurrent && (
          <Button
            variant="outline"
            className="h-12 self-start"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ adId: ad.id, archived: !archived })}
          >
            {archived ? 'Bring back from the archive' : 'Archive this ad'}
          </Button>
        )}
        {archive.isError && (
          <p role="alert" className="text-destructive text-sm">
            {adErrorMessage(archive.error)}
          </p>
        )}
      </div>
    </details>
  )
}

function Walk({ id, filter }: { id: string; filter: AdFilter }) {
  const ads = useAds()
  const [stored] = useState(() => {
    try {
      return parseWalk(sessionStorage.getItem(WALK_KEY))
    } catch {
      return null
    }
  })
  const place = ads.data
    ? neighbours(walkIds(stored, filter, id, adOrder(ads.data, filter)), id)
    : null
  if (!place) return null
  return (
    <ListWalk
      label="Ads in this list"
      place={place}
      to={(target) => `/ads/${target}?show=${filter}`}
    />
  )
}

function AdView({ ad }: { ad: Ad }) {
  const me = useCurrentStaff()
  const current = latestVersion(ad)
  const versions = [...ad.ad_versions].sort((a, b) => b.version - a.version)
  const [chosen, setChosen] = useState<number | null>(null)
  const version = versions.find((v) => v.version === chosen) ?? current
  const isCurrent = version?.id === current?.id
  if (!version) return <p className="text-muted-foreground">This ad has no versions yet.</p>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-title text-ink leading-tight font-medium">{ad.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={ad.status} />
          {versions.length > 1 && (
            <>
              <label htmlFor="version" className="sr-only">
                Version
              </label>
              <NativeSelect
                id="version"
                className="h-12 w-auto text-sm"
                value={version.version}
                onChange={(e) => setChosen(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <NativeSelectOption key={v.id} value={v.version}>
                    Version {v.version}
                    {v.id === current?.id ? ', current' : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          )}
        </div>
        {!isCurrent && (
          <p className="text-muted-foreground text-sm">
            An older version, kept for reference. Requests and approval are on the current one.
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-4">
          <Preview
            key={version.id}
            ad={ad}
            version={version}
            primary={
              !canApproveVersion({
                role: me.role,
                isCurrent,
                adStatus: ad.status,
                approvedAt: version.approved_at,
              })
            }
          />
        </div>
        <div className="flex flex-col gap-4">
          <Review ad={ad} version={version} isCurrent={isCurrent} />
          <ToPost ad={ad} version={version} />
          <AdCampaign ad={ad} />
          <EnquiriesFromAd ad={ad} />
          <More ad={ad} version={version} isCurrent={isCurrent} />
        </div>
      </div>
    </div>
  )
}

export function AdPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const filter = readAdFilter(location.search)
  const ad = useAd(id)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Link
          to={adListPath(filter)}
          className="text-primary inline-flex min-h-12 items-center gap-1 text-sm underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          All ads
        </Link>
        <Walk id={id} filter={filter} />
      </div>
      {ad.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : ad.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Could not load this ad. Please try again.</AlertDescription>
        </Alert>
      ) : !ad.data ? (
        <p className="text-muted-foreground">There is no such ad.</p>
      ) : (
        <AdView key={ad.data.id} ad={ad.data} />
      )}
    </div>
  )
}
