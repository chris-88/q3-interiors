import { expect, test, type Page } from '@playwright/test'
import { installFakeStaff, signIn, type StaffWorld } from './fake-staff'

// The Ads page by campaign: which campaign published which ads, how each did (best first), and
// which enquiries came from each ad. Sample data only.

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const link = (content: string) =>
  `https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid&utm_campaign=type-test-1&utm_content=${content}#/`

function ad(
  world: StaffWorld,
  id: string,
  name: string,
  status: string,
  creative: string | null,
  position: number,
  content = '',
) {
  const path = `${id}/v1/portrait.png`
  world.adFiles.set(path, { body: PNG, type: 'image/png' })
  return {
    id,
    name,
    status,
    set_name: creative ? 'Type test 1' : 'Samples',
    set_position: position,
    created_at: '2026-11-26T10:00:00Z',
    created_by_name: 'Ad studio (Claude session)',
    campaign_creative_id: creative,
    ad_versions: [
      {
        id: `${id}-v1`,
        version: 1,
        caption: `${name} Talk to us.`,
        headline: name,
        button_label: 'Learn more',
        notes: null,
        link_url: content ? link(content) : null,
        created_at: '2026-11-26T10:00:00Z',
        // Approved the way live data is: the ad's status and the version's stamp agree.
        approved_at: status === 'approved' ? '2026-11-27T09:00:00Z' : null,
        approved_by_name: status === 'approved' ? 'Chris Admin' : null,
        ad_variants: [
          {
            id: `${id}-portrait`,
            size: 'portrait',
            width: 1080,
            height: 1350,
            html_path: `${id}/v1/portrait.html`,
            export_path: path,
            export_bytes: PNG.length,
          },
        ],
      },
    ],
    ad_requests: [],
    ad_events: [],
  }
}

const row = (dim: string, key: string, over: Record<string, unknown> = {}) => ({
  dim,
  key,
  sessions: 0,
  chose: 0,
  saved: 0,
  booked: 0,
  attended: 0,
  suitable_attended: 0,
  chased: 0,
  quoted: 0,
  won: 0,
  won_value: 0,
  median_to_saved_seconds: null,
  median_to_booked_seconds: null,
  ...over,
})

function enquiry(id: string, name: string, content: string, over: Record<string, unknown> = {}) {
  return {
    id,
    reference: `Q3-${id.toUpperCase()}`,
    status: 'new',
    form_id: 'enquiry',
    form_version: 2,
    submitted_at: '2026-11-28T10:00:00Z',
    answers: { name, email: `${id}@example.com`, project_type: 'kitchen', location: 'Dublin 8' },
    contact_requested_at: null,
    bookings: [],
    estimates: [],
    quotes: [],
    enquiry_attribution: {
      utm_campaign: 'type-test-1',
      utm_content: content,
    },
    ...over,
  }
}

function seed(world: StaffWorld) {
  world.tables.campaigns = [
    {
      id: 'k1',
      name: 'Type test 1',
      slug: 'type-test-1',
      utm_source: 'instagram',
      utm_medium: 'paid',
      landing_route: '/',
      notes: null,
      archived_at: null,
      link_used_at: '2026-11-27T10:00:00Z',
      created_at: '2026-11-27T10:00:00Z',
    },
  ]
  world.tables.campaign_creatives = [
    {
      id: 'cr-price',
      campaign_id: 'k1',
      label: 'Price first',
      slug: 'price-first-animated',
      running: false,
      archived_at: null,
    },
    {
      id: 'cr-kitchen',
      campaign_id: 'k1',
      label: 'Kitchen calls',
      slug: 'kitchen-calls-animated',
      running: true,
      archived_at: null,
    },
    {
      id: 'cr-bath',
      campaign_id: 'k1',
      label: 'Bathroom',
      slug: 'bathroom-animated',
      running: false,
      archived_at: null,
    },
  ]
  world.tables.ads = [
    ad(
      world,
      'a-price',
      'Know the price before work starts.',
      'approved',
      'cr-price',
      1,
      'price-first-animated',
    ),
    ad(
      world,
      'a-kitchen',
      'A new kitchen shouldn’t take ten phone calls.',
      'approved',
      'cr-kitchen',
      2,
      'kitchen-calls-animated',
    ),
    ad(world, 'a-bath', 'Bathroom past its best?', 'approved', 'cr-bath', 3, 'bathroom-animated'),
    ad(world, 'a-sample', 'Planning a home renovation?', 'approved', null, 1),
  ]
  world.pilot = {
    counted_from: '2026-11-01T00:00:00Z',
    rows: [
      row('all', 'all', { sessions: 320, saved: 6, booked: 3 }),
      row('campaign', 'type-test-1', { sessions: 300, saved: 6, booked: 3, quoted: 1, won: 1 }),
    ],
    headline: { instagram_sessions: 300, instagram_suitable_attended: 2 },
  }
  world.pilotByContent['type-test-1'] = {
    campaign: 'type-test-1',
    cap: 25,
    rows: [
      row('content', 'price-first-animated', { sessions: 120, saved: 2, booked: 1 }),
      row('content', 'kitchen-calls-animated', { sessions: 90, saved: 4, booked: 2, won: 1 }),
      row('content', 'bathroom-animated', { sessions: 90 }),
    ],
  }
  world.tables.campaign_spend = [
    {
      id: 's1',
      campaign_id: 'k1',
      spent_on: '2026-11-28',
      amount_cents: 3000,
      note: null,
      created_by_name: 'Chris Admin',
    },
    {
      id: 's2',
      campaign_id: 'k1',
      spent_on: '2026-11-29',
      amount_cents: 3000,
      note: null,
      created_by_name: 'Chris Admin',
    },
  ]
  // Newest first, as the server orders them (the fake does not sort).
  world.tables.enquiries = [
    enquiry('e2', 'Brian Example', 'kitchen-calls-animated', {
      submitted_at: '2026-11-29T10:00:00Z',
      outcome: 'won',
      outcome_value: 18000,
    }),
    enquiry('e1', 'Aoife Example', 'kitchen-calls-animated', {
      submitted_at: '2026-11-20T10:00:00Z',
    }),
    enquiry('e3', 'Ciara Example', 'price-first-animated'),
  ]
}

const rows = (page: Page) => page.getByRole('region', { name: 'Type test 1' }).getByRole('listitem')

test('an admin sees the campaign, its ads best first, spend, and marks one running', async ({
  page,
}) => {
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  const campaign = page.getByRole('region', { name: 'Type test 1' })
  await expect(campaign).toContainText('Set up 27 Nov · Spend 28 Nov to 29 Nov')
  await expect(campaign).toContainText('Visits300')
  await expect(campaign).toContainText('Enquiries6')
  await expect(campaign).toContainText('Booked3')
  await expect(campaign).toContainText('Won1')
  await expect(campaign).toContainText('Per enquiry€10.00')
  // Spend is a fold: its title, the summary, a chevron.
  await expect(campaign.locator('summary')).toHaveText(/^Spend€60\.00 so far$/)
  await expect(campaign).toContainText('1 of 3 running')
  await expect(campaign).toContainText('Best first: most enquiries, then most booked.')
  // Best first: kitchen (4 enquiries), price (2), bathroom (0).
  await expect(rows(page)).toHaveCount(3)
  await expect(rows(page).nth(0)).toContainText('A new kitchen')
  await expect(rows(page).nth(0)).toContainText('90 visits · 4 enquiries · 2 booked · 1 won')
  await expect(rows(page).nth(0)).toContainText('Running')
  await expect(rows(page).nth(1)).toContainText('Know the price')
  await expect(rows(page).nth(2)).toContainText('Bathroom')
  // The ad not in a campaign is listed under its own heading, without numbers.
  const loose = page.getByRole('region', { name: 'Not in a campaign' })
  await expect(loose).toContainText('Planning a home renovation?')
  await expect(loose).not.toContainText('visits')
  await shot(page, 'ads-by-campaign')

  // The ad page walks the ranked order it was opened from.
  await rows(page).nth(1).click()
  const walk = page.getByRole('navigation', { name: 'Ads in this list' })
  await expect(walk).toContainText('2 of 4')
  await walk.getByRole('link', { name: 'Previous' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A new kitchen shouldn’t take ten phone calls.',
  )
  await walk.getByRole('link', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Know the price before work starts.',
  )
  // Approved (as live data is): no Approve, and Download is the one filled button.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  const filled = page.locator(
    'main [data-slot="button"].bg-primary:not([aria-pressed="true"]), main a.bg-primary',
  )
  await expect(filled).toHaveCount(1)
  await expect(filled).toHaveText(/^Download/)

  // The ad page: its campaign, running, and the enquiries it brought.
  const camp = page.getByRole('region', { name: 'Campaign: Type test 1' })
  await expect(camp).toContainText('Not marked as running.')
  await camp.getByRole('button', { name: 'Mark as running' }).click()
  await expect(camp).toContainText('Running in this campaign.')
  expect(
    (world.tables.campaign_creatives as { id: string; running: boolean }[]).find(
      (c) => c.id === 'cr-price',
    )?.running,
  ).toBe(true)
  const from = page.getByRole('region', { name: 'Enquiries from this ad' })
  await expect(from.getByRole('listitem')).toHaveCount(1)
  await expect(from).toContainText('Ciara Example')
  await expect(from.getByRole('link')).toHaveAttribute('href', '#/enquiries/e3')
  await shot(page, 'ad-enquiries')
})

test('staff see numbers and enquiries but no spend, and cannot mark running', async ({ page }) => {
  const world = await installFakeStaff(page)
  seed(world)
  await page.goto('/#/ads')
  await signIn(page, 'staff@example.com', 'another long password')
  const campaign = page.getByRole('region', { name: 'Type test 1' })
  await expect(campaign).toContainText('Enquiries6')
  await expect(campaign).toContainText('Set up 27 Nov')
  await expect(campaign).not.toContainText('Per enquiry')
  await expect(campaign).not.toContainText('so far')
  await expect(campaign.getByText('Spend', { exact: true })).toHaveCount(0)
  await rows(page).nth(0).click()
  await expect(page.getByRole('button', { name: /Mark as/ })).toHaveCount(0)
  const from = page.getByRole('region', { name: 'Enquiries from this ad' })
  // Newest first, each with its stage.
  await expect(from.getByRole('listitem')).toHaveCount(2)
  await expect(from.getByRole('listitem').nth(0)).toContainText('Brian Example')
  await expect(from.getByRole('listitem').nth(0)).toContainText('Won')
  await expect(from.getByRole('listitem').nth(1)).toContainText('Aoife Example')
  // The due chip from the stage model sits beside the name, as on the enquiries list.
  await expect(from.getByRole('listitem').nth(1)).toContainText('Overdue')
})

test('without spend, cost per enquiry is unknown, never zero', async ({ page }) => {
  const world = await installFakeStaff(page)
  seed(world)
  world.tables.campaign_spend = []
  await page.goto('/#/ads')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  const campaign = page.getByRole('region', { name: 'Type test 1' })
  await expect(campaign).toContainText('Per enquiryUnknown')
  await expect(campaign.locator('summary')).toHaveText('SpendNone entered')
  await expect(campaign).not.toContainText('€0')
})
