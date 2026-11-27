// The Ads page by campaign: which campaign published which ads, how each did, best first. Pure, so
// it is tested without a browser. Numbers come from the pilot report (`pilot_report` for the
// campaign totals, `pilot_report_by_content` for each ad by its utm_content).
import { formatEuroCents } from '../campaigns'
import type { PilotRow } from '../pilot'

export type AdNumbers = {
  /** Landing visits; null when not counted (before counting began). */
  visits: number | null
  enquiries: number
  booked: number
  quoted: number
  won: number
}

export const NO_NUMBERS: AdNumbers = { visits: 0, enquiries: 0, booked: 0, quoted: 0, won: 0 }

export function numbersOf(row: PilotRow | undefined): AdNumbers {
  if (!row) return NO_NUMBERS
  return {
    visits: row.sessions,
    enquiries: row.saved,
    booked: row.booked,
    quoted: row.quoted,
    won: row.won,
  }
}

type Creative = { id: string; slug: string; running: boolean; campaign_id: string } | null

export type Placed<T> = { campaignId: string | null; slug: string | null; running: boolean; ad: T }

/** Ads by campaign (through their creative); the rest under null ("Not in a campaign"). */
export function byCampaign<T extends { campaign_creatives: Creative }>(
  ads: T[],
): Map<string | null, Placed<T>[]> {
  const out = new Map<string | null, Placed<T>[]>()
  for (const ad of ads) {
    const c = ad.campaign_creatives
    const key = c?.campaign_id ?? null
    out.set(key, [
      ...(out.get(key) ?? []),
      { campaignId: key, slug: c?.slug ?? null, running: c?.running ?? false, ad },
    ])
  }
  return out
}

/**
 * Best first: most enquiries, then most booked, then most visits; ties keep the order given
 * (set position). This is the order the page says it uses.
 */
export function rankAds<T>(
  placed: Placed<T>[],
  numbers: (slug: string | null) => AdNumbers,
): (Placed<T> & { numbers: AdNumbers })[] {
  return placed
    .map((p, i) => ({ ...p, numbers: numbers(p.slug), i }))
    .sort(
      (a, b) =>
        b.numbers.enquiries - a.numbers.enquiries ||
        b.numbers.booked - a.numbers.booked ||
        (b.numbers.visits ?? 0) - (a.numbers.visits ?? 0) ||
        a.i - b.i,
    )
    .map(({ i: _i, ...rest }) => rest)
}

/**
 * Cost per enquiry: "€7.50", "No enquiries yet" with spend and none, and "Unknown" when no spend
 * has been entered (never "€0").
 */
export function costPerEnquiry(spendCents: number | null, enquiries: number): string {
  if (spendCents === null) return 'Unknown'
  if (enquiries === 0) return 'No enquiries yet'
  return formatEuroCents(Math.round(spendCents / enquiries))
}

/** "€210.00 so far", or "Unknown" when no spend has been entered. */
export function spendSoFar(spendCents: number | null): string {
  return spendCents === null ? 'Unknown' : `${formatEuroCents(spendCents)} so far`
}

/**
 * The campaign's dates: when it was set up, and (admins) the first and last day with spend:
 * "Set up 27 Nov · Spend 1 Dec to 14 Dec".
 */
export function campaignDates(
  setUp: string,
  spendDays: string[] | null,
  dayMonth: (iso: string) => string,
): string {
  const parts = [`Set up ${dayMonth(setUp)}`]
  const days = [...(spendDays ?? [])].sort()
  const first = days[0]
  const last = days[days.length - 1]
  if (first && last)
    parts.push(
      first === last
        ? `Spend on ${dayMonth(`${first}T12:00:00Z`)}`
        : `Spend ${dayMonth(`${first}T12:00:00Z`)} to ${dayMonth(`${last}T12:00:00Z`)}`,
    )
  return parts.join(' · ')
}

/** A count, or "Not counted" for visits before counting began. */
export function countText(n: number | null): string {
  return n === null ? 'Not counted' : String(n)
}

/** utm_campaign and utm_content from an ad's link, for an ad not (yet) in a campaign. */
export function tagsFromLink(link: string | null): { campaign: string; content: string } | null {
  if (!link) return null
  try {
    const params = new URL(link).searchParams
    const campaign = params.get('utm_campaign')
    const content = params.get('utm_content')
    return campaign && content ? { campaign, content } : null
  } catch {
    return null
  }
}
