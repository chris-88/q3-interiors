// The Q3 ad studio's local command (Node 24 runs this TypeScript directly).
//
//   npm run ad:new     -- bold-black ads/work/<ad> --headline "a|b|c" --line .. --set .. --position <n> --link https://..
//                                                  [--cta ..] [--loop <ms>] [--headline-size <px>]
//                                                  a new ad from a fill-in template
//   npm run ad:render  -- ads/work/<ad>            validate, inline, render into <ad>/out/: a PNG
//                                                  per size, or for an animated ad (duration_ms in
//                                                  ad.json) an MP4 and a poster PNG per size
//   npm run ad:render  -- ads/work/<ad> --guides   also writes <size>.guides.png with the safe areas
//   npm run ad:publish -- ads/work/<ad> [--done <request ids>]  render, upload, create the ad or
//                                                  its next version, mark requests done
//   npm run ad:requests                            open change requests from the staff console
//   npm run ad:pull -- <ad id> ads/work/<ad>       the current version as a directory to rebuild
//
// An ad directory holds ad.json, one <size>.html per size, and any handed-in assets. The HTML may
// use kit:<name> references (ads/kit) and paths relative to the ad directory; rendering inlines
// them all, refuses anything that would still reach the network, and renders each file from the
// exact HTML that is published. An animated ad moves with CSS animations only; the render pauses
// them and seeks each to every frame's time (30 per second), so the video is the same every run
// and never depends on how fast this machine is. ffmpeg encodes the frames.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Page } from '@playwright/test'
import {
  BUTTON_MAX,
  CAPTION_GUIDE,
  CAPTION_MAX,
  HEADLINE_MAX,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  PLACEMENTS,
  VIDEO_FPS,
  durationProblem,
  formatDuration,
  htmlProblems,
  safeArea,
  type AdSize,
  type Placement,
} from '../src/lib/ads/spec.ts'

const ROOT = path.resolve(import.meta.dirname, '..')

const KIT: Record<string, string> = {
  'ad.css': 'ads/kit/ad.css',
  'roboto-400.woff2': 'node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2',
  'roboto-500.woff2': 'node_modules/@fontsource/roboto/files/roboto-latin-500-normal.woff2',
  'roboto-700.woff2': 'node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff2',
  'wordmark-black.svg': 'public/brand/q3-full-black.svg',
  'wordmark-white.svg': 'public/brand/q3-full-white.svg',
  'q-black.svg': 'public/brand/q3-mark-black.svg',
  'q-white.svg': 'public/brand/q3-mark-white.svg',
}

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
}

type AdJson = {
  /** The title staff see: the ad's headline, nothing before or after it, no brackets. */
  name: string
  /** The set the ad belongs to ("Type test 2") and its place in it (1 first). */
  set?: string
  position?: number
  /** Where the ad points, with its tags (https). Stored on each version. */
  link?: string
  caption: string
  headline?: string
  button_label?: string
  notes?: string
  campaign?: string
  creative?: string
  sizes?: AdSize[]
  /** Animated ads only: the loop length. A still ad has none. */
  duration_ms?: number
  created_by?: string
  /** Set by the first publish: later publishes from the same directory add versions. */
  ad_id?: string
}

/** The same rule as the ad_versions.link_url check. */
const LINK_RE = /^https:\/\/\S{1,1992}$/

function fail(message: string): never {
  console.error(`ad: ${message}`)
  process.exit(1)
}

function readAd(dir: string): AdJson & { sizes: AdSize[] } {
  const file = path.join(dir, 'ad.json')
  if (!fs.existsSync(file)) fail(`no ad.json in ${dir}`)
  const ad = JSON.parse(fs.readFileSync(file, 'utf8')) as AdJson
  const problems: string[] = []
  if (!ad.name?.trim() || ad.name.length > 120) problems.push('name: 1 to 120 characters')
  else if (/[()[\]]/.test(ad.name))
    problems.push(
      'name: the headline alone, no brackets (say still or animated nowhere in the title)',
    )
  if (ad.set !== undefined && (!ad.set.trim() || ad.set.length > 80))
    problems.push('set: 1 to 80 characters')
  if (
    ad.position !== undefined &&
    !(Number.isInteger(ad.position) && ad.position >= 1 && ad.position <= 999)
  )
    problems.push('position: a whole number from 1 to 999')
  if (ad.link !== undefined && !LINK_RE.test(ad.link))
    problems.push('link: an https address without spaces, up to 2,000 characters')
  if (!ad.caption?.trim() || ad.caption.length > CAPTION_MAX)
    problems.push(`caption: 1 to ${CAPTION_MAX} characters`)
  if (ad.headline && ad.headline.length > HEADLINE_MAX)
    problems.push(`headline: at most ${HEADLINE_MAX} characters`)
  if (ad.button_label && ad.button_label.length > BUTTON_MAX)
    problems.push(`button_label: at most ${BUTTON_MAX} characters`)
  if (ad.duration_ms !== undefined) {
    const problem = durationProblem(ad.duration_ms)
    if (problem) problems.push(problem)
  }
  if (Boolean(ad.campaign) !== Boolean(ad.creative))
    problems.push('campaign and creative: give both slugs or neither')
  const sizes = ad.sizes ?? ['portrait', 'vertical']
  for (const s of sizes) if (!(s in PLACEMENTS)) problems.push(`sizes: unknown size "${s}"`)
  for (const s of ['portrait', 'vertical'] as const)
    if (!sizes.includes(s)) problems.push(`sizes: every ad needs ${s}`)
  if (problems.length) fail(`ad.json:\n  ${problems.join('\n  ')}`)
  if (ad.caption.length > CAPTION_GUIDE)
    console.warn(
      `ad: note: the caption is ${ad.caption.length} characters; Instagram shows about ${CAPTION_GUIDE} before "more"`,
    )
  return { ...ad, sizes }
}

/** A kit: name or a path inside the ad directory, as a data: URI (or CSS text for stylesheets). */
function resolveFile(ref: string, dir: string): string {
  if (ref.startsWith('kit:')) {
    const rel = KIT[ref.slice(4)]
    if (!rel) fail(`unknown kit file ${ref}; known: ${Object.keys(KIT).join(', ')}`)
    return path.join(ROOT, rel)
  }
  const full = path.resolve(dir, ref)
  if (!full.startsWith(path.resolve(dir) + path.sep)) fail(`${ref} is outside the ad directory`)
  if (!fs.existsSync(full)) fail(`missing file ${ref}`)
  return full
}

const isLocal = (ref: string) =>
  ref.startsWith('kit:') ||
  !(/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || ref.startsWith('#'))

function dataUri(file: string): string {
  const mime = MIME[path.extname(file).toLowerCase()]
  if (!mime) fail(`unsupported file type ${path.basename(file)}`)
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

function inlineCss(css: string, dir: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q, ref: string) =>
    isLocal(ref.trim()) ? `url("${dataUri(resolveFile(ref.trim(), dir))}")` : whole,
  )
}

/** Every kit: and local reference inlined; external ones are left for the checker to refuse. */
function inline(html: string, dir: string): string {
  let out = html.replace(
    /<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>|<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']?stylesheet["']?[^>]*>/gi,
    (whole, a?: string, b?: string) => {
      const ref = (a ?? b ?? '').trim()
      if (!isLocal(ref)) return whole
      const file = resolveFile(ref, dir)
      return `<style>${inlineCss(fs.readFileSync(file, 'utf8'), path.dirname(file))}</style>`
    },
  )
  out = out.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (_w, attrs: string, css: string) => `<style${attrs}>${inlineCss(css, dir)}</style>`,
  )
  out = out.replace(
    /\bstyle=(["'])([\s\S]*?)\1/gi,
    (_w, q: string, css: string) => `style=${q}${inlineCss(css, dir)}${q}`,
  )
  out = out.replace(
    /\b(src|xlink:href|poster)=(["'])([^"']+)\2/gi,
    (whole, attr: string, q: string, ref: string) =>
      isLocal(ref.trim()) ? `${attr}=${q}${dataUri(resolveFile(ref.trim(), dir))}${q}` : whole,
  )
  return out
}

type Rendered = {
  size: AdSize
  htmlFile: string
  /** The PNG (still) or MP4 (animated) staff download. */
  exportFile: string
  exportType: 'image' | 'video'
  bytes: number
  /** Animated only: the last frame as PNG. */
  posterFile: string | null
  durationMs: number | null
}

type Motion = { name: string; delay: number; duration: number; iterations: number; end: number }

/** The time of a loop's last video frame. */
const lastFrameMs = (loop: number) => (((loop * VIDEO_FPS) / 1000 - 1) * 1000) / VIDEO_FPS

/** Every CSS animation in the page, with its timing. */
const readMotion = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().map((a) => {
      const t = a.effect?.getComputedTiming()
      return {
        name: 'animationName' in a ? String(a.animationName) : a.constructor.name,
        delay: Number(t?.delay ?? 0),
        duration: Number(t?.duration ?? 0),
        iterations: Number(t?.iterations ?? 1),
        end: Number(t?.endTime ?? 0),
      }
    }),
  )

/** Children of .safe that reach outside it, and whether .safe sits where Meta's figures put it. */
const safeProblems = (page: Page, expected: ReturnType<typeof safeArea>) =>
  page.evaluate((want) => {
    const safe = document.querySelector('.safe')
    if (!safe) return ['no element with class "safe" (put the text, logo and key content in .safe)']
    const s = safe.getBoundingClientRect()
    const problems: string[] = []
    if (
      Math.abs(s.left - want.left) > 1 ||
      Math.abs(s.top - want.top) > 1 ||
      Math.abs(s.width - want.width) > 2 ||
      Math.abs(s.height - want.height) > 2
    )
      problems.push(
        `.safe is at ${Math.round(s.left)},${Math.round(s.top)} ${Math.round(s.width)} x ${Math.round(s.height)}, expected ${want.left},${want.top} ${want.width} x ${want.height}`,
      )
    for (const el of safe.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (
        r.left < s.left - 1 ||
        r.top < s.top - 1 ||
        r.right > s.right + 1 ||
        r.bottom > s.bottom + 1
      )
        problems.push(
          `<${el.tagName.toLowerCase()}${el.className ? ` class="${String(el.className)}"` : ''}> reaches outside the safe area`,
        )
    }
    return problems
  }, expected)

function ffprobe(file: string) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,sample_aspect_ratio,field_order,nb_frames:format=duration,format_name',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  )
  return JSON.parse(out) as {
    streams: Record<string, string | number>[]
    format: { duration: string; format_name: string }
  }
}

/** H.264 in MP4, yuv420p, fixed 30 fps, square pixels, progressive, no audio, no edit list. */
function encode(framesDir: string, file: string) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(VIDEO_FPS),
      '-i',
      path.join(framesDir, '%05d.png'),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-bf',
      '0',
      '-r',
      String(VIDEO_FPS),
      '-vf',
      'setsar=1',
      '-movflags',
      '+faststart',
      '-use_editlist',
      '0',
      '-an',
      file,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
}

/** Whether the MP4's movie box carries an edit list ("elst"); Meta asks for none. */
function hasEditList(file: string): boolean {
  const buf = fs.readFileSync(file)
  for (let at = 0; at + 8 <= buf.length;) {
    const size = buf.readUInt32BE(at)
    const type = buf.toString('latin1', at + 4, at + 8)
    if (size < 8) break
    if (type === 'moov') return buf.subarray(at, at + size).includes('elst')
    at += size
  }
  return false
}

function checkVideo(file: string, p: Placement, durationMs: number) {
  const probe = ffprobe(file)
  const video = probe.streams.filter((s) => s.codec_type === 'video')
  const v = video[0]
  const problems: string[] = []
  if (video.length !== 1 || !v) problems.push('expected one video stream')
  else {
    if (v.codec_name !== 'h264') problems.push(`codec ${v.codec_name}, expected h264`)
    if (v.width !== p.width || v.height !== p.height)
      problems.push(`${v.width} x ${v.height}, expected ${p.width} x ${p.height}`)
    if (v.r_frame_rate !== `${VIDEO_FPS}/1` || v.avg_frame_rate !== `${VIDEO_FPS}/1`)
      problems.push(
        `frame rate ${v.r_frame_rate} (average ${v.avg_frame_rate}), expected ${VIDEO_FPS}/1`,
      )
    if (v.pix_fmt !== 'yuv420p') problems.push(`pixel format ${v.pix_fmt}, expected yuv420p`)
    if (v.sample_aspect_ratio !== '1:1')
      problems.push(`pixel aspect ${v.sample_aspect_ratio}, expected 1:1`)
    if (Number(v.nb_frames) !== (durationMs * VIDEO_FPS) / 1000)
      problems.push(`${v.nb_frames} frames, expected ${(durationMs * VIDEO_FPS) / 1000}`)
  }
  if (probe.streams.length !== 1)
    problems.push('the file has streams besides the video (it should be silent)')
  if (Math.abs(Number(probe.format.duration) * 1000 - durationMs) > 1000 / VIDEO_FPS)
    problems.push(`length ${probe.format.duration} s, expected ${durationMs / 1000} s`)
  if (hasEditList(file)) problems.push('the file has an edit list (Meta asks for none)')
  if (problems.length)
    fail(`${path.basename(file)} does not meet the video spec:\n  ${problems.join('\n  ')}`)
}

async function render(
  dir: string,
  guides: boolean,
): Promise<{ ad: ReturnType<typeof readAd>; files: Rendered[] }> {
  const ad = readAd(dir)
  const animated = ad.duration_ms !== undefined
  const outDir = path.join(dir, 'out')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch()
  const files: Rendered[] = []
  try {
    for (const size of ad.sizes) {
      const p = PLACEMENTS[size]
      const source = path.join(dir, `${size}.html`)
      if (!fs.existsSync(source)) fail(`missing ${size}.html`)
      const html = inline(fs.readFileSync(source, 'utf8'), dir)
      const problems = htmlProblems(html)
      if (problems.length)
        fail(
          `${size}.html cannot be published:\n  ${problems.map((x) => `${x.problem}: ${x.detail}`).join('\n  ')}`,
        )
      const htmlFile = path.join(outDir, `${size}.html`)
      fs.writeFileSync(htmlFile, html)

      /** The page loaded exactly as published: network blocked, fonts ready, size checked. */
      const open = async (doc: string) => {
        const page = await browser.newPage({
          viewport: { width: p.width, height: p.height },
          deviceScaleFactor: 1,
        })
        const blocked: string[] = []
        await page.route('**/*', (route) => {
          const url = route.request().url()
          if (url.startsWith('data:')) return route.continue()
          blocked.push(url)
          return route.abort()
        })
        await page.setContent(doc, { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready)
        if (blocked.length) fail(`${size}: the page tried to load ${blocked.join(', ')}`)
        const box = await page.evaluate(() => {
          const el = document.querySelector('.ad')
          const r = el?.getBoundingClientRect()
          return {
            found: Boolean(el),
            w: r ? Math.round(r.width) : 0,
            h: r ? Math.round(r.height) : 0,
            sw: document.documentElement.scrollWidth,
            sh: document.documentElement.scrollHeight,
          }
        })
        if (!box.found) fail(`${size}: no element with class "ad"`)
        if (box.w !== p.width || box.h !== p.height)
          fail(
            `${size}: .ad is ${box.w} x ${box.h}, expected ${p.width} x ${p.height} (use .ad--${size})`,
          )
        if (box.sw > p.width || box.sh > p.height)
          fail(`${size}: content overflows the ${p.width} x ${p.height} artwork`)
        return page
      }
      const clip = { x: 0, y: 0, width: p.width, height: p.height }
      const checkSafe = async (page: Page, when: string) => {
        const outside = await safeProblems(page, safeArea(p))
        if (outside.length) fail(`${size}${when}: ${outside.join('; ')}`)
      }
      /** Every animation paused and moved to t milliseconds, then one frame drawn. */
      const seek = (page: Page, t: number) =>
        page.evaluate(
          (ms) =>
            new Promise<void>((done) => {
              for (const a of document.getAnimations()) {
                a.pause()
                a.currentTime = ms
              }
              requestAnimationFrame(() => done())
            }),
          t,
        )

      const page = await open(html)
      const motion: Motion[] = await readMotion(page)
      let rendered: Rendered
      if (!animated) {
        // A still: nothing may move, now or a moment later.
        if (motion.length)
          fail(
            `${size}: the ad animates (${motion.map((m) => m.name).join(', ')}) but ad.json declares no duration_ms. Add duration_ms for an animated ad, or remove the animation.`,
          )
        await checkSafe(page, '')
        const pngFile = path.join(outDir, `${size}.png`)
        const first = await page.screenshot({ path: pngFile, clip })
        await page.waitForTimeout(1000)
        if (!first.equals(await page.screenshot({ clip })))
          fail(
            `${size}: the still ad changes over time (an animated image?); declare duration_ms or make it still`,
          )
        const bytes = fs.statSync(pngFile).size
        if (bytes > MAX_IMAGE_BYTES) fail(`${size}.png is ${bytes} bytes, over Instagram's 30 MB`)
        rendered = {
          size,
          htmlFile,
          exportFile: pngFile,
          exportType: 'image',
          bytes,
          posterFile: null,
          durationMs: null,
        }
      } else {
        const loop = ad.duration_ms as number
        if (!motion.length)
          fail(
            `${size}: ad.json declares duration_ms ${loop} but nothing in the ad animates (a still ad has no duration_ms)`,
          )
        for (const m of motion) {
          if (m.duration <= 0) continue
          if (m.iterations === Infinity) {
            const ratio = loop / m.duration
            if (Math.abs(m.delay) > 0.5 || Math.abs(ratio - Math.round(ratio)) > 0.001)
              fail(
                `${size}: animation "${m.name}" repeats every ${m.duration} ms${m.delay ? ` after ${m.delay} ms` : ''}; a repeating animation must fit the ${loop} ms loop a whole number of times, with no delay (set --loop to ${loop / 1000}s)`,
              )
          } else if (m.end > loop + 0.5)
            fail(`${size}: animation "${m.name}" ends at ${m.end} ms, after the ${loop} ms loop`)
        }
        // Step the loop frame by frame: seek every animation to each frame's time and capture it.
        const framesDir = path.join(outDir, `${size}.frames`)
        fs.mkdirSync(framesDir)
        const count = (loop * VIDEO_FPS) / 1000
        let first: Buffer | null = null
        let moves = false
        for (let i = 0; i < count; i++) {
          await seek(page, (i * 1000) / VIDEO_FPS)
          await checkSafe(page, ` at ${Math.round((i * 1000) / VIDEO_FPS)} ms`)
          const frame = await page.screenshot({
            path: path.join(framesDir, `${String(i).padStart(5, '0')}.png`),
            clip,
          })
          if (!first) first = frame
          else if (!moves && !frame.equals(first)) moves = true
        }
        if (!moves)
          fail(`${size}: ad.json declares duration_ms ${loop} but no frame differs from the first`)
        // The poster is the video's last frame: the settled message, and the still fallback.
        // (Seeking to the loop length itself would wrap a repeating animation back to its start.)
        const posterFile = path.join(outDir, `${size}.poster.png`)
        fs.copyFileSync(
          path.join(framesDir, `${String(count - 1).padStart(5, '0')}.png`),
          posterFile,
        )
        const mp4File = path.join(outDir, `${size}.mp4`)
        encode(framesDir, mp4File)
        fs.rmSync(framesDir, { recursive: true })
        checkVideo(mp4File, p, loop)
        const bytes = fs.statSync(mp4File).size
        if (bytes > MAX_VIDEO_BYTES)
          fail(`${size}.mp4 is ${bytes} bytes, over the 30 MB the ad files can hold`)
        if (fs.statSync(posterFile).size > MAX_IMAGE_BYTES) fail(`${size}.poster.png is over 30 MB`)
        rendered = {
          size,
          htmlFile,
          exportFile: mp4File,
          exportType: 'video',
          bytes,
          posterFile,
          durationMs: loop,
        }
      }
      await page.close()
      if (guides) {
        const g = await open(html.replace(/<html\b/i, '<html class="guides"'))
        if (animated) await seek(g, lastFrameMs(ad.duration_ms as number))
        await g.screenshot({ path: path.join(outDir, `${size}.guides.png`), clip })
        await g.close()
      }
      files.push(rendered)
      console.log(
        `ad: ${size} ${p.width}x${p.height} -> ${path.relative(ROOT, rendered.exportFile)} (${Math.round(rendered.bytes / 1024)} KB${
          animated
            ? `, ${formatDuration(ad.duration_ms as number)} at ${VIDEO_FPS} fps, poster ${path.basename(rendered.posterFile ?? '')}`
            : ''
        })`,
      )
    }
  } finally {
    await browser.close()
  }
  return { ad, files }
}

type Stack = {
  base: string
  rest: (method: string, route: string, body?: unknown) => Promise<Record<string, unknown>[]>
  storage: (method: string, objectPath: string, body?: Buffer, type?: string) => Promise<Response>
}

/**
 * The stack's own gateway on this machine, so these commands never pass through Cloudflare (whose
 * rate limit is for the public URL). Override with Q3_STACK_URL. There is deliberately no fallback
 * to the public URL: the service role key only travels to the local gateway or an explicit choice.
 */
const LOCAL_GATEWAY = 'http://localhost:8003'

/** The stack, with the service role key read from pass for this run only (never written or printed). */
async function stack(): Promise<Stack> {
  const base = (process.env.Q3_STACK_URL?.trim() || LOCAL_GATEWAY).replace(/\/+$/, '')
  try {
    // Any HTTP answer (401 without a key) means the gateway is up; only then is the key read.
    await fetch(`${base}/rest/v1/`, { signal: AbortSignal.timeout(5000) })
  } catch {
    fail(
      `the stack's gateway at ${base} is not answering. Is the q3-interiors stack running on this machine? (Set Q3_STACK_URL to use another address.)`,
    )
  }
  let key: string
  try {
    key =
      execFileSync('pass', ['show', 'infra/q3-interiors/SERVICE_ROLE_KEY'], { encoding: 'utf8' })
        .split('\n')[0]
        ?.trim() ?? ''
  } catch {
    fail('could not read infra/q3-interiors/SERVICE_ROLE_KEY from pass')
  }
  if (!key) fail('the service role key in pass is empty')
  const auth = { apikey: key, Authorization: `Bearer ${key}` }
  return {
    base,
    rest: async (method, route, body) => {
      const res = await fetch(`${base}/rest/v1/${route}`, {
        method,
        headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      if (!res.ok)
        throw new Error(
          `${method} ${route.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`,
        )
      if (!text) return []
      const parsed = JSON.parse(text) as unknown
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [{ value: parsed }]
    },
    storage: (method, objectPath, body, type) =>
      fetch(`${base}/storage/v1/object/ads/${objectPath}`, {
        method,
        headers: { ...auth, ...(type ? { 'Content-Type': type, 'x-upsert': 'false' } : {}) },
        body,
      }),
  }
}

async function publish(dir: string, doneIds: string[]) {
  const { ad, files } = await render(dir, false)
  const s = await stack()
  const by = ad.created_by ?? 'Ad studio (Claude session)'

  let creativeId: string | null = null
  if (ad.campaign && ad.creative) {
    const rows = await s.rest(
      'GET',
      `campaigns?slug=eq.${encodeURIComponent(ad.campaign)}&select=id,campaign_creatives(id,slug)`,
    )
    const creatives = (rows[0]?.campaign_creatives ?? []) as { id: string; slug: string }[]
    creativeId = creatives.find((c) => c.slug === ad.creative)?.id ?? null
    if (!creativeId)
      fail(
        `no creative "${ad.creative}" in campaign "${ad.campaign}" (create it in Settings > Campaigns)`,
      )
  }

  // An existing ad (ad_id in ad.json) gets version N+1; otherwise a new ad with version 1.
  let adId = ad.ad_id ?? null
  let version = 1
  let createdAd = false
  if (adId) {
    const rows = await s.rest('GET', `ads?id=eq.${adId}&select=id,name,ad_versions(version)`)
    if (!rows[0])
      fail(`no ad with id ${adId} on the stack (remove ad_id from ad.json to publish a new ad)`)
    const versions = (rows[0].ad_versions ?? []) as { version: number }[]
    version = Math.max(0, ...versions.map((v) => v.version)) + 1
    if (doneIds.length) {
      const open = await s.rest(
        'GET',
        `ad_requests?ad_id=eq.${adId}&state=eq.open&select=id&id=in.(${doneIds.join(',')})`,
      )
      const known = new Set(open.map((r) => r.id as string))
      const missing = doneIds.filter((id) => !known.has(id))
      if (missing.length) fail(`not open requests on this ad: ${missing.join(', ')}`)
    }
    const patch: Record<string, unknown> = {}
    if (creativeId) patch.campaign_creative_id = creativeId
    if (ad.set) patch.set_name = ad.set.trim()
    if (ad.position) patch.set_position = ad.position
    if (Object.keys(patch).length) await s.rest('PATCH', `ads?id=eq.${adId}`, patch)
  } else {
    if (doneIds.length)
      fail('--done only applies to a new version of an existing ad (ad_id in ad.json)')
    const [created] = await s.rest('POST', 'ads', {
      name: ad.name.trim(),
      set_name: ad.set?.trim() || null,
      set_position: ad.position ?? null,
      campaign_creative_id: creativeId,
      created_by_name: by,
    })
    adId = created?.id as string
    createdAd = true
  }

  const uploaded: string[] = []
  let versionId: string | undefined
  try {
    const [row] = await s.rest('POST', 'ad_versions', {
      ad_id: adId,
      version,
      caption: ad.caption.trim(),
      headline: ad.headline?.trim() || null,
      button_label: ad.button_label?.trim() || null,
      notes: ad.notes?.trim() || null,
      link_url: ad.link?.trim() || null,
      created_by_name: by,
    })
    versionId = row?.id as string
    for (const f of files) {
      const p = PLACEMENTS[f.size]
      const base = `${adId}/v${version}/${f.size}`
      const htmlPath = `${base}.html`
      const exportPath = f.exportType === 'video' ? `${base}.mp4` : `${base}.png`
      const posterPath = f.posterFile ? `${base}.poster.png` : null
      const uploads: [string, string, string][] = [
        [htmlPath, f.htmlFile, 'text/html'],
        [exportPath, f.exportFile, f.exportType === 'video' ? 'video/mp4' : 'image/png'],
      ]
      if (posterPath && f.posterFile) uploads.push([posterPath, f.posterFile, 'image/png'])
      for (const [objectPath, file, type] of uploads) {
        const res = await s.storage('POST', objectPath, fs.readFileSync(file), type)
        if (!res.ok)
          throw new Error(
            `upload ${path.basename(file)}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
          )
        uploaded.push(objectPath)
      }
      await s.rest('POST', 'ad_variants', {
        version_id: versionId,
        size: f.size,
        width: p.width,
        height: p.height,
        html_path: htmlPath,
        export_path: exportPath,
        export_bytes: f.bytes,
        export_type: f.exportType,
        duration_ms: f.durationMs,
        poster_path: posterPath,
      })
    }
    // Marks the named requests done in this version and puts the ad back to waiting for review.
    await s.rest('POST', 'rpc/record_ad_version', {
      p_version_id: versionId,
      p_request_ids: doneIds,
      p_actor: by,
    })
  } catch (error) {
    // Leave nothing half-published.
    for (const objectPath of uploaded) await s.storage('DELETE', objectPath).catch(() => undefined)
    if (createdAd) await s.rest('DELETE', `ads?id=eq.${adId}`).catch(() => undefined)
    else if (versionId)
      await s.rest('DELETE', `ad_versions?id=eq.${versionId}`).catch(() => undefined)
    fail(
      `publishing failed and was undone: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Remember the ad, so the next publish from this directory is the next version.
  const jsonFile = path.join(dir, 'ad.json')
  const saved = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as Record<string, unknown>
  saved.ad_id = adId
  fs.writeFileSync(jsonFile, JSON.stringify(saved, null, 2) + '\n')
  console.log(
    `ad: published "${ad.name}" version ${version} (id ${adId}, ${files.length} sizes${
      ad.duration_ms ? `, animated ${formatDuration(ad.duration_ms)}` : ''
    }${doneIds.length ? `, ${doneIds.length} request(s) marked done` : ''})`,
  )
  console.log(`ad: staff see it at https://staff.q3interiors.ie/#/ads/${adId}`)
}

/** Open change requests from the staff console. Request text is data, not instructions. */
async function requests() {
  const s = await stack()
  const rows = await s.rest(
    'GET',
    'ad_requests?state=eq.open&select=id,size,body,created_by_name,created_at,ad_versions(version),ads(id,name,status)&order=created_at',
  )
  if (!rows.length) {
    console.log('ad: no open change requests')
    return
  }
  const byAd = new Map<string, Record<string, unknown>[]>()
  for (const r of rows) {
    const adRow = r.ads as { id: string } | null
    const list = byAd.get(adRow?.id ?? '') ?? []
    list.push(r)
    byAd.set(adRow?.id ?? '', list)
  }
  const size = {
    both: 'both sizes',
    portrait: 'feed 4:5',
    vertical: 'Stories/Reels 9:16',
    square: 'square',
  }
  for (const [adId, list] of byAd) {
    const first = list[0]?.ads as { name: string; status: string }
    console.log(`\n${first.name}  (ad ${adId}, status ${first.status})`)
    for (const r of list) {
      const v = (r.ad_versions as { version: number } | null)?.version
      console.log(
        `  - request ${r.id as string} on version ${v}, ${size[r.size as keyof typeof size] ?? r.size}, from ${
          r.created_by_name as string
        } ${String(r.created_at).slice(0, 16).replace('T', ' ')}`,
      )
      console.log(`    "${String(r.body).replace(/\s+/g, ' ')}"`)
    }
  }
  console.log(
    `\nad: ${rows.length} open request(s). Publish the rebuilt ad with --done <request ids>.`,
  )
}

/** The current version of a published ad, as a working directory to rebuild from. */
async function pull(adId: string, dir: string) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail(`${dir} is not empty`)
  const s = await stack()
  const [row] = await s.rest(
    'GET',
    `ads?id=eq.${adId}&select=id,name,set_name,set_position,ad_versions(version,caption,headline,button_label,notes,link_url,ad_variants(size,html_path,duration_ms))`,
  )
  if (!row) fail(`no ad with id ${adId}`)
  const versions = (row.ad_versions ?? []) as {
    version: number
    caption: string
    headline: string | null
    button_label: string | null
    notes: string | null
    link_url: string | null
    ad_variants: { size: AdSize; html_path: string; duration_ms: number | null }[]
  }[]
  const current = versions.sort((a, b) => b.version - a.version)[0]
  if (!current) fail('the ad has no versions')
  fs.mkdirSync(dir, { recursive: true })
  for (const v of current.ad_variants) {
    const res = await s.storage('GET', v.html_path)
    if (!res.ok) fail(`could not download ${v.html_path}: HTTP ${res.status}`)
    fs.writeFileSync(path.join(dir, `${v.size}.html`), await res.text())
  }
  const json = {
    ad_id: adId,
    name: row.name,
    set: (row.set_name as string | null) ?? undefined,
    position: (row.set_position as number | null) ?? undefined,
    link: current.link_url ?? undefined,
    caption: current.caption,
    headline: current.headline ?? undefined,
    button_label: current.button_label ?? undefined,
    notes: current.notes ?? undefined,
    duration_ms: current.ad_variants[0]?.duration_ms ?? undefined,
    sizes: current.ad_variants.map((v) => v.size),
  }
  fs.writeFileSync(path.join(dir, 'ad.json'), JSON.stringify(json, null, 2) + '\n')
  console.log(
    `ad: version ${current.version} of "${row.name as string}" is in ${path.relative(ROOT, dir)}`,
  )
}

/** Plain text for HTML, with typographic apostrophes. */
function typeset(text: string): string {
  return curly(text.trim())
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Straight apostrophes as typographic ones (shouldn't -> shouldn’t). */
const curly = (text: string) => text.replace(/'/g, '’')

/**
 * A new ad directory from a fill-in template (ads/kit/templates/<template>/ with {{...}} slots):
 * the HTML for both sizes and ad.json. The headline is given in lines ("one|two|three") so the
 * breaks are chosen, never left to chance.
 */
function newAd(template: string, dir: string, opt: (name: string) => string | null) {
  const from = path.join(ROOT, 'ads/kit/templates', template)
  const sizes = ['portrait', 'vertical'] as const
  if (!sizes.every((size) => fs.existsSync(path.join(from, `${size}.html`))))
    fail(`no template ads/kit/templates/${template}/ with portrait.html and vertical.html`)
  if (!fs.readFileSync(path.join(from, 'portrait.html'), 'utf8').includes('{{headline}}'))
    fail(`${template} is not a fill-in template; copy it by hand (see the skill)`)
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail(`${dir} is not empty`)
  const need = (name: string) => {
    const value = opt(name)?.trim()
    if (!value) fail(`--${name} is required`)
    return value
  }
  const lines = need('headline')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
  if (lines.length > 4) fail('--headline: one to four lines, split with |')
  const line = need('line')
  // The drawn button is off by default: Instagram's own button carries the click (RULES.md 10).
  const button = opt('button')?.trim()
  const loop = opt('loop')
  const sizePx = opt('headline-size')
  if (sizePx && !/^\d{2,3}$/.test(sizePx)) fail('--headline-size: pixels, e.g. 132')
  const words = curly(lines.join(' '))
  // The title is the headline itself unless --name says otherwise (same rule: no brackets).
  const name = curly(opt('name')?.trim() || words)
  const set = opt('set')?.trim() || undefined
  const position = opt('position') ? Number(opt('position')) : undefined
  const link = opt('link')?.trim() || undefined
  const vars = [
    sizePx ? `--bb-headline: ${sizePx}px;` : '',
    loop ? `--loop: ${Number(loop) / 1000}s;` : '',
  ]
    .filter(Boolean)
    .join(' ')
  fs.mkdirSync(dir, { recursive: true })
  for (const size of sizes) {
    const html = fs
      .readFileSync(path.join(from, `${size}.html`), 'utf8')
      .replaceAll('{{title}}', typeset(name))
      .replaceAll('{{vars}}', vars)
      .replaceAll('{{animate}}', loop ? ' bb--animate' : '')
      .replaceAll('{{headline}}', lines.map((l) => `<span>${typeset(l)}</span>`).join(''))
      .replaceAll(
        '{{line}}',
        line
          .split('|')
          .map((l) => typeset(l))
          .join('<br />'),
      )
      .replaceAll(
        '{{button}}',
        button
          ? `<div class="bb-button"><span>${typeset(button)}</span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M14 6l6 6-6 6" /></svg></div>`
          : '',
      )
      .replaceAll('{{has_button}}', button ? ' bb--button' : '')
    fs.writeFileSync(path.join(dir, `${size}.html`), html)
  }
  if (words.length > HEADLINE_MAX)
    console.warn(
      `ad: note: the headline is ${words.length} characters, over Meta's ${HEADLINE_MAX} for the headline field; ad.json leaves that field empty (the artwork keeps it)`,
    )
  const json = {
    name,
    set,
    position,
    link,
    caption: curly(opt('caption')?.trim() || `${words} ${line.replace(/\s*\|\s*/g, ' ')}`),
    headline: words.length <= HEADLINE_MAX ? words : undefined,
    button_label: opt('cta')?.trim() || 'Learn more',
    notes: opt('notes')?.trim() || undefined,
    duration_ms: loop ? Number(loop) : undefined,
    sizes: [...sizes],
  }
  fs.writeFileSync(path.join(dir, 'ad.json'), JSON.stringify(json, null, 2) + '\n')
  readAd(dir)
  console.log(
    `ad: ${path.relative(ROOT, dir)} made from ${template}${loop ? ` (animated, ${formatDuration(Number(loop))})` : ''}. Next: npm run ad:render -- ${path.relative(ROOT, dir)} --guides`,
  )
}

const [command, target, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(name)
  return i >= 0 ? (rest[i + 1] ?? '') : null
}
if (command === 'new') {
  const into = rest[0]
  if (!target || !into || into.startsWith('--'))
    fail(
      'usage: node scripts/ad.mts new <template> <directory> --headline "line|line|line" --line ... [--set "Type test 2" --position <n>] [--link https://...] [--name <title, default the headline>] [--cta "Learn more"] [--button <drawn label, not used>] [--loop <ms>] [--headline-size <px>] [--caption ...] [--notes ...]',
    )
  newAd(target, path.resolve(into), (name) => flag(`--${name}`))
} else if (command === 'requests') await requests()
else if (command === 'pull') {
  const into = rest[0]
  if (!target || !into) fail('usage: node scripts/ad.mts pull <ad id> <directory>')
  await pull(target, path.resolve(into))
} else if (command === 'render' && target)
  await render(path.resolve(target), rest.includes('--guides'))
else if (command === 'publish' && target) {
  const done = (flag('--done') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  await publish(path.resolve(target), done)
} else
  fail(
    'usage: node scripts/ad.mts new <template> <dir> ... | render <dir> [--guides] | publish <dir> [--done <request ids>] | requests | pull <ad id> <dir>',
  )
