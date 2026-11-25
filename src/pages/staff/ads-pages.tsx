import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link, useParams } from 'react-router'
import {
  AD_STATUS_LABELS,
  downloadAdFile,
  latestVersion,
  useAd,
  useAdHtml,
  useAds,
  type Ad,
  type AdVariant,
} from '@/api/ads'
import { AdFrame } from '@/components/staff/ad-frame'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { campaignLink } from '@/lib/campaigns'
import { exportFilename, PLACEMENTS } from '@/lib/ads/spec'
import { formatDateTime } from '@/lib/format'
import { SITE_URL } from '../../../supabase/functions/_shared/site.ts'

function StatusBadge({ status }: { status: Ad['status'] }) {
  return (
    <Badge variant={status === 'new' ? 'default' : 'outline'}>{AD_STATUS_LABELS[status]}</Badge>
  )
}

export function AdsPage() {
  const ads = useAds()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-section text-ink font-medium">Ads</h1>
      <p className="text-muted-foreground -mt-2 text-sm">
        Instagram ads built in the ad studio. Open one to see it at its real size, download the
        image and copy the words for the post.
      </p>
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
      ) : ads.data.length === 0 ? (
        <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
          No ads yet. They appear here when one is published from the ad studio.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ads.data.map((ad) => (
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
                    Version {Math.max(1, ...ad.ad_versions.map((v) => v.version))} ·{' '}
                    {formatDateTime(ad.created_at)}
                  </span>
                </span>
                <ChevronRight
                  className="text-muted-foreground size-5 shrink-0"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
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

function SizeView({ ad, version, variant }: { ad: Ad; version: number; variant: AdVariant }) {
  const html = useAdHtml(variant.html_path)
  const p = PLACEMENTS[variant.size]
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const filename = exportFilename(ad.name, version, p)
  const download = async () => {
    setState('busy')
    try {
      const blob = await downloadAdFile(variant.export_path)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.append(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setState('idle')
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {p.where}: {variant.width} x {variant.height} pixels, shown here scaled down.
        {variant.size === 'vertical' &&
          ' Instagram covers roughly the top 14% and the bottom 35% with its own buttons.'}
      </p>
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
            title={`${ad.name}, ${p.label}`}
          />
        )}
      </div>
      <Button
        className="h-12 self-start px-6"
        onClick={() => void download()}
        disabled={state === 'busy'}
      >
        {state === 'busy' ? 'Preparing…' : `Download the image (${p.label})`}
      </Button>
      <output className="text-sm">
        {state === 'failed' ? 'The download did not work. Please try again.' : ''}
      </output>
    </div>
  )
}

function AdView({ ad }: { ad: Ad }) {
  const version = latestVersion(ad)
  const variants = [...(version?.ad_variants ?? [])].sort(
    (a, b) =>
      ['portrait', 'vertical', 'square'].indexOf(a.size) -
      ['portrait', 'vertical', 'square'].indexOf(b.size),
  )
  const [tab, setTab] = useState(variants[0]?.size ?? 'portrait')
  const current = variants.find((v) => v.size === tab) ?? variants[0]
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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-section text-ink font-medium">{ad.name}</h1>
        <StatusBadge status={ad.status} />
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">
        Version {version?.version ?? 1} · {formatDateTime(version?.created_at ?? ad.created_at)}
        {ad.created_by_name ? ` · ${ad.created_by_name}` : ''}
      </p>
      {current && version ? (
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
      ) : (
        <p className="text-muted-foreground">This ad has no sizes yet.</p>
      )}
      {version && (
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
      )}
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
