// Instagram placements the ad studio builds for, from Meta's published ad specifications
// (read 2026-11-25; sources and figures in docs/instagram-ad-specs.md). Pure data, shared by the
// local render and publish command, the staff console and the tests.

export type AdSize = 'portrait' | 'vertical' | 'square'

export type Placement = {
  size: AdSize
  label: string
  /** Where it runs, in plain words for staff. */
  where: string
  width: number
  height: number
  /** Areas Instagram's own interface may cover: keep text, logo and key content out. */
  covered: { top: number; bottom: number; side: number }
}

export const PLACEMENTS: Record<AdSize, Placement> = {
  // Feed, 4:5 at 1440 x 1800 (Meta's recommendation). The feed page names no covered area; a 6%
  // margin all round keeps type clear of rounded corners and the crop tolerance.
  portrait: {
    size: 'portrait',
    label: 'Feed 4:5',
    where: 'Instagram feed',
    width: 1440,
    height: 1800,
    covered: { top: 0.06, bottom: 0.06, side: 0.06 },
  },
  // Stories and Reels, 9:16 at 1440 x 2560. Meta: keep roughly 14% at the top, 35% at the bottom
  // and 6% at each side free of text, logos and key elements.
  vertical: {
    size: 'vertical',
    label: 'Stories and Reels 9:16',
    where: 'Instagram Stories and Reels',
    width: 1440,
    height: 2560,
    covered: { top: 0.14, bottom: 0.35, side: 0.06 },
  },
  // Square only on request: 1:1 is within the feed's accepted ratios (Meta accepts 1.91:1 to 4:5).
  square: {
    size: 'square',
    label: 'Square 1:1',
    where: 'Instagram feed (square)',
    width: 1440,
    height: 1440,
    covered: { top: 0.06, bottom: 0.06, side: 0.06 },
  },
}

/** Meta: image ads up to 30 MB, JPG or PNG. */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024
/** Meta's guidance for feed copy: primary text 125 characters, headline 40. */
export const CAPTION_GUIDE = 125
export const CAPTION_MAX = 2200
export const HEADLINE_MAX = 40
export const BUTTON_MAX = 30

/**
 * Animated ads (Meta's video specs, docs/instagram-ad-specs.md): MP4, H.264, fixed frame rate,
 * progressive, square pixels; Stories at least 1 second (Reels from 0, feed from 1), at most 15
 * minutes (Reels) to 60 minutes (feed and Stories), up to 4 GB. A Q3 ad is a short loop, so the
 * studio keeps it between 1 and 15 seconds, and the private bucket holds files up to 30 MB.
 */
export const VIDEO_FPS = 30
export const MIN_DURATION_MS = 1000
export const MAX_DURATION_MS = 15000
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024

/** "6 seconds", "2.5 seconds" */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 100) / 10
  return `${s} ${s === 1 ? 'second' : 'seconds'}`
}

/** A declared loop length: whole frames at VIDEO_FPS, within the studio's limits. */
export function durationProblem(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isInteger(ms))
    return 'duration_ms: a whole number of milliseconds'
  if (ms < MIN_DURATION_MS || ms > MAX_DURATION_MS)
    return `duration_ms: between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}`
  if ((ms * VIDEO_FPS) % 1000 !== 0)
    return `duration_ms: a whole number of frames at ${VIDEO_FPS} per second (a multiple of 100 ms works)`
  return null
}

/** The safe rectangle in pixels for a placement. */
export function safeArea(p: Placement) {
  const left = Math.round(p.width * p.covered.side)
  const top = Math.round(p.height * p.covered.top)
  const bottom = Math.round(p.height * p.covered.bottom)
  return { left, top, width: p.width - 2 * left, height: p.height - top - bottom }
}

/** "q3-spring-kitchens-v1-feed-4x5-1440x1800.png" */
export function exportFilename(adName: string, version: number, p: Placement, ext = 'png'): string {
  const slug =
    adName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'ad'
  const ratio = { portrait: '4x5', vertical: '9x16', square: '1x1' }[p.size]
  return `q3-${slug}-v${version}-${ratio}-${p.width}x${p.height}.${ext}`
}

export type HtmlProblem = { problem: string; detail: string }

/**
 * Everything in a published ad file that could reach the network or run code. A published variant
 * must come back empty: fonts, logo and images are inlined as data: URIs, nothing else. Movement
 * is CSS animation only, so a render can step it frame by frame.
 */
export function htmlProblems(html: string): HtmlProblem[] {
  const problems: HtmlProblem[] = []
  const add = (problem: string, detail: string) =>
    problems.push({ problem, detail: detail.slice(0, 120) })
  const tags: [RegExp, string][] = [
    [/<script\b/i, 'scripts are not allowed in an ad (animate with CSS)'],
    [/<(video|audio)\b/i, 'video and audio elements are not allowed (animate with CSS)'],
    [/<(animate|animateTransform|animateMotion|set)\b/i, 'SVG animation is not allowed (use CSS)'],
    [/<(iframe|frame|object|embed|portal)\b/i, 'embedded documents are not allowed'],
    [/<link\b/i, 'linked files are not allowed (inline the CSS)'],
    [/<base\b/i, 'a base URL is not allowed'],
    [/<meta[^>]+http-equiv\s*=\s*["']?refresh/i, 'a refresh is not allowed'],
    [/<form\b/i, 'forms are not allowed'],
    [/\son[a-z]+\s*=/i, 'event handler attributes are not allowed'],
  ]
  for (const [re, problem] of tags) {
    const m = html.match(re)
    if (m) add(problem, m[0])
  }
  // Any attribute or CSS reference that is not an inlined data: URI or an in-page #fragment.
  const check = (raw: string) => {
    const ref = raw.trim()
    if (!ref || ref.startsWith('#') || /^data:/i.test(ref)) return
    add('external or unresolved reference', ref)
  }
  const single: RegExp[] = [
    /\b(?:src|href|poster|action|formaction|data|xlink:href|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    /@import\s+(?:url\()?\s*(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi,
  ]
  for (const re of single) {
    for (const m of html.matchAll(re)) check(m[1] ?? m[2] ?? m[3] ?? '')
  }
  // srcset lists candidates separated by a comma and whitespace (a data: URI has a bare comma).
  for (const m of html.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const candidate of (m[1] ?? m[2] ?? '').split(/,\s+/)) {
      check(candidate.trim().split(/\s+/)[0] ?? '')
    }
  }
  for (const m of html.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    add('a web address appears in the file', m[0])
  }
  return problems
}
