import { describe, expect, it } from 'vitest'
import { parseAttribution } from './attribution'
import {
  campaignLink,
  costRows,
  formatCost,
  parseEuro,
  slugify,
  SLUG,
  type CampaignCost,
} from './campaigns'
import type { FunnelRow } from './funnel'

const row = (campaign: string, enquiries: number, booked: number, won: number): FunnelRow => ({
  campaign,
  enquiries,
  booked,
  attended: 0,
  won,
  cancelled: 0,
  no_shows: 0,
  won_value: 0,
})

describe('campaign links', () => {
  it('makes slugs the database accepts', () => {
    expect(slugify('  Spring Kitchens — Café 2027! ')).toBe('spring-kitchens-cafe-2027')
    expect(SLUG.test(slugify('Spring Kitchens 2027'))).toBe(true)
    expect(slugify('!!!')).toBe('')
  })

  it('builds a link the attribution code reads back exactly', () => {
    const link = campaignLink({
      siteUrl: 'https://book.q3interiors.ie',
      source: 'instagram',
      medium: 'paid_social',
      campaign: 'spring-kitchens',
      content: 'reel-1',
      route: '/enquire',
    })
    expect(link).toBe(
      'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid_social&utm_campaign=spring-kitchens&utm_content=reel-1#/enquire',
    )
    const url = new URL(link)
    const parsed = parseAttribution(
      { search: url.search, hash: url.hash },
      new Date('2027-03-01T10:00:00Z'),
    )
    expect(parsed).toMatchObject({
      utm_source: 'instagram',
      utm_medium: 'paid_social',
      utm_campaign: 'spring-kitchens',
      utm_content: 'reel-1',
      landing_path: '/enquire',
    })
  })

  it('leaves utm_content out when no creative is chosen', () => {
    expect(
      campaignLink({
        siteUrl: 'https://x.ie',
        source: 'instagram',
        medium: 'paid_social',
        campaign: 'a',
        route: '/',
      }),
    ).toBe('https://x.ie/?utm_source=instagram&utm_medium=paid_social&utm_campaign=a#/')
  })
})

describe('campaign costs', () => {
  const costs: CampaignCost[] = [
    { campaign: 'spring', name: 'Spring kitchens', spend_cents: 30000, spend_entries: 2 },
    { campaign: 'summer', name: 'Summer', spend_cents: 0, spend_entries: 0 },
    { campaign: 'autumn', name: 'Autumn', spend_cents: 5000, spend_entries: 1 },
  ]

  it('divides spend by enquiries, bookings and wins', () => {
    const [spring] = costRows([row('spring', 12, 4, 1)], costs)
    expect(spring).toMatchObject({
      name: 'Spring kitchens',
      spendCents: 30000,
      perEnquiry: 2500,
      perBooked: 7500,
      perWon: 30000,
    })
  })

  it('shows "no spend entered" rather than zero cost', () => {
    const rows = costRows([row('summer', 5, 1, 0)], costs)
    expect(rows[0]).toMatchObject({ spendCents: null, perEnquiry: null })
    expect(formatCost(rows[0]?.perEnquiry ?? null, rows[0]?.spendCents ?? null, 5)).toBe(
      'No spend entered',
    )
  })

  it('has no cost per win when nothing is won yet', () => {
    const [spring] = costRows([row('spring', 3, 0, 0)], costs)
    expect(spring?.perBooked).toBeNull()
    expect(formatCost(spring?.perBooked ?? null, spring?.spendCents ?? null, 0)).toBe('None yet')
    expect(formatCost(spring?.perEnquiry ?? null, spring?.spendCents ?? null, 3)).toBe('€100.00')
  })

  it('keeps raw tags that match no campaign, and lists campaigns with spend but no enquiries', () => {
    const rows = costRows([row('ig-story-test', 2, 0, 0), row('(unknown)', 4, 1, 0)], costs)
    expect(rows.find((r) => r.campaign === 'ig-story-test')).toMatchObject({
      name: null,
      spendCents: null,
    })
    expect(rows.find((r) => r.campaign === '(unknown)')?.name).toBeNull()
    expect(rows.find((r) => r.campaign === 'autumn')).toMatchObject({
      enquiries: 0,
      spendCents: 5000,
      perEnquiry: null,
    })
    expect(rows.find((r) => r.campaign === 'summer')).toBeUndefined()
  })

  it('reads euro amounts as cents', () => {
    expect(parseEuro('125.5')).toBe(12550)
    expect(parseEuro('€1,250')).toBe(125000)
    expect(parseEuro('12.345')).toBeNull()
    expect(parseEuro('0')).toBeNull()
    expect(parseEuro('abc')).toBeNull()
  })
})
