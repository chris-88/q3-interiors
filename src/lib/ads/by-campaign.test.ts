import { describe, expect, it } from 'vitest'
import {
  byCampaign,
  campaignDates,
  costPerEnquiry,
  countText,
  numbersOf,
  parseWalk,
  rankAds,
  walkIds,
  spendSoFar,
  tagsFromLink,
  NO_NUMBERS,
  type AdNumbers,
} from './by-campaign'
import type { PilotRow } from '../pilot'

const ad = (
  id: string,
  creative: { slug: string; campaign_id: string; running?: boolean } | null,
) => ({
  id,
  campaign_creatives: creative
    ? {
        id: `c-${id}`,
        slug: creative.slug,
        campaign_id: creative.campaign_id,
        running: creative.running ?? false,
      }
    : null,
})

describe('byCampaign', () => {
  it('groups ads by their creative’s campaign; the rest are not in a campaign', () => {
    const groups = byCampaign([
      ad('a', { slug: 'one', campaign_id: 'k1', running: true }),
      ad('b', null),
      ad('c', { slug: 'two', campaign_id: 'k1' }),
    ])
    expect(groups.get('k1')?.map((p) => [p.ad.id, p.slug, p.running])).toEqual([
      ['a', 'one', true],
      ['c', 'two', false],
    ])
    expect(groups.get(null)?.map((p) => p.ad.id)).toEqual(['b'])
  })
})

describe('rankAds', () => {
  it('best first: enquiries, then booked, then visits; ties keep the set order', () => {
    const placed = byCampaign([
      ad('quiet', { slug: 'quiet', campaign_id: 'k' }),
      ad('booker', { slug: 'booker', campaign_id: 'k' }),
      ad('asker', { slug: 'asker', campaign_id: 'k' }),
      ad('seen', { slug: 'seen', campaign_id: 'k' }),
      ad('also-quiet', { slug: 'also-quiet', campaign_id: 'k' }),
    ]).get('k')!
    const nums: Record<string, AdNumbers> = {
      booker: { visits: 40, enquiries: 2, booked: 2, quoted: 0, won: 0 },
      asker: { visits: 90, enquiries: 3, booked: 0, quoted: 0, won: 0 },
      seen: { visits: 120, enquiries: 0, booked: 0, quoted: 0, won: 0 },
    }
    const ranked = rankAds(placed, (slug) => nums[slug ?? ''] ?? NO_NUMBERS)
    expect(ranked.map((r) => r.ad.id)).toEqual(['asker', 'booker', 'seen', 'quiet', 'also-quiet'])
    expect(ranked[0]?.numbers.enquiries).toBe(3)
  })
})

describe('numbers and money', () => {
  it('reads a report row, and shows no row as zero', () => {
    const row = { sessions: null, saved: 2, booked: 1, quoted: 1, won: 0 } as PilotRow
    expect(numbersOf(row)).toEqual({ visits: null, enquiries: 2, booked: 1, quoted: 1, won: 0 })
    expect(numbersOf(undefined)).toEqual(NO_NUMBERS)
    expect(countText(null)).toBe('Not counted')
    expect(countText(0)).toBe('0')
  })
  it('is "Unknown" without spend, never zero', () => {
    expect(costPerEnquiry(null, 4)).toBe('Unknown')
    expect(costPerEnquiry(21000, 0)).toBe('No enquiries yet')
    expect(costPerEnquiry(21000, 4)).toBe('€52.50')
    expect(spendSoFar(null)).toBe('Unknown')
    expect(spendSoFar(21000)).toBe('€210.00 so far')
  })
})

describe('campaignDates', () => {
  const dm = (iso: string) => iso.slice(0, 10)
  it('says when it was set up, and the spend days when known', () => {
    expect(campaignDates('2026-11-27T10:00:00Z', null, dm)).toBe('Set up 2026-11-27')
    expect(campaignDates('2026-11-27T10:00:00Z', [], dm)).toBe('Set up 2026-11-27')
    expect(campaignDates('2026-11-27T10:00:00Z', ['2026-12-14', '2026-12-01'], dm)).toBe(
      'Set up 2026-11-27 · Spend 2026-12-01 to 2026-12-14',
    )
    expect(campaignDates('2026-11-27T10:00:00Z', ['2026-12-01'], dm)).toBe(
      'Set up 2026-11-27 · Spend on 2026-12-01',
    )
  })
})

describe('walking the list', () => {
  it('walks the stored order for the same filter when it holds the ad, else the default', () => {
    const stored = parseWalk(JSON.stringify({ filter: 'live', ids: ['k2', 'k1', 'x'] }))
    expect(walkIds(stored, 'live', 'k1', ['k1', 'k2', 'x'])).toEqual(['k2', 'k1', 'x'])
    expect(walkIds(stored, 'review', 'k1', ['k1'])).toEqual(['k1'])
    expect(walkIds(stored, 'live', 'new-ad', ['new-ad'])).toEqual(['new-ad'])
    expect(parseWalk('not json')).toBeNull()
    expect(parseWalk(JSON.stringify({ filter: 'live', ids: [1] }))).toBeNull()
    expect(parseWalk(null)).toBeNull()
  })
})

describe('tagsFromLink', () => {
  it('reads the campaign and content tags from an ad’s link', () => {
    expect(
      tagsFromLink(
        'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid&utm_campaign=type-test-1&utm_content=price-first-animated#/',
      ),
    ).toEqual({ campaign: 'type-test-1', content: 'price-first-animated' })
    expect(tagsFromLink('https://book.q3interiors.ie/?utm_campaign=x#/')).toBeNull()
    expect(tagsFromLink('not a link')).toBeNull()
    expect(tagsFromLink(null)).toBeNull()
  })
})
