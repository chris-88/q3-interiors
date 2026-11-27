import { Link } from 'react-router'
import { latestVersion, useSetRunning, type Ad } from '@/api/ads'
import { useEnquiriesFromAd } from '@/api/enquiries'
import { enquiryName } from '@/components/staff/enquiry-text'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { useLoadedAt } from '@/components/staff/use-loaded-at'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { tagsFromLink } from '@/lib/ads/by-campaign'
import { stageOf } from '@/lib/enquiry-stage'
import { formatDayMonth } from '@/lib/format'

/** The campaign and content tags that tie enquiries to this ad: its creative, else its link. */
export function adTags(ad: Ad): { campaign: string; content: string } | null {
  const creative = ad.campaign_creatives
  if (creative?.campaigns) return { campaign: creative.campaigns.slug, content: creative.slug }
  return tagsFromLink(latestVersion(ad)?.link_url ?? null)
}

/** Its campaign, and whether it is running there (admins change it; staff see it). */
export function AdCampaign({ ad }: { ad: Ad }) {
  const me = useCurrentStaff()
  const set = useSetRunning()
  const creative = ad.campaign_creatives
  if (!creative?.campaigns) return null
  const running = creative.running
  return (
    <section
      aria-labelledby="campaign-heading"
      className="bg-background flex flex-col gap-2 rounded-md border px-3 py-3"
    >
      <h2 id="campaign-heading" className="text-base font-medium">
        Campaign: {creative.campaigns.name}
      </h2>
      <p className="text-sm">{running ? 'Running in this campaign.' : 'Not marked as running.'}</p>
      {me.role === 'admin' && ad.status !== 'archived' && (
        <Button
          variant="outline"
          className="h-12 self-start"
          disabled={set.isPending}
          onClick={() => set.mutate({ creativeId: creative.id, running: !running })}
        >
          {set.isPending ? 'Saving…' : running ? 'Mark as not running' : 'Mark as running'}
        </Button>
      )}
      {set.isError && (
        <p role="alert" className="text-destructive text-sm">
          Not saved. Please try again.
        </p>
      )}
    </section>
  )
}

/** Enquiries whose attribution matches this ad's campaign and content, newest first. */
export function EnquiriesFromAd({ ad }: { ad: Ad }) {
  const tags = adTags(ad)
  const enquiries = useEnquiriesFromAd(tags)
  const now = useLoadedAt(enquiries.dataUpdatedAt)
  return (
    <section
      aria-labelledby="from-ad-heading"
      className="bg-background flex flex-col gap-1 rounded-md border px-3 py-3"
    >
      <h2 id="from-ad-heading" className="text-base font-medium">
        Enquiries from this ad
      </h2>
      {tags === null ? (
        <p className="text-muted-foreground text-sm">
          This ad has no campaign link, so no enquiry can be traced to it.
        </p>
      ) : enquiries.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : enquiries.isError ? (
        <p role="alert" className="text-destructive text-sm">
          Could not load them.{' '}
          <Button variant="outline" size="sm" onClick={() => void enquiries.refetch()}>
            Try again
          </Button>
        </p>
      ) : enquiries.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">None yet.</p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {enquiries.data.map((e) => (
            <li key={e.id} className="border-t first:border-t-0">
              <Link
                to={`/enquiries/${e.id}`}
                className="hover:bg-soft flex min-h-12 items-center justify-between gap-3 px-1 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{enquiryName(e)}</span>
                  <span className="text-muted-foreground text-sm">
                    {formatDayMonth(e.submitted_at)}
                  </span>
                </span>
                <span className="shrink-0 text-sm">{stageOf(e, now).label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
