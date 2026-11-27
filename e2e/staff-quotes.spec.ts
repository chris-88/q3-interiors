import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld, type StaffWorld } from './fake-staff'

/*
 * Quotes: "Write the quote" from a quote request (pre-ticked from the estimate), the preview,
 * the confirm, then the quote on the enquiry and the list; a change asked for, View, Download
 * PDF and an updated version. Fake backend only. SCREENSHOTS_DIR keeps 390px screenshots.
 */

const NOW = '2026-11-27T12:00:00Z'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
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
    outcome: null as string | null,
    outcome_value: null,
    outcome_reason: null,
    outcome_note: null,
    quote_amount: null as number | null,
    quote_date: null as string | null,
    won_date: null,
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

const estimate = {
  id: '00000000-0000-4000-8000-0000000e0001',
  booking_id: null,
  price_eur: 10000,
  plus_minus_percent: 5,
  low_eur: 9500,
  high_eur: 10500,
  work_items: ['Strip out the old kitchen', 'New units and worktop', 'Tiled floor'],
  work_looked_at: null,
  caveats: 'This is an estimate, not a quote.',
  sent_at: '2026-11-23T15:00:00Z',
  valid_until: '2026-12-03T15:00:00Z',
  quote_requested_at: '2026-11-25T09:00:00Z',
  created_by_name: 'Sam Staff',
  after: 'visit',
}

const sentQuote = {
  id: '00000000-0000-4000-8000-0000000a0001',
  estimate_id: estimate.id,
  number: 'Q3-Q-0007',
  version: 1,
  price_eur: 10200,
  included: ['Strip out the old kitchen', 'New units and worktop'],
  excluded: ['Appliances'],
  note: null,
  deposit_percent: 10,
  deposit_eur: 1020,
  valid_until: '2026-12-18',
  terms: 'This quote is one price for the work listed. It’s good until Fri 18 Dec 2026.',
  sent_at: '2026-11-26T10:00:00Z',
  created_by_name: 'Sam Staff',
  pdf_path: 'e-chang1/00000000-0000-4000-8000-0000000a0001.pdf',
  change_requested_at: '2026-11-27T09:00:00Z',
  change_request_text: 'Can you add the utility room floor?',
}

function seed(world: StaffWorld) {
  const asked = enquiry('e-asked1', 'Declan Sample', { estimates: [estimate] })
  const changed = enquiry('e-chang1', 'Eimear Example', {
    estimates: [estimate],
    quotes: [sentQuote],
    outcome: 'quoted',
    quote_amount: 10200,
    quote_date: '2026-11-26',
  })
  world.tables.enquiries = [asked, changed]
  world.tables.bookings = []
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.business.contact_phone = '01 555 0100'
  world.business.legal_name = 'Q3 Interiors Limited'
  world.tables.estimate_work_items = [
    ['included', 'kitchen', 'Strip out the old kitchen'],
    ['included', 'kitchen', 'New units and worktop'],
    ['included', 'kitchen', 'Tiled floor'],
    ['included', null, 'Painting'],
    ['excluded', null, 'Extra work found once the job is opened up'],
    ['excluded', null, 'Appliances'],
    ['excluded', null, 'Planning or certification fees'],
  ].map(([kind, type, label], i) => ({
    id: `wi-${i}`,
    kind,
    label,
    project_type: type,
    archived_at: null,
    position: i + 1,
  }))
  world.quoteFiles = new Map([[sentQuote.pdf_path, Buffer.from('%PDF-1.7 sample')]])
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

const checked = (section: ReturnType<Page['getByRole']>, legend: RegExp) =>
  section
    .getByRole('group', { name: legend })
    .getByRole('checkbox', { checked: true })
    .evaluateAll((boxes) => boxes.map((b) => b.closest('label')?.textContent?.trim() ?? ''))

test('write the quote from a quote request: pre-ticked, previewed, confirmed, sent', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-asked1')
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('Quote due Mon 30 Nov')
  await expect(next.getByRole('button', { name: 'Record a quote sent another way' })).toBeVisible()
  await next.getByRole('button', { name: 'Write the quote' }).click()

  const section = page.getByRole('region', { name: 'Quote' })
  await expect(section.getByText('Pre-ticked from the estimate.')).toBeVisible()
  expect(await checked(section, /What’s included/)).toEqual([
    'Strip out the old kitchen',
    'New units and worktop',
    'Tiled floor',
  ])
  await section
    .getByRole('group', { name: /What’s not included/ })
    .getByText('Appliances', { exact: true })
    .click()
  await section.getByLabel('Price in euro').fill('10,200')
  await expect(section.getByText('Deposit: €1,020 (10% of the price)')).toBeVisible()
  const doc = page.frameLocator('iframe[title="Quote preview"]')
  await expect(doc.getByText('€10,200')).toBeVisible()
  await expect(doc.getByText('What’s not included')).toBeVisible()
  await expect(doc.getByText(/A 10% deposit of €1,020 books your start date/)).toBeVisible()
  await expect(doc.getByText(/It’s good until Fri 18 Dec 2026/)).toBeVisible()
  await shot(page, 'staff-quote-form')

  await section.getByRole('button', { name: 'Send quote' }).click()
  const confirm = section.getByRole('alertdialog')
  await expect(confirm).toContainText('Send the quote for €10,200 to declan@example.com?')
  await confirm.getByRole('button', { name: 'Yes, send it' }).click()
  await expect(section).toContainText('Quote sent to declan@example.com.')
  expect(world.rpcCalls.find((c) => c.name === 'send_quote')?.body).toEqual({
    p_enquiry_id: 'e-asked1',
    p_price: 10200,
    p_included: ['Strip out the old kitchen', 'New units and worktop', 'Tiled floor'],
    p_excluded: ['Appliances'],
    p_note: null,
    p_estimate_id: estimate.id,
  })
  await expect(next).toContainText('Quote Q3-Q-0001 sent 27 Nov: €10,200')
  // Mark won and Mark lost stay.
  await expect(next.getByRole('button', { name: 'Mark won' })).toBeVisible()
  await shot(page, 'staff-quote-sent')
})

test('a change asked for: needs action, the words, View, PDF, and an updated version', async ({
  page,
}) => {
  const world = await open(page, '/#/')
  const row = page.getByRole('link', { name: /Eimear Example/ })
  await expect(row).toContainText('Updated quote due Wed 2 Dec')
  await expect(page.getByRole('region', { name: /^Your move/ })).toContainText('Eimear Example')
  await row.click()

  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('Quote Q3-Q-0007 sent 26 Nov: €10,200')
  await expect(next).toContainText('Can you add the utility room floor?')
  await next.getByRole('button', { name: 'View' }).click()
  await expect(
    next.frameLocator('iframe[title="Quote Q3-Q-0007"]').getByText('Q3-Q-0007', { exact: true }),
  ).toBeVisible()
  await shot(page, 'staff-quote-view')
  const download = page.waitForEvent('download')
  await next.getByRole('button', { name: 'Download PDF' }).click()
  expect((await download).suggestedFilename()).toBe('Q3-Q-0007.pdf')

  await next.getByRole('button', { name: 'Send an updated quote' }).click()
  const section = page.getByRole('region', { name: 'Quote' })
  await expect(section.getByText('This replaces Q3-Q-0007 version 1.')).toBeVisible()
  await expect(section.getByLabel('Price in euro')).toHaveValue('10200')
  await section
    .getByRole('group', { name: /What’s included/ })
    .getByText('Tiled floor', { exact: true })
    .click()
  await section.getByLabel('Price in euro').fill('11000')
  await section.getByRole('button', { name: 'Send the updated quote' }).click()
  await section.getByRole('alertdialog').getByRole('button', { name: 'Yes, send it' }).click()
  await expect(next).toContainText('Quote Q3-Q-0007 (version 2) sent 27 Nov: €11,000')
  expect(world.rpcCalls.find((c) => c.name === 'send_quote')?.body).toMatchObject({
    p_price: 11000,
    p_included: ['Strip out the old kitchen', 'New units and worktop', 'Tiled floor'],
    p_excluded: ['Appliances'],
  })
})
