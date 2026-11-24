// Renders the raster brand images into public/ from the supplied SVGs (run: npm run brand:images).
//   public/og/q3-og.png            1200x630 link preview: square badge on cream with the name
//   public/brand/q3-badge-email.png 224x224 square badge for HTML emails (shown at 112px)
// Uses Playwright's Chromium so the text is set in the self-hosted Roboto.
const { chromium } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const badge = fs.readFileSync(path.join(root, 'public/brand/q3-square-colour.svg'), 'utf8')
const font = (w) =>
  fs
    .readFileSync(
      path.join(root, `node_modules/@fontsource/roboto/files/roboto-latin-${w}-normal.woff2`),
    )
    .toString('base64')

const og = `<!doctype html><html><head><style>
@font-face { font-family: Roboto; font-weight: 700; src: url(data:font/woff2;base64,${font(700)}) format('woff2'); }
@font-face { font-family: Roboto; font-weight: 400; src: url(data:font/woff2;base64,${font(400)}) format('woff2'); }
html, body { margin: 0; }
.card { width: 1200px; height: 630px; background: #E8E6D6; display: flex; align-items: center; gap: 72px; padding: 0 96px; box-sizing: border-box; font-family: Roboto, sans-serif; color: #1F2922; }
.badge svg { width: 360px; height: 360px; display: block; }
h1 { font-size: 76px; line-height: 1.08; margin: 0 0 24px; font-weight: 700; color: #415847; }
p { font-size: 36px; line-height: 1.3; margin: 0; max-width: 560px; }
</style></head><body><div class="card"><div class="badge">${badge}</div>
<div><h1>Q3 Interiors</h1><p>Planning a home renovation? Tell us about your project.</p></div></div></body></html>`

const email = `<!doctype html><html><head><style>html,body{margin:0;background:#fff}svg{width:224px;height:224px;display:block}</style></head><body>${badge}</body></html>`

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  })
  await page.setContent(og)
  await page.evaluate(() => document.fonts.ready)
  fs.mkdirSync(path.join(root, 'public/og'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'public/og/q3-og.png') })
  await page.setViewportSize({ width: 224, height: 224 })
  await page.setContent(email)
  await page.screenshot({ path: path.join(root, 'public/brand/q3-badge-email.png') })
  await browser.close()
  console.log('wrote public/og/q3-og.png and public/brand/q3-badge-email.png')
})()
