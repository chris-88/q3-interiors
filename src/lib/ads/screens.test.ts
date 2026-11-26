import { describe, expect, it } from 'vitest'
import {
  adOrder,
  groupAds,
  matchesAdFilter,
  neighbours,
  previewOptions,
  readAdFilter,
  thumbnailPath,
  type PreviewVariant,
} from './screens'

const ad = (
  id: string,
  set: string | null,
  position: number | null,
  created: string,
  status = 'new',
) => ({ id, set_name: set, set_position: position, created_at: created, status })

describe('ads list filter', () => {
  it('reads the chip from the address and falls back to To review', () => {
    expect(readAdFilter('?show=archived')).toBe('archived')
    expect(readAdFilter('?show=nonsense')).toBe('review')
    expect(readAdFilter('')).toBe('review')
  })

  it('keeps unknown statuses in To review so nothing disappears', () => {
    expect(matchesAdFilter('new', 'review')).toBe(true)
    expect(matchesAdFilter('changes_requested', 'review')).toBe(true)
    expect(matchesAdFilter('scheduled', 'review')).toBe(true)
    expect(matchesAdFilter('approved', 'review')).toBe(false)
    expect(matchesAdFilter('archived', 'review')).toBe(false)
    expect(matchesAdFilter('archived', 'archived')).toBe(true)
    expect(matchesAdFilter('archived', 'all')).toBe(true)
  })
})

describe('grouping by set', () => {
  const ads = [
    ad('s2', 'Samples', 2, '2026-11-25T12:00:00Z'),
    ad('t3', 'Type test 1', 3, '2026-11-26T10:00:00Z'),
    ad('t1', 'Type test 1', 1, '2026-11-26T11:00:00Z'),
    ad('x', null, null, '2026-11-20T10:00:00Z'),
    ad('s1', 'Samples', 1, '2026-11-25T10:00:00Z'),
  ]

  it('puts the newest set first and orders each set by position', () => {
    expect(groupAds(ads).map((g) => [g.set, g.ads.map((a) => a.id)])).toEqual([
      ['Type test 1', ['t1', 't3']],
      ['Samples', ['s1', 's2']],
      ['Other ads', ['x']],
    ])
  })

  it('walks the filtered list in that order', () => {
    const list = [...ads, ad('t2', 'Type test 1', 2, '2026-11-26T09:00:00Z', 'archived')]
    const ids = adOrder(list, 'review')
    expect(ids).toEqual(['t1', 't3', 's1', 's2', 'x'])
    expect(neighbours(ids, 't3')).toEqual({ position: 2, total: 5, previous: 't1', next: 's1' })
    expect(neighbours(ids, 't1')?.previous).toBeNull()
    expect(neighbours(ids, 'x')?.next).toBeNull()
    expect(neighbours(ids, 't2')).toBeNull()
  })
})

const video = (size: 'portrait' | 'vertical'): PreviewVariant => ({
  size,
  width: 1440,
  height: size === 'portrait' ? 1800 : 2560,
  html_path: `a/v2/${size}.html`,
  export_path: `a/v2/${size}.mp4`,
  export_type: 'video',
  duration_ms: 8000,
  poster_path: `a/v2/${size}.poster.png`,
})

describe('preview choices', () => {
  it('offers Reel, Feed and Still for an animated ad, with labels that follow the choice', () => {
    const options = previewOptions(
      [video('portrait'), video('vertical')],
      'Stop chasing trades.',
      2,
    )
    expect(options.map((o) => [o.key, o.label, o.download.label, o.caption])).toEqual([
      ['reel', 'Reel', 'Download reel video', '1440 × 2560 · 8 s'],
      ['feed', 'Feed', 'Download feed video', '1440 × 1800 · 8 s'],
      ['still', 'Still', 'Download still', '1440 × 1800'],
    ])
    expect(options[0]?.download.filename).toBe('q3-stop-chasing-trades-v2-9x16-1440x2560.mp4')
    const still = options[2]
    expect(still?.path).toBe('a/v2/portrait.poster.png')
    expect(still?.download.filename).toBe('q3-stop-chasing-trades-v2-4x5-1440x1800-still.png')
    expect(still?.extra).toEqual({
      label: 'Download the 9:16 still',
      path: 'a/v2/vertical.poster.png',
      filename: 'q3-stop-chasing-trades-v2-9x16-1440x2560-still.png',
    })
  })

  it('falls back to Feed and Stories images in the frame for ads without video', () => {
    const image = (size: 'portrait' | 'vertical'): PreviewVariant => ({
      ...video(size),
      export_path: `a/v1/${size}.png`,
      export_type: 'image',
      duration_ms: null,
      poster_path: null,
    })
    const options = previewOptions([image('vertical'), image('portrait')], 'Old ad', 1)
    expect(options.map((o) => [o.label, o.kind, o.download.label])).toEqual([
      ['Feed', 'frame', 'Download feed image'],
      ['Stories', 'frame', 'Download stories image'],
    ])
    expect(options[0]?.download.path).toBe('a/v1/portrait.png')
  })

  it('uses the feed poster, else the feed image, as the thumbnail', () => {
    expect(thumbnailPath([video('vertical'), video('portrait')])).toBe('a/v2/portrait.poster.png')
    expect(
      thumbnailPath([
        { size: 'portrait', export_type: 'image', export_path: 'a.png', poster_path: null },
      ]),
    ).toBe('a.png')
    expect(thumbnailPath([])).toBeNull()
  })
})
