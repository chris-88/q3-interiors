// What the staff Ads screens show and in what order: the filter chips, grouping by set, walking
// the filtered list from an ad page, and the preview choices for an ad. Pure, so it is tested
// without a browser.
import { exportFilename, PLACEMENTS, type AdSize } from './spec'

export const AD_FILTERS = [
  ['review', 'To review'],
  ['approved', 'Approved'],
  ['archived', 'Archived'],
  ['all', 'All'],
] as const

export type AdFilter = (typeof AD_FILTERS)[number][0]

/** The filter in a list or ad page address (?show=...), "To review" when absent or unknown. */
export function readAdFilter(search: string): AdFilter {
  const value = new URLSearchParams(search).get('show')
  return AD_FILTERS.some(([key]) => key === value) ? (value as AdFilter) : 'review'
}

/**
 * "To review" is everything not approved and not archived: new, changes requested, and any
 * status a newer release adds (so nothing silently disappears from the default view).
 */
export function matchesAdFilter(status: string, filter: AdFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'approved') return status === 'approved'
  if (filter === 'archived') return status === 'archived'
  return status !== 'approved' && status !== 'archived'
}

export type Groupable = {
  id: string
  created_at: string
  set_name: string | null
  set_position: number | null
}

export const NO_SET = 'Other ads'

/**
 * Ads grouped by set: the set with the newest ad first; within a set by position (ads without
 * one after, newest first). Ads with no set gather under "Other ads".
 */
export function groupAds<T extends Groupable>(ads: T[]): { set: string; ads: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const ad of ads) {
    const key = ad.set_name?.trim() || NO_SET
    groups.set(key, [...(groups.get(key) ?? []), ad])
  }
  const newest = (list: T[]) => list.reduce((m, a) => (a.created_at > m ? a.created_at : m), '')
  return [...groups.entries()]
    .map(([set, list]) => ({
      set,
      ads: [...list].sort((a, b) => {
        const pa = a.set_position ?? Number.POSITIVE_INFINITY
        const pb = b.set_position ?? Number.POSITIVE_INFINITY
        return pa !== pb ? pa - pb : b.created_at.localeCompare(a.created_at)
      }),
    }))
    .sort((a, b) => newest(b.ads).localeCompare(newest(a.ads)))
}

/** The ids in the order the list shows them for a filter. */
export function adOrder<T extends Groupable & { status: string }>(
  ads: T[],
  filter: AdFilter,
): string[] {
  return groupAds(ads.filter((a) => matchesAdFilter(a.status, filter))).flatMap((g) =>
    g.ads.map((a) => a.id),
  )
}

export { neighbours } from '../walk'

export type PreviewVariant = {
  size: AdSize
  width: number
  height: number
  html_path: string
  export_path: string
  export_type: string
  duration_ms: number | null
  poster_path: string | null
}

export type PreviewOption = {
  key: 'reel' | 'feed' | 'still' | 'feed-image' | 'stories-image'
  label: string
  /** What the preview shows: the MP4, an image file, or the ad's HTML in the sandboxed frame. */
  kind: 'video' | 'image' | 'frame'
  /** The file to show (video or image), or the HTML for the frame. */
  path: string
  poster: string | null
  width: number
  height: number
  caption: string
  download: { label: string; path: string; filename: string }
  /** Still only: the 9:16 still as a secondary download. */
  extra: { label: string; path: string; filename: string } | null
}

const size = (w: number, h: number) => `${w} × ${h}`

/**
 * The preview choices for one version. With video: Reel (9:16, the default), Feed (4:5) and
 * Still (the last frame). Without (ads published as images): Feed and Stories, previewed through
 * the sandboxed frame as before.
 */
export function previewOptions(
  variants: PreviewVariant[],
  adName: string,
  version: number,
): PreviewOption[] {
  const find = (s: AdSize) => variants.find((v) => v.size === s)
  const portrait = find('portrait')
  const vertical = find('vertical')
  const isVideo = (v: PreviewVariant | undefined): boolean => v?.export_type === 'video'
  const length = (v: PreviewVariant) =>
    v.duration_ms ? ` · ${Math.round(v.duration_ms / 100) / 10} s` : ''
  const options: PreviewOption[] = []
  if (isVideo(portrait) || isVideo(vertical)) {
    if (vertical && isVideo(vertical))
      options.push({
        key: 'reel',
        label: 'Reel',
        kind: 'video',
        path: vertical.export_path,
        poster: vertical.poster_path,
        width: vertical.width,
        height: vertical.height,
        caption: size(vertical.width, vertical.height) + length(vertical),
        download: {
          label: 'Download reel video',
          path: vertical.export_path,
          filename: exportFilename(adName, version, PLACEMENTS.vertical, 'mp4'),
        },
        extra: null,
      })
    if (portrait && isVideo(portrait))
      options.push({
        key: 'feed',
        label: 'Feed',
        kind: 'video',
        path: portrait.export_path,
        poster: portrait.poster_path,
        width: portrait.width,
        height: portrait.height,
        caption: size(portrait.width, portrait.height) + length(portrait),
        download: {
          label: 'Download feed video',
          path: portrait.export_path,
          filename: exportFilename(adName, version, PLACEMENTS.portrait, 'mp4'),
        },
        extra: null,
      })
    const stillFrom = portrait && isVideo(portrait) && portrait.poster_path ? portrait : vertical
    if (stillFrom?.poster_path) {
      const other =
        stillFrom === portrait && vertical?.poster_path && isVideo(vertical) ? vertical : null
      options.push({
        key: 'still',
        label: 'Still',
        kind: 'image',
        path: stillFrom.poster_path,
        poster: null,
        width: stillFrom.width,
        height: stillFrom.height,
        caption: size(stillFrom.width, stillFrom.height),
        download: {
          label: 'Download still',
          path: stillFrom.poster_path,
          filename: exportFilename(adName, version, PLACEMENTS[stillFrom.size]).replace(
            /\.png$/,
            '-still.png',
          ),
        },
        extra: other?.poster_path
          ? {
              label: 'Download the 9:16 still',
              path: other.poster_path,
              filename: exportFilename(adName, version, PLACEMENTS.vertical).replace(
                /\.png$/,
                '-still.png',
              ),
            }
          : null,
      })
    }
    return options
  }
  for (const [v, key, label, what] of [
    [portrait, 'feed-image', 'Feed', 'feed'],
    [vertical, 'stories-image', 'Stories', 'stories'],
  ] as const) {
    if (!v) continue
    options.push({
      key,
      label,
      kind: 'frame',
      path: v.html_path,
      poster: null,
      width: v.width,
      height: v.height,
      caption: size(v.width, v.height),
      download: {
        label: `Download ${what} image`,
        path: v.export_path,
        filename: exportFilename(adName, version, PLACEMENTS[v.size]),
      },
      extra: null,
    })
  }
  return options
}

/** The image the list shows for an ad: its feed poster, else its feed image. */
export function thumbnailPath(
  variants: {
    size: string
    export_type: string
    export_path: string
    poster_path: string | null
  }[],
): string | null {
  const portrait = variants.find((v) => v.size === 'portrait') ?? variants[0]
  if (!portrait) return null
  if (portrait.poster_path) return portrait.poster_path
  return portrait.export_type === 'image' ? portrait.export_path : null
}
