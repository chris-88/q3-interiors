// The Q3 ad studio's local command (Node 24 runs this TypeScript directly).
//
//   npm run ad:render  -- ads/work/<ad>            validate, inline, render PNGs into <ad>/out/
//   npm run ad:render  -- ads/work/<ad> --guides   also writes <size>.guides.png with the safe areas
//   npm run ad:publish -- ads/work/<ad>            render, then upload to the stack and create records
//
// An ad directory holds ad.json, one <size>.html per size, and any handed-in assets. The HTML may
// use kit:<name> references (ads/kit) and paths relative to the ad directory; rendering inlines
// them all, refuses anything that would still reach the network, and renders each PNG from the
// exact HTML that is published.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import {
  BUTTON_MAX,
  CAPTION_GUIDE,
  CAPTION_MAX,
  HEADLINE_MAX,
  MAX_IMAGE_BYTES,
  PLACEMENTS,
  htmlProblems,
  type AdSize,
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
  name: string
  caption: string
  headline?: string
  button_label?: string
  notes?: string
  campaign?: string
  creative?: string
  sizes?: AdSize[]
  created_by?: string
}

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
  if (!ad.caption?.trim() || ad.caption.length > CAPTION_MAX)
    problems.push(`caption: 1 to ${CAPTION_MAX} characters`)
  if (ad.headline && ad.headline.length > HEADLINE_MAX)
    problems.push(`headline: at most ${HEADLINE_MAX} characters`)
  if (ad.button_label && ad.button_label.length > BUTTON_MAX)
    problems.push(`button_label: at most ${BUTTON_MAX} characters`)
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

type Rendered = { size: AdSize; htmlFile: string; pngFile: string; bytes: number }

async function render(
  dir: string,
  guides: boolean,
): Promise<{ ad: ReturnType<typeof readAd>; files: Rendered[] }> {
  const ad = readAd(dir)
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

      const shoot = async (doc: string, file: string) => {
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
        await page.screenshot({
          path: file,
          clip: { x: 0, y: 0, width: p.width, height: p.height },
        })
        await page.close()
      }
      const pngFile = path.join(outDir, `${size}.png`)
      await shoot(html, pngFile)
      const bytes = fs.statSync(pngFile).size
      if (bytes > MAX_IMAGE_BYTES) fail(`${size}.png is ${bytes} bytes, over Instagram's 30 MB`)
      if (guides)
        await shoot(
          html.replace(/<html\b/i, '<html class="guides"'),
          path.join(outDir, `${size}.guides.png`),
        )
      files.push({ size, htmlFile, pngFile, bytes })
      console.log(
        `ad: ${size} ${p.width}x${p.height} -> ${path.relative(ROOT, pngFile)} (${Math.round(bytes / 1024)} KB)`,
      )
    }
  } finally {
    await browser.close()
  }
  return { ad, files }
}

async function publish(dir: string) {
  const { ad, files } = await render(dir, false)
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
  const base = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim()
  if (!base) fail('VITE_SUPABASE_URL is not in .env.local')
  // The service role key is read from pass for this run only: never written, never printed.
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
  const rest = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`${base}/rest/v1/${route}`, {
      method,
      headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok)
      throw new Error(`${method} ${route.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`)
    return text ? (JSON.parse(text) as Record<string, unknown>[]) : []
  }

  let creativeId: string | null = null
  if (ad.campaign && ad.creative) {
    const rows = await rest(
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

  const by = ad.created_by ?? 'Ad studio (Claude session)'
  const [created] = await rest('POST', 'ads', {
    name: ad.name.trim(),
    campaign_creative_id: creativeId,
    created_by_name: by,
  })
  const adId = created?.id as string
  const uploaded: string[] = []
  try {
    const [version] = await rest('POST', 'ad_versions', {
      ad_id: adId,
      version: 1,
      caption: ad.caption.trim(),
      headline: ad.headline?.trim() || null,
      button_label: ad.button_label?.trim() || null,
      notes: ad.notes?.trim() || null,
      created_by_name: by,
    })
    for (const f of files) {
      const p = PLACEMENTS[f.size]
      const htmlPath = `${adId}/v1/${f.size}.html`
      const pngPath = `${adId}/v1/${f.size}.png`
      for (const [objectPath, file, type] of [
        [htmlPath, f.htmlFile, 'text/html'],
        [pngPath, f.pngFile, 'image/png'],
      ] as const) {
        const res = await fetch(`${base}/storage/v1/object/ads/${objectPath}`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': type, 'x-upsert': 'false' },
          body: fs.readFileSync(file),
        })
        if (!res.ok)
          throw new Error(
            `upload ${path.basename(file)}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
          )
        uploaded.push(objectPath)
      }
      await rest('POST', 'ad_variants', {
        version_id: version?.id,
        size: f.size,
        width: p.width,
        height: p.height,
        html_path: htmlPath,
        export_path: pngPath,
        export_bytes: f.bytes,
      })
    }
  } catch (error) {
    // Leave nothing half-published.
    await fetch(`${base}/storage/v1/object/ads`, {
      method: 'DELETE',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: uploaded }),
    }).catch(() => undefined)
    await rest('DELETE', `ads?id=eq.${adId}`).catch(() => undefined)
    fail(
      `publishing failed and was undone: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  console.log(`ad: published "${ad.name}" (id ${adId}, version 1, ${files.length} sizes)`)
  console.log('ad: staff see it at https://staff.q3interiors.ie/#/ads')
}

const [command, target, ...flags] = process.argv.slice(2)
if (!command || !target || !['render', 'publish'].includes(command))
  fail('usage: node scripts/ad.mts render|publish <ad directory> [--guides]')
const dir = path.resolve(target)
if (command === 'render') await render(dir, flags.includes('--guides'))
else await publish(dir)
