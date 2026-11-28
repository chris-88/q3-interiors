import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { STAGE_TEMPLATES } from './fake-job-plan'
import {
  installFakeStaff,
  nowCard,
  openFold,
  primaryAction,
  signIn,
  type StaffWorld,
  staffWorld,
} from './fake-staff'

/*
 * The job plan (slice 1): start from the job type's stages, add a new product on one job, reuse
 * it on a second job after its usual price changed (the first keeps its price), give a stage a
 * tradesperson, tick items got and a stage done; the table from 1024px. Fake backend only, sample
 * people. SCREENSHOTS_DIR keeps the screenshots.
 */

const NOW = '2026-11-28T12:00:00Z'

const shot = async (page: Page, name: string) => {
  const width = page.viewportSize()?.width ?? 390
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

function enquiry(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    reference: `Q3-${id.slice(2, 8).toUpperCase()}`,
    status: 'contacted',
    status_reason: null,
    form_id: 'enquiry',
    form_version: 2,
    submitted_at: '2026-11-10T10:00:00Z',
    updated_at: '2026-11-10T10:00:00Z',
    answers: {
      appointment_preference: 'on_site',
      project_type: 'bathroom',
      location: 'Dublin 8',
      name,
      email: `${name.split(' ')[0]?.toLowerCase()}@example.com`,
      phone: '087 765 4321',
      site_street: '12 Example Road',
    },
    marketing_opt_in: false,
    marketing_opt_in_at: null,
    site_details: { site_address: '12 Example Road, Dublin 8' },
    site_details_form_version: 1,
    contact_requested_at: null,
    contact_request_reason: null,
    added_after_booking_at: null,
    prepare_details: null,
    prepare_form_version: null,
    outcome: 'won',
    outcome_value: 12000,
    outcome_reason: null,
    outcome_note: null,
    quote_amount: 12000,
    quote_date: '2026-11-20',
    won_date: '2026-11-25',
    chase_flagged_at: null,
    chase_note: null,
    chase_flagged_by_name: null,
    call_held_at: null,
    visit_link_sent_at: null,
    enquiry_attribution: null,
    enquiry_events: [],
    bookings: [] as unknown[],
    estimates: [] as unknown[],
    quotes: [] as unknown[],
    ...over,
  }
}

function seed(world: StaffWorld) {
  world.tables.enquiries = [
    enquiry('e-plan01', 'Aoife Sample'),
    enquiry('e-plan02', 'Brian Example'),
    enquiry('e-open01', 'Ciara Test', { outcome: 'quoted', won_date: null, outcome_value: null }),
  ]
  world.tables.bookings = []
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.tables.stage_templates = STAGE_TEMPLATES.map((t) => ({ ...t }))
  world.tables.job_stages = []
  world.tables.job_materials = []
  world.tables.products = [
    {
      id: 'product-grout',
      name: 'Grout white',
      unit: 'bag',
      price_cents: 1200,
      supplier: null,
      archived_at: null,
    },
  ]
  world.tables.tradespeople = []
}

/** A few supplier catalogue rows (prices VAT included), beside his own. */
function seedCatalogue(world: StaffWorld) {
  const cat = (sku: string, name: string, price: number, category: string) => ({
    id: `cat-${sku}`,
    name,
    unit: 'each',
    price_cents: price,
    supplier: 'Goodwins',
    archived_at: null,
    source: 'goodwins',
    supplier_sku: sku,
    source_url: `https://www.goodwins.example/products/${sku}.html`,
    category,
    supplier_price_cents: price,
    price_edited_at: null,
  })
  world.tables.products = [
    ...(world.tables.products ?? []),
    {
      id: 'product-own-cement',
      name: 'White cement',
      unit: 'bag',
      price_cents: 1150,
      supplier: null,
      archived_at: null,
    },
    cat('0011011', "O'Brien Premium White Cement 25kg Bag", 1280, 'Building > Cement'),
    cat('0011016', 'Hydrated Lime 25Kg', 1375, 'Building > Cement'),
    cat('6000710', 'K Post Setting Cement (Postmix) 20kg', 935, 'Building > Cement Mixes'),
  ]
}

async function open(page: Page, path: string) {
  const world = staffWorld()
  seed(world)
  await page.clock.setFixedTime(new Date(NOW))
  await installFakeStaff(page, world)
  await page.goto(path)
  await signIn(page, 'staff@example.com', 'another long password')
  return world
}

const stage = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

async function addNewProduct(
  page: Page,
  stageName: string,
  name: string,
  price: string,
  unit: string,
) {
  const s = stage(page, stageName)
  await s.getByLabel(`Add item to ${stageName}`).fill(name)
  await s.getByRole('button', { name: `Add “${name}” as new` }).click()
  await s.getByLabel('Price each (€)').fill(price)
  await s.getByLabel('Unit').fill(unit)
  await s.getByRole('button', { name: 'Save and add' }).click()
}

test('a won job: start the plan from its stages, add a new product, a tradesperson, got it, done', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-plan01')
  // The won job's one action is its plan; the fold says it is not started.
  await expect(primaryAction(page)).toHaveText('Open the job plan')
  await expect(page.locator('#fold-plan summary')).toContainText('Not started')
  await primaryAction(page).click()

  await expect(page).toHaveURL(/#\/enquiries\/e-plan01\/plan$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Job plan' })).toBeFocused()
  await expect(
    page.getByRole('list', { name: 'The usual stages' }).getByRole('listitem'),
  ).toHaveText(['Strip out', 'First fix plumbing', 'Tiling', 'Sanitaryware', 'Painting and finish'])
  await shot(page, 'plan-start-390')
  await page
    .getByRole('region', { name: 'Actions' })
    .getByRole('button', { name: 'Start the plan' })
    .click()
  await expect(stage(page, 'Tiling')).toBeVisible()
  expect(world.rpcCalls.find((c) => c.name === 'start_job_plan')?.body).toEqual({
    p_enquiry_id: 'e-plan01',
  })

  // Search the product list as he types: the match first, then "Add … as new".
  const tiling = stage(page, 'Tiling')
  await tiling.getByLabel('Add item to Tiling').fill('grou')
  await expect(tiling.getByRole('button', { name: /^Grout white/ })).toBeVisible()
  await tiling.getByRole('button', { name: /^Grout white/ }).click()
  await expect(tiling.getByRole('list', { name: 'Items for Tiling' })).toContainText('1 bag × €12')

  // A new product: saved to the list and added to the stage.
  await addNewProduct(page, 'Tiling', 'Wall tile white', '24.50', 'm2')
  const items = tiling.getByRole('list', { name: 'Items for Tiling' })
  await expect(items).toContainText('Wall tile white')
  await expect(items).toContainText('1 m2 × €24.50')
  // Quantity on the line: 12.5 m2 → €306.25; the stage and job totals follow.
  await items.getByRole('button', { name: /^Wall tile white/ }).click()
  await tiling.getByLabel('Quantity').fill('12.5')
  await tiling.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(items).toContainText('€306.25')
  await expect(tiling).toContainText('2 items · 0 got · €318.25')
  await expect(page.getByText('€318.25 · 2 items, 0 got')).toBeVisible()
  expect(world.rpcCalls.find((c) => c.name === 'add_product')?.body).toEqual({
    p_name: 'Wall tile white',
    p_unit: 'm2',
    p_price_cents: 2450,
    p_supplier: '',
  })

  // A tradesperson, added in place and given the stage.
  await tiling.getByLabel('Tradesperson for Tiling').selectOption({ label: 'Add someone new…' })
  await tiling.getByLabel('Name', { exact: true }).fill('Tom Sample')
  await tiling.getByLabel('Trade (optional)').fill('Tiler')
  await tiling.getByRole('button', { name: 'Save and assign' }).click()
  await expect(tiling.getByLabel('Tradesperson for Tiling')).toHaveValue(/person-/)
  await expect(tiling.getByLabel('Tradesperson for Tiling').locator('option:checked')).toHaveText(
    'Tom Sample (Tiler)',
  )

  // Got it, and the stage done.
  await tiling.getByRole('checkbox', { name: 'Got it: Grout white' }).check()
  await expect(tiling).toContainText('2 items · 1 got')
  await tiling.getByRole('checkbox', { name: /^Done/ }).check()
  await expect(tiling.getByRole('checkbox', { name: /^Done/ })).toBeChecked()
  expect(world.rpcCalls.filter((c) => c.name === 'set_job_stage_done').map((c) => c.body)).toEqual([
    { p_stage_id: expect.any(String), p_done: true },
  ])
  await shot(page, 'plan-390')

  // Stages: add one, move it up, rename it.
  await page.getByLabel('Add a stage').fill('Snagging')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const snag = stage(page, 'Snagging')
  await snag.getByText('Change stage').click()
  await snag.getByRole('button', { name: 'Move up' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Strip out',
    'First fix plumbing',
    'Tiling',
    'Sanitaryware',
    'Snagging',
    'Painting and finish',
  ])

  // Back on the enquiry: the fold's summary and the history.
  await page.getByRole('link', { name: 'Back to Aoife Sample' }).click()
  await expect(page.locator('#fold-plan summary')).toContainText('6 stages · 2 items · €318.25')
  await expect(nowCard(page)).toContainText('Result')
  await openFold(page, 'Plan')
  await expect(page.locator('#fold-plan')).toContainText('Tom Sample')
  await openFold(page, 'Notes and history')
  await expect(page.getByRole('region', { name: 'History' })).toContainText('Job plan started')
  await expect(page.getByRole('region', { name: 'History' })).toContainText('Tiling done')
})

test('the product list grows: reuse a product on a second job after its usual price changed', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-plan01/plan')
  await page
    .getByRole('region', { name: 'Actions' })
    .getByRole('button', { name: 'Start the plan' })
    .click()
  await addNewProduct(page, 'Tiling', 'Wall tile white', '24.50', 'm2')
  await expect(stage(page, 'Tiling')).toContainText('€24.50')

  // Settings > Product list: a new usual price for future jobs.
  await page.getByRole('link', { name: 'Your product list' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Product list' })).toBeVisible()
  const list = page.getByRole('list', { name: 'Products' })
  await list.getByRole('button', { name: 'Change Wall tile white' }).click()
  await expect(
    page.getByText('Jobs already planned keep the price they were planned at.'),
  ).toBeVisible()
  await page.getByLabel('Usual price each (€)').fill('26')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(list).toContainText('€26 / m2')
  await shot(page, 'products-390')

  // The second job: search, pick, and the new usual price.
  await page.goto('/#/enquiries/e-plan02/plan')
  await page
    .getByRole('region', { name: 'Actions' })
    .getByRole('button', { name: 'Start the plan' })
    .click()
  const tiling = stage(page, 'Tiling')
  await tiling.getByLabel('Add item to Tiling').fill('wall')
  await tiling.getByRole('button', { name: /^Wall tile white/ }).click()
  await expect(tiling.getByRole('list', { name: 'Items for Tiling' })).toContainText('1 m2 × €26')
  // No duplicate product was made.
  expect(world.rpcCalls.filter((c) => c.name === 'add_product')).toHaveLength(1)

  // The first job kept the price it was planned at.
  await page.goto('/#/enquiries/e-plan01/plan')
  await expect(stage(page, 'Tiling').getByRole('list', { name: 'Items for Tiling' })).toContainText(
    '1 m2 × €24.50',
  )
})

test('from 1024px the plan is one table; no plan before the job is won', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, '/#/enquiries/e-plan01/plan')
  await page
    .getByRole('region', { name: 'Actions' })
    .getByRole('button', { name: 'Start the plan' })
    .click()
  const table = page.getByRole('table', { name: /The job plan/ })
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader')).toHaveText([
    'Stage',
    'Item',
    'Qty',
    'Unit',
    'Price each',
    'Total',
    'Got it',
    'Tradesperson',
  ])
  await table.getByLabel('Add item to Tiling').fill('grout')
  await table.getByRole('button', { name: /^Grout white/ }).click()
  await expect(table.getByRole('row').filter({ hasText: 'Grout white' })).toContainText('€12')
  await expect(table.getByRole('row').filter({ hasText: 'Job total' })).toContainText('€12')
  await shot(page, 'plan-1280')

  await page.goto('/#/enquiries/e-open01/plan')
  await expect(page.getByText('A plan starts once the job is won.')).toBeVisible()
  await page.goto('/#/enquiries/e-open01')
  await expect(page.locator('#fold-plan')).toHaveCount(0)
})

test('Tradespeople under Settings: add, change, archive', async ({ page }) => {
  await open(page, '/#/settings')
  await page.getByRole('link', { name: /^Tradespeople/ }).click()
  await page.getByRole('button', { name: 'Add a tradesperson' }).click()
  await page.getByLabel('Name').fill('Tom Sample')
  await page.getByLabel('Trade (optional)').fill('Plumber')
  await page.getByLabel('Phone (optional)').fill('087 000 0000')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const list = page.getByRole('list', { name: 'Tradespeople' })
  await expect(list).toContainText('Plumber · 087 000 0000')
  await expect(list.getByRole('link', { name: 'Ring Tom Sample' })).toHaveAttribute(
    'href',
    'tel:0870000000',
  )
  await list.getByRole('button', { name: 'Archive Tom Sample' }).click()
  await expect(list).toHaveCount(0)
  await page.getByLabel('Show archived (1)').check()
  await expect(page.getByRole('list', { name: 'Tradespeople' })).toContainText(
    'Tom Sample (archived)',
  )
  await shot(page, 'tradespeople-390')
})

test('the catalogue: search in any word order, his own first, the supplier and inc VAT on catalogue rows; the list filter', async ({
  page,
}) => {
  const world = staffWorld()
  seed(world)
  seedCatalogue(world)
  await page.clock.setFixedTime(new Date(NOW))
  await installFakeStaff(page, world)
  await page.goto('/#/enquiries/e-plan01/plan')
  await signIn(page, 'staff@example.com', 'another long password')
  await page
    .getByRole('region', { name: 'Actions' })
    .getByRole('button', { name: 'Start the plan' })
    .click()

  // Used on a job comes first: put the lime on Strip out.
  const strip = stage(page, 'Strip out')
  await strip.getByLabel('Add item to Strip out').fill('lime')
  await strip.getByRole('button', { name: /^Hydrated Lime 25Kg/ }).click()
  await expect(strip.getByRole('list', { name: 'Items for Strip out' })).toContainText(
    '1 each × €13.75',
  )

  // "cement white": words in any order; his own first, then the catalogue, which says where from.
  const tiling = stage(page, 'Tiling')
  await tiling.getByLabel('Add item to Tiling').fill('cement white')
  const matches = tiling.getByRole('list', { name: 'Matches for cement white' })
  await expect(matches.getByRole('button')).toHaveText([
    /^White cement.*€11\.50 \/ bag/,
    /^O'Brien Premium White Cement 25kg Bag.*Building > Cement.*€12\.80 inc VAT · Goodwins/,
    'Add “cement white” as new',
  ])
  await tiling.getByLabel('Add item to Tiling').fill('lime')
  await expect(
    tiling.getByRole('list', { name: 'Matches for lime' }).getByRole('button').first(),
  ).toContainText('Used before')
  await shot(page, 'plan-catalogue-search-390')

  // Settings > Product list: Mine and used by default (the catalogue does not bury his own).
  await page.goto('/#/settings/products')
  const list = page.getByRole('list', { name: 'Products' })
  await expect(page.getByRole('radio', { name: 'Mine and used' })).toBeChecked()
  await expect(list).toContainText('Hydrated Lime 25Kg')
  await expect(list).toContainText('White cement')
  await expect(list).not.toContainText("O'Brien")
  await page
    .locator('label')
    .filter({ hasText: /^Goodwins$/ })
    .click()
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await expect(list).toContainText("O'Brien Premium White Cement 25kg Bag")
  const link = list.getByRole('link', { name: /View on Goodwins.*O'Brien/ })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(list).toContainText('Building > Cement Mixes')
  await shot(page, 'products-goodwins-390')

  // Changing a catalogue price: his price kept, the supplier's shown beside it.
  await list.getByRole('button', { name: "Change O'Brien Premium White Cement 25kg Bag" }).click()
  await expect(page.getByText(/later Goodwins updates keep yours/)).toBeVisible()
  await page.getByLabel('Usual price each (€)').fill('11')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(list).toContainText('€11 / each, your price · Goodwins €12.80 inc VAT')
})
