// Generates every brand image in public/ from the two supplied SVGs in public/brand/
// (q3-full-black.svg 243x93, q3-mark-black.svg 77x93). Run: npm run brand:images
//   public/brand/q3-full-white.svg, q3-mark-white.svg   same paths, fill white (black panels)
//   public/favicon.svg                                   the compact Q alone on a white tile
//   public/favicon-16.png, favicon-32.png                rasters of favicon.svg
//   public/apple-touch-icon.png                          180x180, compact Q with both rules
//   public/og/q3-og.png                                  1200x630 link preview, white card
//   public/brand/q3-email-logo.png                       wordmark for HTML emails (2x of 160px)
//   staff-pwa/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png  staff app
// Uses Playwright's Chromium, with the self-hosted Roboto inlined for the preview text.
const { chromium } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const write = (p, data) => fs.writeFileSync(path.join(root, p), data)
const full = read('public/brand/q3-full-black.svg')
const mark = read('public/brand/q3-mark-black.svg')

// White versions: the same artwork with the fill swapped, never redrawn.
const white = (svg) => svg.replace(/fill="black"/g, 'fill="white"')
write('public/brand/q3-full-white.svg', white(full))
write('public/brand/q3-mark-white.svg', white(mark))

// Favicon: at 16px the two 2-unit rules would be a third of a pixel and blur into grey, so the
// tab icon is the Q alone (bounding box 9.9,11.6 57.5x68.8), centred on a white rounded tile with
// a little padding so it holds up on dark browser chrome too.
const qPath = [...mark.matchAll(/<path d="([^"]+)" fill="black"\/>/g)]
  .map((m) => m[1])
  .find((d) => !/^M0 /.test(d))
if (!qPath) throw new Error('Q path not found in q3-mark-black.svg')
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 8 77.3 77.3">
  <rect x="0" y="8" width="77.3" height="77.3" rx="12" fill="#ffffff"/>
  <path d="${qPath}" fill="#000000"/>
</svg>
`
write('public/favicon.svg', favicon)

const font = (w) =>
  fs
    .readFileSync(
      path.join(root, `node_modules/@fontsource/roboto/files/roboto-latin-${w}-normal.woff2`),
    )
    .toString('base64')

const page = (body, css = '') =>
  `<!doctype html><html><head><style>
@font-face { font-family: Roboto; font-weight: 400; src: url(data:font/woff2;base64,${font(400)}) format('woff2'); }
@font-face { font-family: Roboto; font-weight: 500; src: url(data:font/woff2;base64,${font(500)}) format('woff2'); }
html, body { margin: 0; background: #fff; }
svg { display: block; }
${css}
</style></head><body>${body}</body></html>`

const og = page(
  `<div class="card"><div class="logo">${full}</div>
   <p>Let’s talk about your renovation. <span>Book a free phone call or site visit.</span></p></div>`,
  `.card { width: 1200px; height: 630px; box-sizing: border-box; padding: 96px; display: flex;
     flex-direction: column; justify-content: center; gap: 56px; font-family: Roboto, sans-serif; color: #171717; }
   .logo svg { width: 560px; height: auto; }
   p { margin: 0; font-size: 52px; line-height: 1.2; font-weight: 500; max-width: 980px; }
   p span { display: block; font-weight: 400; color: #555555; font-size: 40px; margin-top: 12px; }`,
)

const icon = (size, svg, pad) =>
  page(
    `<div class="tile">${svg}</div>`,
    `.tile { width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; background: #fff; }
     .tile svg { height: ${size - 2 * pad}px; width: auto; }`,
  )

;(async () => {
  const browser = await chromium.launch()
  const shot = async (html, width, height, out, opts = {}) => {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    await p.setContent(html)
    await p.evaluate(() => document.fonts.ready)
    await p.screenshot({ path: path.join(root, out), omitBackground: opts.transparent === true })
    await p.close()
  }
  fs.mkdirSync(path.join(root, 'public/og'), { recursive: true })
  const faviconPage = (size) =>
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}"></body></html>`
  await shot(faviconPage(16), 16, 16, 'public/favicon-16.png', { transparent: true })
  await shot(faviconPage(32), 32, 32, 'public/favicon-32.png', { transparent: true })
  await shot(icon(180, mark, 30), 180, 180, 'public/apple-touch-icon.png')
  // Staff app icons (copied into dist-staff/icons by scripts/staff-site-files.cjs). The maskable
  // icon keeps the Q at 40% of the tile, well inside the 80% safe zone of any mask shape.
  fs.mkdirSync(path.join(root, 'staff-pwa'), { recursive: true })
  await shot(icon(192, mark, 32), 192, 192, 'staff-pwa/icon-192.png')
  await shot(icon(512, mark, 84), 512, 512, 'staff-pwa/icon-512.png')
  await shot(icon(512, mark, 154), 512, 512, 'staff-pwa/icon-maskable-512.png')
  await shot(icon(180, mark, 30), 180, 180, 'staff-pwa/apple-touch-icon.png')
  await shot(og, 1200, 630, 'public/og/q3-og.png')
  await shot(
    page(`<div class="logo">${full}</div>`, `.logo svg { width: 320px; height: 122px; }`),
    320,
    122,
    'public/brand/q3-email-logo.png',
  )
  await browser.close()
  console.log('wrote the white logos, favicons, apple-touch icon, link preview and email logo')
})()
