import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { adStatusLabel, useAdFileUrl, useAds, useArchiveAd, type AdListItem } from '@/api/ads'
import { useCampaigns, useSpend, type Campaign } from '@/api/campaigns'
import { usePilotReport, usePilotReportByContent } from '@/api/pilot'
import { CampaignSpend } from '@/components/staff/campaign-spend'
import { chip } from '@/components/staff/chips'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  byCampaign,
  campaignDates,
  costPerEnquiry,
  countText,
  numbersOf,
  rankAds,
  spendSoFar,
  WALK_KEY,
  NO_NUMBERS,
  type AdNumbers,
  type Placed,
} from '@/lib/ads/by-campaign'
import {
  AD_FILTERS,
  adListPath,
  groupAds,
  matchesAdFilter,
  readAdFilter,
  thumbnailPath,
  type AdFilter,
} from '@/lib/ads/screens'
import { formatDayMonth, irishDayKey } from '@/lib/format'
import type { PilotRow } from '@/lib/pilot'

// The Ads page by campaign: which campaign published which ads, how each did (best first), and,
// on each ad's page, the enquiries it brought. Ads not in a campaign are listed last by set.

const currentOf = (ad: AdListItem) => [...ad.ad_versions].sort((a, b) => b.version - a.version)[0]

type Selection = {
  selecting: boolean
  selected: Set<string>
  toggle: (id: string) => void
  /** Each group tells the page the order it shows, so the ad page can walk it. */
  register: (group: string, ids: string[]) => void
  /** Store the order on screen before an ad is opened. */
  remember: () => void
}

function AdRow({
  ad,
  filter,
  running,
  numbers,
  selection,
}: {
  ad: AdListItem
  filter: AdFilter
  running: boolean
  /** Null: not in a campaign, so no numbers. Undefined: still loading. */
  numbers: AdNumbers | null | undefined
  selection: Selection
}) {
  const current = currentOf(ad)
  const thumb = useAdFileUrl(thumbnailPath(current?.ad_variants ?? []))
  const selected = selection.selected.has(ad.id)
  const body = (
    <>
      <span className="relative block aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-md bg-black">
        {thumb.url ? (
          <img src={thumb.url} alt="" className="size-full object-cover" />
        ) : thumb.isPending ? (
          <Skeleton className="size-full rounded-none" />
        ) : null}
        {selection.selecting && (
          <span
            aria-hidden="true"
            className={`absolute top-1 left-1 flex size-6 items-center justify-center rounded-md border-2 border-white ${
              selected ? 'bg-white text-black' : 'bg-black/40'
            }`}
          >
            {selected && <Check className="size-4" />}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-2 text-sm leading-snug font-medium">{ad.name}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={ad.status === 'new' ? 'default' : 'outline'}>
            {adStatusLabel(ad.status)}
          </Badge>
          {running && <Badge variant="secondary">Running</Badge>}
          {current && current.version > 1 && (
            <span className="text-muted-foreground text-xs">Version {current.version}</span>
          )}
        </span>
        {numbers === undefined ? (
          <Skeleton className="h-4 w-40" />
        ) : numbers === null ? null : (
          <span className="text-muted-foreground text-xs tabular-nums">
            {numbers.visits === null ? 'Visits not counted' : `${numbers.visits} visits`} ·{' '}
            {numbers.enquiries} {numbers.enquiries === 1 ? 'enquiry' : 'enquiries'} ·{' '}
            {numbers.booked} booked · {numbers.won} won
          </span>
        )}
      </span>
    </>
  )
  const row = 'flex min-h-16 items-start gap-3 rounded-md p-1.5'
  if (selection.selecting)
    return (
      <label
        className={`${row} has-[:focus-visible]:outline-action cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid`}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={selected}
          onChange={() => selection.toggle(ad.id)}
        />
        {body}
      </label>
    )
  return (
    <Link
      to={`/ads/${ad.id}?show=${filter}`}
      onClick={selection.remember}
      className={`${row} hover:bg-soft`}
    >
      {body}
    </Link>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-base font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** Spend so far, its days and cost per enquiry: admins only (spend is admin-only data). */
function useCampaignSpend(campaignId: string, isAdmin: boolean) {
  const spend = useSpend(campaignId, isAdmin)
  if (!isAdmin) return null
  const rows = spend.data ?? []
  return {
    pending: spend.isPending,
    cents: rows.length ? rows.reduce((s, r) => s + r.amount_cents, 0) : null,
    days: rows.map((r) => r.spent_on),
  }
}

function CampaignSection({
  campaign,
  placed,
  total,
  totalsFailed,
  range,
  filter,
  isAdmin,
  focused,
  selection,
}: {
  campaign: Campaign
  placed: Placed<AdListItem>[]
  total: PilotRow | undefined
  totalsFailed: boolean
  range: { from: string; to: string; ready: boolean }
  filter: AdFilter
  isAdmin: boolean
  focused: boolean
  selection: Selection
}) {
  const byContent = usePilotReportByContent(range.from, range.to, campaign.slug, range.ready)
  const spend = useCampaignSpend(campaign.id, isAdmin)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start' })
  }, [focused])
  const rows = new Map((byContent.data?.rows ?? []).map((r) => [r.key, r]))
  const ranked = rankAds(placed, (slug) =>
    byContent.data ? numbersOf(slug ? rows.get(slug) : undefined) : NO_NUMBERS,
  )
  const shown = ranked.filter((p) => matchesAdFilter(p.ad.status, filter))
  const order = shown.map((p) => p.ad.id).join(',')
  const { register } = selection
  useEffect(
    () => register(campaign.id, order ? order.split(',') : []),
    [register, campaign.id, order],
  )
  const running = placed.filter((p) => p.running && p.ad.status !== 'archived').length
  const live = placed.filter((p) => p.ad.status !== 'archived').length
  const totals = numbersOf(total)
  // A total, "…" while loading, "Not loaded" when the report failed (said once above the list).
  const shown_ = (value: () => string) => (total ? value() : totalsFailed ? 'Not loaded' : '…')
  const headingId = `campaign-${campaign.id.slice(0, 8)}`
  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      className="bg-background flex scroll-mt-4 flex-col gap-3 rounded-md border p-3"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-title text-ink font-medium">
            {campaign.name}
          </h2>
          {running > 0 && (
            <Badge variant="secondary">
              {running} of {live} running
            </Badge>
          )}
          {campaign.archived_at && <Badge variant="outline">Archived</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          {campaignDates(campaign.created_at, spend?.days ?? null, formatDayMonth)}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="Visits" value={shown_(() => countText(totals.visits))} />
        <Stat label="Enquiries" value={shown_(() => String(totals.enquiries))} />
        <Stat label="Booked" value={shown_(() => String(totals.booked))} />
        <Stat label="Quoted" value={shown_(() => String(totals.quoted))} />
        <Stat label="Won" value={shown_(() => String(totals.won))} />
        {spend && (
          <Stat
            label="Per enquiry"
            value={
              spend.pending ? '…' : shown_(() => costPerEnquiry(spend.cents, totals.enquiries))
            }
          />
        )}
      </dl>
      <p className="text-muted-foreground text-xs">
        Best first: most enquiries, then most booked. Numbers are from the ad links, since the first
        ad was made.
      </p>
      {placed.length === 0 ? (
        <p className="text-muted-foreground text-sm">No ads in this campaign yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          None of its ads are here.
          {filter !== 'live' && (
            <>
              {' '}
              <Link to={adListPath('live')} className="text-action underline">
                Show live ads
              </Link>
            </>
          )}
        </p>
      ) : (
        <ul className="-mx-1.5 flex flex-col">
          {shown.map((p) => (
            <li key={p.ad.id} className="border-t first:border-t-0">
              <AdRow
                ad={p.ad}
                filter={filter}
                running={p.running}
                numbers={byContent.data ? p.numbers : byContent.isError ? null : undefined}
                selection={selection}
              />
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <details open={focused} className="group -mx-3 -mb-3 border-t">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
            <span className="font-medium">Spend</span>
            <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-right text-sm">
              <span className="min-w-0 break-words">
                {spend?.pending
                  ? '…'
                  : spend?.cents == null
                    ? 'None entered'
                    : spendSoFar(spend.cents)}
              </span>
              <ChevronRight
                className="size-4 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </span>
          </summary>
          <div className="border-t p-3">
            <CampaignSpend campaignId={campaign.id} />
          </div>
        </details>
      )}
    </section>
  )
}

function SelectBar({
  ads,
  selected,
  filter,
  onDone,
}: {
  ads: AdListItem[]
  selected: Set<string>
  filter: AdFilter
  onDone: (message: string) => void
}) {
  const archive = useArchiveAd()
  const [busy, setBusy] = useState(false)
  const chosen = ads.filter((a) => selected.has(a.id))
  // In Archived, the action brings ads back; everywhere else it archives.
  const bringBack = filter === 'archived'
  const run = async () => {
    setBusy(true)
    let done = 0
    let failed = 0
    for (const ad of chosen) {
      try {
        await archive.mutateAsync({ adId: ad.id, archived: !bringBack })
        done += 1
      } catch {
        failed += 1
      }
    }
    setBusy(false)
    const what = done === 1 ? '1 ad' : `${done} ads`
    onDone(
      `${bringBack ? 'Brought back' : 'Archived'} ${what}.` +
        (failed ? ` ${failed} could not be changed; try again.` : '') +
        (bringBack || done === 0 ? '' : ' Find them under Archived.'),
    )
  }
  return (
    <div className="bg-background sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t px-4 py-3">
      <span className="text-sm" aria-live="polite">
        {chosen.length} selected
      </span>
      <Button
        className="h-12 px-6"
        disabled={chosen.length === 0 || busy}
        onClick={() => void run()}
      >
        {busy
          ? 'Working…'
          : `${bringBack ? 'Bring back' : 'Archive'} ${chosen.length || ''}`.trim()}
      </Button>
    </div>
  )
}

export function AdsPage() {
  const me = useCurrentStaff()
  const isAdmin = me.role === 'admin'
  const ads = useAds()
  const campaigns = useCampaigns()
  const [params, setParams] = useSearchParams()
  const filter = readAdFilter(`?${params.toString()}`)
  const focus = params.get('campaign')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const all = ads.data ?? []
  const shown = all.filter((ad) => matchesAdFilter(ad.status, filter))
  // The numbers run from the day the first ad was made to today (Irish days).
  const [to] = useState(() => irishDayKey(Date.now()))
  const from = ads.data
    ? all.reduce((m, a) => {
        const day = irishDayKey(a.created_at)
        return day < m ? day : m
      }, to)
    : ''

  const report = usePilotReport(from, to)
  const totals = new Map(
    (report.data?.rows ?? []).filter((r) => r.dim === 'campaign').map((r) => [r.key, r]),
  )
  const groups = byCampaign(all)
  const listed = (campaigns.data ?? []).filter(
    (c) =>
      !c.archived_at || (groups.get(c.id) ?? []).some((p) => matchesAdFilter(p.ad.status, filter)),
  )
  const known = new Set(listed.map((c) => c.id))
  // Not in a campaign: no creative, or a campaign this list does not show.
  const loose = groupAds(
    [...groups.entries()]
      .filter(([id]) => id === null || !known.has(id))
      .flatMap(([, list]) => list.map((p) => p.ad))
      .filter((ad) => matchesAdFilter(ad.status, filter)),
  )
  // The order on screen, by group, for Previous / Next on the ad page (kept per tab).
  const orders = useRef(new Map<string, string[]>())
  const [register] = useState(() => (group: string, ids: string[]) => {
    orders.current.set(group, ids)
  })
  const looseIds = loose.flatMap((g) => g.ads.map((a) => a.id)).join(',')
  useEffect(() => register('', looseIds ? looseIds.split(',') : []), [register, looseIds])
  const remember = () => {
    const ids = [...listed.map((c) => c.id), ''].flatMap((key) => orders.current.get(key) ?? [])
    try {
      sessionStorage.setItem(WALK_KEY, JSON.stringify({ filter, ids }))
    } catch {
      // No storage: the ad page walks the default order.
    }
  }
  const reviewCount = all.filter((ad) => matchesAdFilter(ad.status, 'review')).length
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const selection: Selection = {
    register,
    remember,
    selecting,
    selected,
    toggle: (id) =>
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
  }
  const loading = ads.isPending || campaigns.isPending
  const failed = ads.isError || campaigns.isError
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-section text-ink font-medium">Ads</h1>
        {isAdmin && shown.length > 0 && (
          <Button
            variant="outline"
            className="h-12"
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : (setSelecting(true), setMessage('')))}
          >
            {selecting ? 'Cancel' : 'Select'}
          </Button>
        )}
      </div>
      <fieldset className="min-w-0">
        <legend className="sr-only">Show</legend>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {AD_FILTERS.map(([key, label]) => (
            <label key={key} className={chip}>
              <input
                type="radio"
                name="ads-filter"
                className="sr-only"
                checked={filter === key}
                onChange={() => {
                  setParams(key === 'live' ? {} : { show: key }, { replace: true })
                  stopSelecting()
                }}
              />
              {label}
              {key === 'review' && ads.data && ` (${reviewCount})`}
            </label>
          ))}
        </div>
      </fieldset>
      <output className="block text-sm">{message}</output>
      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : failed ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Could not load the ads.{' '}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void Promise.all([ads.refetch(), campaigns.refetch()])}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : all.length === 0 && listed.length === 0 ? (
        <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
          No ads yet. They appear here when one is published from the ad studio.
        </p>
      ) : (
        <>
          {report.isError && (
            <p role="alert" className="text-destructive text-sm">
              Could not load the numbers.{' '}
              <Button variant="outline" size="sm" onClick={() => void report.refetch()}>
                Try again
              </Button>
            </p>
          )}
          {listed.map((c) => (
            <CampaignSection
              key={c.id}
              campaign={c}
              placed={groups.get(c.id) ?? []}
              total={totals.get(c.slug) ?? (report.data ? numbersRow(c.slug) : undefined)}
              totalsFailed={report.isError}
              range={{ from, to, ready: from !== '' }}
              filter={filter}
              isAdmin={isAdmin}
              focused={focus === c.id}
              selection={selection}
            />
          ))}
          {loose.length > 0 && (
            <section aria-labelledby="loose-heading" className="flex flex-col gap-2">
              <h2 id="loose-heading" className="text-base font-medium">
                Not in a campaign
              </h2>
              {loose.map((group) => (
                <div key={group.set} className="flex flex-col">
                  <h3 className="text-muted-foreground text-sm">{group.set}</h3>
                  <ul className="-mx-1.5 flex flex-col">
                    {group.ads.map((ad) => (
                      <li key={ad.id} className="border-t first:border-t-0">
                        <AdRow
                          ad={ad}
                          filter={filter}
                          running={false}
                          numbers={null}
                          selection={selection}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          {listed.length === 0 && loose.length === 0 && (
            <p className="bg-background text-muted-foreground rounded-md border p-6 text-center">
              No ads here.
            </p>
          )}
        </>
      )}
      {selecting && ads.data && (
        <SelectBar
          ads={shown}
          selected={selected}
          filter={filter}
          onDone={(text) => {
            setMessage(text)
            stopSelecting()
          }}
        />
      )}
    </div>
  )
}

/** A campaign with nothing in the report yet: every count zero. */
function numbersRow(slug: string): PilotRow {
  return {
    dim: 'campaign',
    key: slug,
    sessions: 0,
    chose: 0,
    saved: 0,
    booked: 0,
    attended: 0,
    suitable_attended: 0,
    chased: 0,
    quoted: 0,
    won: 0,
    won_value: 0,
    median_to_saved_seconds: null,
    median_to_booked_seconds: null,
  }
}
