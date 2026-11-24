// Campaign links and campaign costs: pure functions, unit-tested.
import type { FunnelRow } from './funnel'

/** Lower-case words joined by hyphens, the shape the database accepts for utm slugs. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

export type LinkParts = {
  siteUrl: string
  source: string
  medium: string
  campaign: string
  /** Creative label slug (utm_content); optional. */
  content?: string | null
  route: '/' | '/enquire'
}

/**
 * The tagged link, with the tags before the `#`: the form src/lib/attribution.ts reads first and
 * that survives Instagram's in-app browser.
 */
export function campaignLink(parts: LinkParts): string {
  const params = new URLSearchParams({
    utm_source: parts.source,
    utm_medium: parts.medium,
    utm_campaign: parts.campaign,
  })
  if (parts.content) params.set('utm_content', parts.content)
  return `${parts.siteUrl}/?${params.toString()}#${parts.route}`
}

export type CampaignCost = {
  campaign: string
  name: string
  spend_cents: number
  spend_entries: number
}

export type CostRow = FunnelRow & {
  /** The campaign's name when the tag matches one; null for a raw tag. */
  name: string | null
  /** Null when no spend was entered for the range: unknown, never zero. */
  spendCents: number | null
  perEnquiry: number | null
  perBooked: number | null
  perWon: number | null
}

const per = (spend: number | null, count: number) =>
  spend === null || count === 0 ? null : Math.round(spend / count)

/**
 * Joins the funnel (by utm_campaign) with spend (by campaign slug). A campaign with spend but no
 * enquiries in the range still appears (all costs are then "no enquiries"). Tags that match no
 * campaign keep their raw tag and show no spend.
 */
export function costRows(funnel: FunnelRow[], costs: CampaignCost[]): CostRow[] {
  const bySlug = new Map(costs.map((c) => [c.campaign, c]))
  const rows: CostRow[] = funnel.map((row) => {
    const cost = bySlug.get(row.campaign)
    const spend = cost && cost.spend_entries > 0 ? cost.spend_cents : null
    return {
      ...row,
      name: cost?.name ?? null,
      spendCents: spend,
      perEnquiry: per(spend, row.enquiries),
      perBooked: per(spend, row.booked),
      perWon: per(spend, row.won),
    }
  })
  for (const cost of costs) {
    if (cost.spend_entries > 0 && !funnel.some((r) => r.campaign === cost.campaign)) {
      rows.push({
        campaign: cost.campaign,
        name: cost.name,
        enquiries: 0,
        booked: 0,
        attended: 0,
        won: 0,
        cancelled: 0,
        no_shows: 0,
        won_value: 0,
        spendCents: cost.spend_cents,
        perEnquiry: null,
        perBooked: null,
        perWon: null,
      })
    }
  }
  return rows
}

const euroCents = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

export function formatEuroCents(cents: number): string {
  return euroCents.format(cents / 100)
}

/** "€12.50", or why there is no figure. */
export function formatCost(cents: number | null, spend: number | null, count: number): string {
  if (spend === null) return 'No spend entered'
  if (count === 0) return 'None yet'
  return cents === null ? '–' : formatEuroCents(cents)
}

/** "125.50" or "125" -> cents; null when it is not a sensible euro amount. */
export function parseEuro(text: string): number | null {
  const cleaned = text.replace(/[€\s,]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const cents = Math.round(Number(cleaned) * 100)
  return cents >= 1 && cents <= 100_000_000 ? cents : null
}
