import {
  contentReportSchema,
  formatDuration,
  formatPer100,
  per100,
  pilotReportSchema,
  rowLabel,
  sessionsFor,
  share,
  type PilotRow,
} from './pilot'

const row = (over: Partial<PilotRow>): PilotRow => ({
  dim: 'all',
  key: 'all',
  sessions: 200,
  chose: 120,
  saved: 30,
  booked: 18,
  attended: 15,
  suitable_attended: 12,
  chased: 3,
  quoted: 10,
  won: 6,
  won_value: 98000,
  median_to_saved_seconds: 300,
  median_to_booked_seconds: 600,
  ...over,
})

it('reads a report from before outcomes as zero quoted and won', () => {
  const old = pilotReportSchema.parse({
    counted_from: '2026-11-27T12:00:00Z',
    rows: [{ ...row({}), quoted: undefined, won: undefined, won_value: undefined }],
    headline: { instagram_sessions: 0, instagram_suitable_attended: 0 },
  })
  expect(old.rows[0]).toMatchObject({ quoted: 0, won: 0, won_value: 0 })
})

const report = pilotReportSchema.parse({
  counted_from: '2026-11-27T12:00:00Z',
  rows: [row({})],
  headline: { instagram_sessions: 150, instagram_suitable_attended: 9 },
})

describe('pilot report arithmetic', () => {
  it('counts per 100 landing sessions', () => {
    expect(per100(18, 200)).toBe(9)
    expect(per100(9, 150)).toBe(6)
    expect(per100(1, 3)).toBe(33.3)
    expect(per100(5, 0)).toBeNull()
    expect(per100(5, null)).toBeNull()
  })

  it('says "not counted" for v1 and before counting began, and zero inside it', () => {
    expect(
      sessionsFor(row({ dim: 'version', key: '1', sessions: null }), report, '2026-12-31'),
    ).toBeNull()
    expect(sessionsFor(row({}), report, '2026-11-26')).toBeNull()
    expect(
      sessionsFor(row({ dim: 'campaign', key: 'x', sessions: null }), report, '2026-12-01'),
    ).toBe(0)
    expect(formatPer100(null, null)).toBe('not counted')
    expect(formatPer100(null, 0)).toBe('–')
  })

  it('formats shares, durations and labels', () => {
    expect(share(3, 18)).toBeCloseTo(0.1667, 3)
    expect(share(1, 0)).toBeNull()
    expect(formatDuration(240)).toBe('4 min')
    expect(formatDuration(7500)).toBe('2 h 5 min')
    expect(formatDuration(7200)).toBe('2 h')
    expect(formatDuration(5 * 86400)).toBe('5 days')
    expect(formatDuration(null)).toBe('–')
    expect(rowLabel(row({ dim: 'route', key: 'on_site' }))).toBe('Site visit')
    expect(rowLabel(row({ dim: 'campaign', key: 'kitchens' }))).toBe('kitchens')
  })
})

describe('pilot measures by ad', () => {
  it('reads a campaign split by utm_content, labels the untagged and folded rows', () => {
    const parsed = contentReportSchema.parse({
      campaign: 'type-test-1',
      cap: 25,
      rows: [
        { ...row({ dim: 'content', key: 'kitchen-calls' }), extra: true },
        row({ dim: 'content', key: '(none)' }),
        row({ dim: 'content', key: '(other)' }),
        { dim: 'content', key: 'broken' },
      ],
    })
    expect(parsed.rows.map(rowLabel)).toEqual([
      'kitchen-calls',
      'No ad tag (utm_content)',
      'Other ads (smaller ones, together)',
    ])
  })
})
