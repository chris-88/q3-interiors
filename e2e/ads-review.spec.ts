import { expect, test } from '@playwright/test'
import { installFakeStaff, signIn, type StaffWorld } from './fake-staff'

const html = (label: string) =>
  `<!doctype html><html><head><style>body{margin:0}.ad{width:1440px;height:100vh;display:flex;align-items:center;justify-content:center;font:500 120px sans-serif;background:#fff}</style></head><body><main class="ad">${label}</main></body></html>`

function seed(world: StaffWorld) {
  const variants = (v: number) =>
    (['portrait', 'vertical'] as const).map((size) => ({
      id: `var-${v}-${size}`,
      size,
      width: 1440,
      height: size === 'portrait' ? 1800 : 2560,
      html_path: `ad-1/v${v}/${size}.html`,
      export_path: `ad-1/v${v}/${size}.png`,
      export_bytes: 10,
    }))
  world.tables.ads = [
    {
      id: 'ad-1',
      name: 'Spring kitchens',
      status: 'new',
      created_at: '2026-11-25T10:00:00Z',
      created_by_name: 'Ad studio (Claude session)',
      campaign_creatives: null,
      ad_versions: [
        {
          id: 'ver-1',
          version: 1,
          caption: 'First caption',
          headline: 'First',
          button_label: 'Learn more',
          notes: null,
          created_at: '2026-11-24T10:00:00Z',
          approved_at: null,
          approved_by_name: null,
          ad_variants: variants(1),
        },
        {
          id: 'ver-2',
          version: 2,
          caption: 'Second caption',
          headline: 'Second',
          button_label: 'Learn more',
          notes: null,
          created_at: '2026-11-25T10:00:00Z',
          approved_at: null,
          approved_by_name: null,
          ad_variants: variants(2),
        },
      ],
      ad_requests: [
        {
          id: 'req-old',
          version_id: 'ver-1',
          size: 'portrait',
          body: 'Bigger headline please',
          state: 'done',
          done_in_version: 2,
          created_by: 'u-staff',
          created_by_name: 'Sam Staff',
          created_at: '2026-11-24T12:00:00Z',
        },
      ],
    },
    {
      id: 'ad-2',
      name: 'Old idea',
      status: 'archived',
      created_at: '2026-11-20T10:00:00Z',
      created_by_name: null,
      campaign_creatives: null,
      ad_versions: [{ version: 1 }],
      ad_requests: [],
    },
  ]
  for (const v of [1, 2])
    for (const size of ['portrait', 'vertical'])
      world.adFiles.set(`ad-1/v${v}/${size}.html`, {
        body: html(`Version ${v} ${size}`),
        type: 'text/html',
      })
}

test('staff ask for a change, withdraw it, and cannot approve', async ({ page }) => {
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(
    page.getByRole('navigation', { name: 'Staff' }).getByRole('link', { name: /Ads/ }),
  ).toContainText('1')
  const list = page.getByRole('main').getByRole('listitem')
  await expect(list).toHaveCount(1)
  await expect(list.first()).toContainText('Version 2')
  await list.first().getByRole('link').click()

  // The version picker sits by the status, current version chosen.
  await expect(page.getByLabel('Version', { exact: true })).toHaveValue('2')
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Ask for a change' }).click()
  await page.getByRole('button', { name: 'Save the request' }).click()
  await expect(page.getByText('Say what should change (at least 3 characters).')).toBeVisible()
  await page.getByLabel('What should change?').fill('Make the headline shorter on the Stories size')
  await page.getByRole('radio', { name: 'Stories and Reels 9:16' }).check()
  await page.getByRole('button', { name: 'Save the request' }).click()
  await expect(page.getByText('Saved. The ad now shows “Changes requested”.')).toBeVisible()
  const request = page.getByRole('listitem').filter({ hasText: 'Make the headline shorter' })
  await expect(request).toContainText('Open')
  await expect(request).toContainText('Stories and Reels 9:16')
  await expect(request).toContainText('Sam Staff')
  await expect(page.getByText('Changes requested').first()).toBeVisible()

  await request.getByRole('button', { name: 'Withdraw my request' }).click()
  await expect(request).toHaveCount(0)

  // Older versions stay viewable; their requests live under More.
  await page.getByLabel('Version', { exact: true }).selectOption('1')
  await expect(page.getByText('An older version, kept for reference.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask for a change' })).toHaveCount(0)
  await page.getByText('More', { exact: true }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Bigger headline please' }),
  ).toContainText('Done in version 2')
  await expect(
    page
      .locator('iframe[title*="version 1"]')
      .first()
      .contentFrame()
      .getByText('Version 1 portrait'),
  ).toBeVisible()
})

test('an admin approves, confirming when requests are open, and can archive', async ({ page }) => {
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads/ad-1')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  await page.getByRole('button', { name: 'Ask for a change' }).click()
  await page.getByLabel('What should change?').fill('Use the black background')
  await page.getByRole('button', { name: 'Save the request' }).click()
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Use the black background' }),
  ).toContainText('Open')

  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Approve with 1 open request?')
  await page.getByRole('button', { name: 'Not yet' }).click()
  await page.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('button', { name: 'Yes, approve as it is' }).click()
  await expect(page.getByText(/Approved by Chris Admin/)).toBeVisible()
  await expect(page.getByText('Approved').first()).toBeVisible()

  await page.getByText('More', { exact: true }).click()
  await page.getByRole('button', { name: 'Archive this ad' }).click()
  await expect(page.getByText('Archived', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Bring back from the archive' }).click()
  await expect(page.getByRole('button', { name: 'Archive this ad' })).toBeVisible()
})
