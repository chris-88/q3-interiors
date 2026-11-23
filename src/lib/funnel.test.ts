import { formatRate, rate, stages, totals, type FunnelRow } from './funnel'

const row = (
  campaign: string,
  e: number,
  b: number,
  a: number,
  w: number,
  extra: Partial<FunnelRow> = {},
): FunnelRow => ({
  campaign,
  enquiries: e,
  booked: b,
  attended: a,
  won: w,
  cancelled: 0,
  no_shows: 0,
  won_value: 0,
  ...extra,
})

describe('funnel maths', () => {
  it('computes each stage from the one before and from the start', () => {
    expect(stages(row('x', 20, 10, 8, 2))).toEqual([
      { label: 'Enquiries', count: 20, fromPrevious: null, fromStart: null },
      { label: 'Booked', count: 10, fromPrevious: 0.5, fromStart: 0.5 },
      { label: 'Attended', count: 8, fromPrevious: 0.8, fromStart: 0.4 },
      { label: 'Won', count: 2, fromPrevious: 0.25, fromStart: 0.1 },
    ])
  })

  it('never divides by zero', () => {
    expect(rate(0, 0)).toBeNull()
    expect(
      stages(row('x', 0, 0, 0, 0)).every((s) => s.fromPrevious === null && s.fromStart === null),
    ).toBe(true)
    expect(stages(row('x', 3, 0, 0, 0))[2]?.fromPrevious).toBeNull()
    expect(formatRate(null)).toBe('–')
  })

  it('formats rates as whole percentages', () => {
    expect(formatRate(rate(1, 3))).toBe('33%')
    expect(formatRate(rate(2, 3))).toBe('67%')
    expect(formatRate(1)).toBe('100%')
  })

  it('totals campaigns, including cancellations, no-shows and won value', () => {
    const all = totals([
      row('a', 5, 3, 2, 1, { cancelled: 1, no_shows: 1, won_value: 1000 }),
      row('(unknown)', 2, 1, 1, 1, { won_value: 2500.5 }),
    ])
    expect(all).toEqual({
      campaign: 'All campaigns',
      enquiries: 7,
      booked: 4,
      attended: 3,
      won: 2,
      cancelled: 1,
      no_shows: 1,
      won_value: 3500.5,
    })
    expect(totals([]).enquiries).toBe(0)
  })
})
