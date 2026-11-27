import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import {
  installFakeStaff,
  nowCard,
  openFold,
  primaryAction,
  signIn,
  taskAction,
  type StaffWorld,
  staffWorld,
} from './fake-staff'

/*
 * Estimates on a site visit: the staff form with its live range and email preview, the confirm
 * step, and the list and enquiry lines afterwards. Fake backend only (sample people, example.com
 * addresses). SCREENSHOTS_DIR keeps the phone-width screenshots.
 */

const NOW = '2026-11-26T12:00:00Z'

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
    submitted_at: '2026-11-18T10:00:00Z',
    updated_at: '2026-11-18T10:00:00Z',
    answers: {
      appointment_preference: 'on_site',
      project_type: 'kitchen',
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
    outcome: null,
    outcome_value: null,
    outcome_reason: null,
    outcome_note: null,
    quote_amount: null,
    quote_date: null,
    won_date: null,
    chase_flagged_at: null,
    chase_note: null,
    chase_flagged_by_name: null,
    enquiry_attribution: null,
    enquiry_events: [],
    bookings: [] as unknown[],
    estimates: [] as unknown[],
    ...over,
  }
}

function book(
  world: StaffWorld,
  e: ReturnType<typeof enquiry>,
  id: string,
  start: string,
  mode: 'phone' | 'on_site',
) {
  const row = {
    id,
    enquiry_id: e.id,
    state: 'confirmed',
    starts_at: start,
    ends_at: new Date(Date.parse(start) + 60 * 60_000).toISOString(),
    confirmed_at: '2026-11-15T10:00:00Z',
    failure_reason: null,
    calendar_event_id: `q3${id}`,
    calendar_event_link: null,
    created_at: '2026-11-15T10:00:00Z',
    attendance: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
    calendar_mismatch: null,
    appointment_types:
      mode === 'phone'
        ? { label: 'Phone consultation', mode: 'phone' }
        : { label: 'On-site estimate visit', mode: 'on_site' },
    enquiries: {
      reference: e.reference,
      answers: e.answers,
      outcome: null,
      site_details: e.site_details,
    },
  }
  world.tables.bookings = [...(world.tables.bookings ?? []), row]
  e.bookings.push({
    starts_at: start,
    confirmed_at: row.confirmed_at,
    state: 'confirmed',
    appointment_types: { mode },
  })
}

const estimate = (sent: string, requested: string | null = null) => ({
  id: `00000000-0000-4000-8000-${sent.slice(8, 10)}0000000000`,
  booking_id: null,
  price_eur: 10000,
  plus_minus_percent: 5,
  low_eur: 9500,
  high_eur: 10500,
  work_looked_at: 'Kitchen: strip out, new units, tiled floor.',
  caveats: 'This is an estimate, not a quote.',
  sent_at: sent,
  valid_until: new Date(Date.parse(sent) + 10 * 86_400_000).toISOString(),
  quote_requested_at: requested,
  created_by_name: 'Sam Staff',
})

function seed(world: StaffWorld) {
  const visited = enquiry('e-visit1', 'Brian Example')
  book(world, visited, 'b-visit', '2026-11-24T10:00:00Z', 'on_site')
  const called = enquiry('e-call01', 'Aoife Sample', {
    answers: {
      appointment_preference: 'phone',
      project_type: 'kitchen',
      location: 'Bray',
      name: 'Aoife Sample',
      email: 'aoife@example.com',
      phone: '087 765 4321',
    },
  })
  book(world, called, 'b-call', '2026-11-24T11:00:00Z', 'phone')
  const quiet = enquiry('e-quiet1', 'Ciara Test', { estimates: [estimate('2026-11-12T15:00:00Z')] })
  book(world, quiet, 'b-quiet', '2026-11-12T10:00:00Z', 'on_site')
  const asked = enquiry('e-asked1', 'Declan Sample', {
    estimates: [estimate('2026-11-23T15:00:00Z', '2026-11-25T09:00:00Z')],
  })
  book(world, asked, 'b-asked', '2026-11-23T10:00:00Z', 'on_site')
  world.tables.enquiries = [visited, called, quiet, asked]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.business.contact_phone = '01 555 0100'
  // A slice of the seeded tick-list: kitchen items, then "any job" items (one repeats a label).
  const items: [string | null, string][] = [
    ['kitchen', 'Strip out the old kitchen'],
    ['kitchen', 'New units and worktop'],
    ['kitchen', 'Tiled floor'],
    ['kitchen', 'Painting'],
    ['bathroom', 'Wall tiling'],
    [null, 'Strip out'],
    [null, 'Painting'],
    [null, 'Waste removal'],
  ]
  world.tables.estimate_work_items = items.map(([type, label], i) => ({
    id: `wi-seed-${i}`,
    label,
    project_type: type,
    archived_at: null,
    position: i + 1,
  }))
}

const chipLabels = (page: Page) =>
  page
    .getByRole('group', { name: /Work we looked at/ })
    .getByRole('checkbox')
    .evaluateAll((boxes) => boxes.map((b) => b.closest('label')?.textContent?.trim() ?? ''))

async function open(page: Page, path: string) {
  const world = staffWorld()
  seed(world)
  await page.clock.setFixedTime(new Date(NOW))
  await installFakeStaff(page, world)
  await page.goto(path)
  await signIn(page, 'staff@example.com', 'another long password')
  return world
}

test('staff write an estimate on its own screen: live range, a draft kept, check and send', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-visit1')
  // How did it go? It went ahead: the estimate screen opens, starting in the price.
  await primaryAction(page).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^It went ahead/ })
    .click()
  await expect(page).toHaveURL(/#\/enquiries\/e-visit1\/estimate$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Write the estimate' })).toBeVisible()
  await expect(page.getByText('Step 1 of 2: the estimate')).toBeVisible()
  await expect(page.getByLabel('Price in euro')).toBeFocused()
  // The bar holds the task's own action, not the stage's.
  await expect(primaryAction(page)).toHaveText('Check and send')

  // Checked like the server: a price is needed, and a ticked item or a note.
  await taskAction(page, 'Check and send').click()
  await expect(page.getByText('Enter the price in whole euro, at least €100.')).toBeVisible()
  await expect(
    page.getByText('Tick what you looked at, or write a note under Anything else.'),
  ).toBeVisible()
  await expect(page.getByLabel('Price in euro')).toBeFocused()

  // The kitchen's items, then the "any job" ones without the repeated label.
  expect(await chipLabels(page)).toEqual([
    'Strip out the old kitchen',
    'New units and worktop',
    'Tiled floor',
    'Painting',
    'Strip out',
    'Waste removal',
  ])

  // Plus or minus as chips (10% to start); the range on one line.
  await page.getByLabel('Price in euro').fill('10,000')
  await expect(page.getByRole('radio', { name: '10%', exact: true })).toBeChecked()
  await expect(page.getByText('€9,000 to €11,000, VAT included')).toBeVisible()
  await page.locator('label').filter({ hasText: /^5%$/ }).click()
  await expect(page.getByText('€9,500 to €10,500, VAT included')).toBeVisible()
  // Any other allowed value is under Other.
  await page
    .locator('label')
    .filter({ hasText: /^Other$/ })
    .click()
  await page.getByLabel('Other plus or minus').selectOption('12.5')
  await expect(page.getByText('€8,750 to €11,250, VAT included')).toBeVisible()
  await page.locator('label').filter({ hasText: /^5%$/ }).click()
  // Tick out of order; the email lists them in the order shown.
  await page.getByText('Tiled floor', { exact: true }).click()
  await page.getByText('Strip out the old kitchen', { exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Tiled floor' })).toBeChecked()
  // Add another: ticked now, offered next time for kitchens.
  await page.getByLabel('Add another').fill('  Move the   radiator ')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Move the radiator' })).toBeChecked()
  await page.getByLabel('Anything else (optional)').fill('Keep the existing window.')
  await expect(page.getByText('Saved on this device until you send it.')).toBeVisible()
  await shot(page, 'staff-estimate-form')

  // The draft is kept on this device: the enquiry says it was started and the bar carries on; the
  // list marks the row "Draft".
  await page.getByRole('link', { name: 'Back to Brian Example' }).click()
  await expect(nowCard(page)).toContainText('Estimate started, not sent (saved on this device)')
  await expect(primaryAction(page)).toHaveText('Carry on with the estimate')
  await shot(page, 'staff-estimate-draft-now')
  await page.getByRole('link', { name: 'All enquiries' }).click()
  await expect(page.getByRole('link', { name: /Brian Example/ })).toContainText('Draft ·')
  await shot(page, 'staff-estimate-draft-list')
  await page.getByRole('link', { name: /Brian Example/ }).click()
  await primaryAction(page).click()
  await expect(page.getByLabel('Price in euro')).toHaveValue('10,000')
  await expect(page.getByRole('radio', { name: '5%', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Tiled floor' })).toBeChecked()
  await expect(page.getByLabel('Anything else (optional)')).toHaveValue('Keep the existing window.')

  // Step 2: the email exactly as the customer gets it (same renderer as the worker).
  await taskAction(page, 'Check and send').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Check and send' })).toBeFocused()
  await expect(page.getByText('Step 2 of 2: the email')).toBeVisible()
  const email = page.frameLocator('iframe[title="Estimate email"]')
  await expect(email.getByText('Hello Brian,')).toBeVisible()
  await expect(email.getByText('€9,500 to €10,500, VAT included')).toBeVisible()
  await expect(email.getByRole('listitem')).toHaveText([
    'Strip out the old kitchen',
    'Tiled floor',
    'Move the radiator',
  ])
  await expect(email.getByText('Keep the existing window.')).toBeVisible()
  await expect(email.getByRole('link', { name: 'Get my quote' })).toBeVisible()
  await expect(email.getByText('01 555 0100')).toBeVisible()
  await expect(page.getByText('To: brian@example.com')).toBeVisible()
  await expect(page.getByText('Subject: Your estimate from Q3 Interiors')).toBeVisible()
  // The frame takes the email's own height: the page scrolls, never a box inside it.
  const frame = page.locator('iframe[title="Estimate email"]')
  await expect
    .poll(() =>
      frame.evaluate((f) => {
        const doc = (f as HTMLIFrameElement).contentDocument
        return doc ? doc.documentElement.scrollHeight <= f.clientHeight + 2 : false
      }),
    )
    .toBe(true)
  await expect(email.getByText(/based on what we saw|VAT included/).first()).toBeVisible()
  await shot(page, 'staff-estimate-confirm')

  // One button that names the person replaces the separate confirm.
  await taskAction(page, 'Send to Brian').click()
  await expect(page).toHaveURL(/#\/enquiries\/e-visit1$/)
  await expect(page.getByText('Estimate sent to brian@example.com.')).toBeVisible()
  const call = world.rpcCalls.find((c) => c.name === 'send_estimate')
  expect(call?.body).toEqual({
    p_booking_id: 'b-visit',
    p_price: 10000,
    p_percent: 5,
    p_work: 'Keep the existing window.',
    p_items: ['Strip out the old kitchen', 'Tiled floor', 'Move the radiator'],
  })
  expect(world.rpcCalls.find((c) => c.name === 'add_estimate_work_item')?.body).toEqual({
    p_project_type: 'kitchen',
    p_label: 'Move the radiator',
  })
  // Sent: the draft is gone.
  await expect(nowCard(page)).not.toContainText('Estimate started')
  await openFold(page, 'Estimate')
  const section = page.getByRole('region', { name: 'Estimate', exact: true })
  await expect(section.getByText(/^Estimate sent \d+ \w+: €9,500 to €10,500$/)).toBeVisible()
  await expect(section.getByRole('listitem')).toHaveText([
    'Strip out the old kitchen',
    'Tiled floor',
    'Move the radiator',
  ])
  await shot(page, 'staff-estimate-sent')

  // Next time: the added item is offered (not ticked); Edit list removes one for good.
  await section.getByRole('link', { name: 'Send an updated estimate' }).click()
  await expect(page.getByLabel('Price in euro')).toHaveValue('')
  expect(await chipLabels(page)).toContain('Move the radiator')
  await expect(page.getByRole('checkbox', { name: 'Move the radiator' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Edit list' }).click()
  await expect(page.getByRole('list', { name: 'Items offered' })).toBeVisible()
  await shot(page, 'staff-estimate-edit-list')
  await page.getByRole('button', { name: 'Remove Waste removal' }).click()
  await expect(page.getByRole('button', { name: 'Remove Waste removal' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()
  expect(await chipLabels(page)).not.toContain('Waste removal')
  expect(world.rpcCalls.find((c) => c.name === 'archive_estimate_work_item')?.body).toEqual({
    p_id: 'wi-seed-7',
  })
  // From 1024px the title and the task's action are a sticky left column, on the first screen.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByLabel('Price in euro').fill('12,000')
  const bar = await page.getByRole('region', { name: 'Actions' }).boundingBox()
  expect((bar?.y ?? 9999) + (bar?.height ?? 0)).toBeLessThanOrEqual(800)
  await page.mouse.wheel(0, 600)
  const after = await page.getByRole('region', { name: 'Actions' }).boundingBox()
  expect((after?.y ?? 9999) + (after?.height ?? 0)).toBeLessThanOrEqual(800)
  await shot(page, 'staff-estimate-desktop')
})

test('an enquiry with no project type is offered the "any job" items, and a note alone will do', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-visit1')
  const row = (world.tables.enquiries as { id: string; answers: Record<string, string> }[]).find(
    (e) => e.id === 'e-visit1',
  )
  if (row) delete row.answers.project_type
  await page.reload()
  // How did it go? It went ahead: the estimate screen opens.
  await primaryAction(page).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^It went ahead/ })
    .click()
  await expect(page.getByLabel('Price in euro')).toBeFocused()
  expect(await chipLabels(page)).toEqual(['Strip out', 'Painting', 'Waste removal'])
  await page.getByLabel('Price in euro').fill('2500')
  await page.getByLabel('Anything else (optional)').fill('Hall floor relaid on new joists.')
  await taskAction(page, 'Check and send').click()
  await taskAction(page, 'Send to Brian').click()
  await expect(page.getByText('Estimate sent to brian@example.com.')).toBeVisible()
  const call = world.rpcCalls.find((c) => c.name === 'send_estimate')
  expect(call?.body).toMatchObject({ p_items: [], p_work: 'Hall floor relaid on new joists.' })
})

test('a call never offers an estimate', async ({ page }) => {
  await open(page, '/#/enquiries/e-call01')
  await expect(page.getByRole('heading', { name: 'Aoife Sample' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Estimate' })).toHaveCount(0)
})

test('the list and the enquiry page show where each estimate stands', async ({ page }) => {
  await open(page, '/#/')
  const rows = page.getByRole('region', { name: 'Enquiries' })
  const quiet = rows.getByRole('listitem').filter({ hasText: 'Ciara Test' })
  // News first (review F6).
  await expect(quiet).toContainText('No answer')
  await expect(quiet).toContainText('Estimate €9,500 to €10,500')
  const asked = rows.getByRole('listitem').filter({ hasText: 'Declan Sample' })
  await expect(asked).toContainText('Quote due Mon 30 Nov')
  await expect(asked).toContainText('Asked for a quote 25 Nov')
  // Both are Q3's move.
  const yours = page.getByRole('region', { name: /^Your move/ })
  await expect(yours.getByRole('listitem').filter({ hasText: 'Ciara Test' })).toHaveCount(1)
  await expect(yours.getByRole('listitem').filter({ hasText: 'Declan Sample' })).toHaveCount(1)
  await shot(page, 'staff-estimate-list')
  await asked.getByRole('link').click()
  await expect(nowCard(page)).toContainText('Asked for a quote 25 Nov')
  await expect(primaryAction(page)).toHaveText('Write the quote')
})
