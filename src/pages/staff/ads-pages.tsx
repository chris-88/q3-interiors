import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { Link, useParams } from 'react-router'
import {
  adStatusLabel,
  requestSizeLabel,
  adErrorMessage,
  downloadAdFile,
  latestVersion,
  REQUEST_MAX,
  useAd,
  useAdHtml,
  useAds,
  useApproveAd,
  useArchiveAd,
  useRequestChange,
  useWithdrawRequest,
  type Ad,
  type AdRequest,
  type AdVariant,
  type AdVersion,
} from '@/api/ads'
import { AdFrame } from '@/components/staff/ad-frame'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { campaignLink } from '@/lib/campaigns'
import { exportFilename, formatDuration, PLACEMENTS } from '@/lib/ads/spec'
import { formatDateTime } from '@/lib/format'
import { SITE_URL } from '../../../supabase/functions/_shared/site.ts'

function StatusBadge({ status }: { status: Ad['status'] }) {
  return <Badge variant={status === 'new' ? 'default' : 'outline'}>{adStatusLabel(status)}</Badge>
}

const FILTERS = {
  active: 'All except archived',
  new: 'New',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  archived: 'Archived',
} as const
type Filter = keyof typeof FILTERS

export function AdsPage() {
  const ads = useAds()
  const [filter, setFilter] = useState<Filter>('active')
  const shown = (ads.data ?? []).filter((ad) =>
    filter === 'active' ? ad.status !== 'archived' : ad.status === filter,
  )
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-section text-ink font-medium">Ads</h1>
      <p className="text-muted-foreground -mt-2 text-sm">
        Instagram ads built in the ad studio. Open one to see it at its real size, ask for changes,
        download the image or video and copy the words for the post.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="ads-filter" className="text-sm font-medium">
          Show
        </label>
        <NativeSelect
          id="ads-filter"
          className="h-12 w-full text-base sm:w-72"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          {Object.entries(FILTERS).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {ads.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : ads.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Could not load the ads.{' '}
            <Button variant="outline" size="sm" onClick={() => void ads.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : shown.length === 0 ? (
        <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
          {ads.data.length === 0
            ? 'No ads yet. They appear here when one is published from the ad studio.'
            : 'No ads with this status.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((ad) => {
            const open = ad.ad_requests.filter((r) => r.state === 'open').length
            const current = [...ad.ad_versions].sort((x, y) => y.version - x.version)[0]
            const loop = current?.ad_variants.find((v) => v.duration_ms !== null)?.duration_ms
            return (
              <li key={ad.id}>
                <Link
                  to={`/ads/${ad.id}`}
                  className="bg-background hover:bg-muted/50 flex items-center gap-3 rounded-md border p-4"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{ad.name}</span>
                      <StatusBadge status={ad.status} />
                    </span>
                    <span className="text-muted-foreground text-sm">
                      Version {current?.version ?? 1}
                      {loop ? ` · Animated, ${formatDuration(loop)}` : ''}
                      {open > 0 && ` · ${open} open ${open === 1 ? 'request' : 'requests'}`} ·{' '}
                      {formatDateTime(ad.created_at)}
                    </span>
                  </span>
                  <ChevronRight
                    className="text-muted-foreground size-5 shrink-0"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function CopyRow({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      {value ? (
        <>
          <p className="break-words whitespace-pre-line">{value}</p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="h-12"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(value)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              Copy {label.toLowerCase()}
            </Button>
            <output className="text-sm">{copied ? 'Copied.' : ''}</output>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">None for this ad.</p>
      )}
    </div>
  )
}

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

function DownloadButton({
  label,
  objectPath,
  filename,
  variant = 'default',
}: {
  label: string
  objectPath: string
  filename: string
  variant?: 'default' | 'outline'
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={variant}
        className="h-12 self-start px-6"
        disabled={state === 'busy'}
        onClick={() => {
          setState('busy')
          saveAdFile(objectPath, filename).then(
            () => setState('idle'),
            () => setState('failed'),
          )
        }}
      >
        {state === 'busy' ? 'Preparing…' : label}
      </Button>
      <output className="text-sm">
        {state === 'failed' ? 'The download did not work. Please try again.' : ''}
      </output>
    </div>
  )
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

function SizeView({ ad, version, variant }: { ad: Ad; version: number; variant: AdVariant }) {
  const html = useAdHtml(variant.html_path)
  const p = PLACEMENTS[variant.size]
  const animated = variant.export_type === 'video'
  // Someone who asked their device for less motion starts paused, on the readable first frame.
  const [paused, setPaused] = useState(prefersReducedMotion)
  const [run, setRun] = useState(0)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {p.where}: {variant.width} x {variant.height} pixels, shown here scaled down.
        {variant.size === 'vertical' &&
          ' Instagram covers roughly the top 14% and the bottom 35% with its own buttons.'}
      </p>
      {animated && variant.duration_ms !== null && (
        <p className="text-sm">
          Animated: {formatDuration(variant.duration_ms)}, then it starts again. On Instagram it
          runs as a video.
        </p>
      )}
      <div className="mx-auto w-full max-w-sm">
        {html.isPending ? (
          <Skeleton
            className="w-full"
            style={{ aspectRatio: `${variant.width} / ${variant.height}` }}
          />
        ) : html.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>Could not load the preview. Please try again.</AlertDescription>
          </Alert>
        ) : (
          <AdFrame
            html={html.data}
            width={variant.width}
            height={variant.height}
            title={`${ad.name}, version ${version}, ${p.label}`}
            paused={animated && paused}
            run={run}
          />
        )}
      </div>
      {animated && html.isSuccess && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-12"
            onClick={() => {
              setRun((n) => n + 1)
              setPaused(false)
            }}
          >
            <RotateCcw aria-hidden="true" />
            Replay
          </Button>
          <Button variant="outline" className="h-12" onClick={() => setPaused((x) => !x)}>
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {paused ? 'Play' : 'Pause'}
          </Button>
        </div>
      )}
      {animated ? (
        <>
          <DownloadButton
            label={`Download the video (${p.label})`}
            objectPath={variant.export_path}
            filename={exportFilename(ad.name, version, p, 'mp4')}
          />
          {variant.poster_path && (
            <DownloadButton
              variant="outline"
              label={`Download a still of the last frame (${p.label})`}
              objectPath={variant.poster_path}
              filename={exportFilename(ad.name, version, p).replace(/\.png$/, '-still.png')}
            />
          )}
        </>
      ) : (
        <DownloadButton
          label={`Download the image (${p.label})`}
          objectPath={variant.export_path}
          filename={exportFilename(ad.name, version, p)}
        />
      )}
    </div>
  )
}

const ORDER = ['portrait', 'vertical', 'square']

function Sizes({ ad, version }: { ad: Ad; version: AdVersion }) {
  const variants = [...version.ad_variants].sort(
    (a, b) => ORDER.indexOf(a.size) - ORDER.indexOf(b.size),
  )
  const [tab, setTab] = useState(variants[0]?.size ?? 'portrait')
  const current = variants.find((v) => v.size === tab) ?? variants[0]
  if (!current) return <p className="text-muted-foreground">This version has no sizes.</p>
  return (
    <section aria-labelledby="sizes-heading" className="bg-background rounded-md border p-4">
      <h2 id="sizes-heading" className="sr-only">
        Sizes
      </h2>
      <div role="tablist" aria-label="Sizes" className="mb-4 flex flex-wrap gap-2">
        {variants.map((v) => (
          <button
            key={v.size}
            type="button"
            role="tab"
            id={`tab-${v.size}`}
            aria-selected={v.size === current.size}
            aria-controls="size-panel"
            onClick={() => setTab(v.size)}
            className={`h-12 rounded-md border px-4 text-sm font-medium ${
              v.size === current.size
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-edge bg-background'
            }`}
          >
            {PLACEMENTS[v.size].label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="size-panel" aria-labelledby={`tab-${current.size}`}>
        <SizeView key={current.id} ad={ad} version={version.version} variant={current} />
      </div>
    </section>
  )
}

function Review({ ad, version, isCurrent }: { ad: Ad; version: AdVersion; isCurrent: boolean }) {
  const me = useCurrentStaff()
  const approve = useApproveAd()
  const archive = useArchiveAd()
  const [confirming, setConfirming] = useState(false)
  const open = ad.ad_requests.filter((r) => r.version_id === version.id && r.state === 'open')
  const isAdmin = me.role === 'admin'
  const archived = ad.status === 'archived'
  const failed = approve.error ?? archive.error
  return (
    <section
      aria-labelledby="review-heading"
      className="bg-background flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id="review-heading" className="text-base font-medium">
        Review
      </h2>
      <p className="text-sm">
        {version.approved_at
          ? `Version ${version.version} approved by ${version.approved_by_name ?? 'an admin'} on ${formatDateTime(version.approved_at)}.`
          : isCurrent
            ? `Version ${version.version} is ${adStatusLabel(ad.status).toLowerCase()}.`
            : `Version ${version.version} was not approved.`}
      </p>
      {!isAdmin && (
        <p className="text-muted-foreground text-sm">
          An admin approves ads. Ask for a change below if something needs fixing.
        </p>
      )}
      {isAdmin && isCurrent && !archived && !version.approved_at && !confirming && (
        <Button
          className="h-12 self-start px-6"
          disabled={approve.isPending}
          onClick={() =>
            open.length > 0
              ? setConfirming(true)
              : approve.mutate({ adId: ad.id, version: version.version, despiteOpen: false })
          }
        >
          Approve version {version.version}
        </Button>
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
      {isAdmin && isCurrent && (
        <Button
          variant="ghost"
          className="h-12 self-start"
          disabled={archive.isPending}
          onClick={() => archive.mutate({ adId: ad.id, archived: !archived })}
        >
          {archived ? 'Bring back from the archive' : 'Archive this ad'}
        </Button>
      )}
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {adErrorMessage(failed)}
        </p>
      )}
    </section>
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
        : 'Withdrawn'
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

function RequestForm({ ad }: { ad: Ad }) {
  const send = useRequestChange()
  const [body, setBody] = useState('')
  const [size, setSize] = useState<AdRequest['size']>('both')
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const sizes = [
    'both',
    ...new Set(ad.ad_versions.flatMap((v) => v.ad_variants.map((x) => x.size))),
  ]
  return (
    <form
      noValidate
      className="flex flex-col gap-3 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        const text = body.trim()
        if (text.length < 3) return setProblem('Say what should change (at least 3 characters).')
        if (text.length > REQUEST_MAX) return setProblem(`Use at most ${REQUEST_MAX} characters.`)
        setProblem(null)
        send.mutate(
          { adId: ad.id, body: text, size },
          {
            onSuccess: () => {
              setBody('')
              setSize('both')
              setSent(true)
            },
          },
        )
      }}
    >
      <label htmlFor="request-body" className="font-medium">
        Ask for a change
      </label>
      <Textarea
        id="request-body"
        rows={4}
        className="text-base"
        value={body}
        maxLength={REQUEST_MAX + 50}
        onChange={(e) => {
          setBody(e.target.value)
          setSent(false)
        }}
        aria-invalid={problem ? true : undefined}
        aria-describedby={`request-hint${problem ? ' request-error' : ''}`}
      />
      <p id="request-hint" className="text-muted-foreground text-sm">
        Say what should change, in your own words. {body.trim().length}/{REQUEST_MAX} characters.
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
      <output className="block text-sm">
        {sent ? 'Saved. The ad now shows "Changes requested".' : ''}
      </output>
      <Button type="submit" className="h-12 self-start px-6" disabled={send.isPending}>
        {send.isPending ? 'Saving…' : 'Save the request'}
      </Button>
    </form>
  )
}

function Requests({ ad, version, isCurrent }: { ad: Ad; version: AdVersion; isCurrent: boolean }) {
  const requests = ad.ad_requests
    .filter((r) => r.version_id === version.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <section
      aria-labelledby="requests-heading"
      className="bg-background flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id="requests-heading" className="text-base font-medium">
        Change requests on version {version.version}
      </h2>
      {requests.length === 0 ? (
        <p className="text-muted-foreground text-sm">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => (
            <RequestItem key={r.id} request={r} />
          ))}
        </ul>
      )}
      {isCurrent && ad.status !== 'archived' ? (
        <RequestForm ad={ad} />
      ) : (
        <p className="text-muted-foreground text-sm">
          {ad.status === 'archived'
            ? 'This ad is archived.'
            : 'Changes are asked for on the current version.'}
        </p>
      )}
    </section>
  )
}

function AdView({ ad }: { ad: Ad }) {
  const current = latestVersion(ad)
  const versions = [...ad.ad_versions].sort((a, b) => b.version - a.version)
  const [chosen, setChosen] = useState<number | null>(null)
  const version = versions.find((v) => v.version === chosen) ?? current
  const isCurrent = version?.id === current?.id
  const creative = ad.campaign_creatives
  const link =
    creative?.campaigns &&
    campaignLink({
      siteUrl: SITE_URL,
      source: creative.campaigns.utm_source,
      medium: creative.campaigns.utm_medium,
      campaign: creative.campaigns.slug,
      content: creative.slug,
      route: creative.campaigns.landing_route,
    })
  if (!version) return <p className="text-muted-foreground">This ad has no versions yet.</p>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-section text-ink font-medium">{ad.name}</h1>
        <StatusBadge status={ad.status} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="version" className="text-sm font-medium">
          Version
        </label>
        <NativeSelect
          id="version"
          className="h-12 w-full text-base sm:w-72"
          value={version.version}
          onChange={(e) => setChosen(Number(e.target.value))}
        >
          {versions.map((v) => (
            <NativeSelectOption key={v.id} value={v.version}>
              Version {v.version}
              {v.id === current?.id ? ' (current)' : ''} · {formatDateTime(v.created_at)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {!isCurrent && (
          <p className="text-muted-foreground text-sm">
            You are looking at an older version. It stays viewable and downloadable.
          </p>
        )}
      </div>
      <Sizes key={version.id} ad={ad} version={version} />
      <Review ad={ad} version={version} isCurrent={isCurrent} />
      <Requests ad={ad} version={version} isCurrent={isCurrent} />
      <section
        aria-labelledby="words-heading"
        className="bg-background flex flex-col gap-3 rounded-md border p-4"
      >
        <h2 id="words-heading" className="text-base font-medium">
          Words for the post
        </h2>
        <CopyRow label="Caption" value={version.caption} />
        <CopyRow label="Headline" value={version.headline} />
        <CopyRow label="Button label" value={version.button_label} />
      </section>
      <section
        aria-labelledby="link-heading"
        className="bg-background flex flex-col gap-2 rounded-md border p-4"
      >
        <h2 id="link-heading" className="text-base font-medium">
          Link for the ad
        </h2>
        {link ? (
          <>
            <p className="text-muted-foreground text-sm">
              Tagged for {creative?.campaigns?.name}, creative {creative?.label}, so enquiries are
              counted against this ad.
            </p>
            <CopyRow label="Link" value={link} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            This ad is not linked to a campaign creative, so there is no tagged link. Make one in
            Settings, Campaigns, and use that link in the ad.
          </p>
        )}
      </section>
    </div>
  )
}

export function AdPage() {
  const { id = '' } = useParams()
  const ad = useAd(id)
  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/ads"
        className="text-primary inline-flex min-h-12 items-center gap-1 text-sm underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All ads
      </Link>
      {ad.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : ad.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Could not load this ad. Please try again.</AlertDescription>
        </Alert>
      ) : !ad.data ? (
        <p className="text-muted-foreground">There is no such ad.</p>
      ) : (
        <AdView ad={ad.data} />
      )}
    </div>
  )
}
