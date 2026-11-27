import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld, type StaffWorld } from './fake-staff'

/*
 * Estimates on a site visit: the staff form with its live range and email preview, the confirm
 * step, and the list and enquiry lines afterwards. Fake backend only (sample people, example.com
 * addresses). SCREENSHOTS_DIR keeps the phone-width screenshots.
 */

const NOW = '2026-11-26T12:00:00Z'

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

test('staff write an estimate on a site visit: live range, email preview, confirm, sent', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-visit1')
  const section = page.getByRole('region', { name: 'Estimate' })
  await expect(section).toContainText('No estimate sent yet.')
  await section.getByRole('button', { name: 'Write an estimate' }).click()

  // Checked like the server: a price is needed, the work too.
  await section.getByRole('button', { name: 'Send estimate' }).click()
  await expect(section.getByText('Enter the price in whole euro, at least €100.')).toBeVisible()
  await expect(section.getByLabel('Price in euro')).toBeFocused()

  await section.getByLabel('Price in euro').fill('10,000')
  await expect(section.getByLabel('Plus or minus')).toHaveValue('10')
  await expect(section.getByText('€9,000 to €11,000, VAT included')).toBeVisible()
  await section.getByLabel('Plus or minus').selectOption('5')
  await expect(section.getByText('€9,500 to €10,500, VAT included')).toBeVisible()
  await section.getByLabel('Work we looked at').fill('Kitchen: strip out, new units, tiled floor.')

  // The email exactly as the customer gets it (same renderer as the worker).
  const email = section.frameLocator('iframe[title="Estimate email preview"]')
  await expect(email.getByText('Hello Brian,')).toBeVisible()
  await expect(email.getByText('€9,500 to €10,500, VAT included')).toBeVisible()
  await expect(email.getByText('Kitchen: strip out, new units, tiled floor.')).toBeVisible()
  await expect(email.getByRole('link', { name: 'Get my quote' })).toBeVisible()
  await expect(email.getByText('01 555 0100')).toBeVisible()
  await expect(section).toContainText('Subject: Your estimate from Q3 Interiors')
  await expect(section.getByText('Enter the price in whole euro, at least €100.')).toHaveCount(0)
  await section.locator('iframe[title="Estimate email preview"]').scrollIntoViewIfNeeded()
  await shot(page, 'staff-estimate-form')

  await section.getByRole('button', { name: 'Send estimate' }).click()
  const confirm = section.getByRole('alertdialog')
  await expect(confirm).toContainText('Send €9,500 to €10,500 to brian@example.com?')
  await shot(page, 'staff-estimate-confirm')
  await confirm.getByRole('button', { name: 'Yes, send it' }).click()
  await expect(section).toContainText('Estimate sent to brian@example.com.')
  await expect(section.getByText(/^Estimate sent \d+ \w+: €9,500 to €10,500$/)).toBeVisible()
  const call = world.rpcCalls.find((c) => c.name === 'send_estimate')
  expect(call?.body).toEqual({
    p_booking_id: 'b-visit',
    p_price: 10000,
    p_percent: 5,
    p_work: 'Kitchen: strip out, new units, tiled floor.',
  })
  await expect(section.getByRole('button', { name: 'Send an updated estimate' })).toBeVisible()
  await shot(page, 'staff-estimate-sent')
})

test('a call never offers an estimate', async ({ page }) => {
  await open(page, '/#/enquiries/e-call01')
  await expect(page.getByRole('heading', { name: 'Aoife Sample' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Estimate' })).toHaveCount(0)
})

test('the list and the enquiry page show where each estimate stands', async ({ page }) => {
  await open(page, '/#/')
  const rows = page.getByRole('list', { name: 'Enquiries' })
  const quiet = rows.getByRole('listitem').filter({ hasText: 'Ciara Test' })
  await expect(quiet).toContainText(
    'Estimate sent 12 Nov: €9,500 to €10,500 · No answer in 10 days',
  )
  await expect(quiet).toContainText('No answer in 10 days')
  const asked = rows.getByRole('listitem').filter({ hasText: 'Declan Sample' })
  await expect(asked).toContainText(
    'Estimate sent 23 Nov: €9,500 to €10,500 · Quote requested 25 Nov',
  )
  await page.getByRole('radio', { name: /Needs action/ }).check({ force: true })
  await expect(rows.getByRole('listitem').filter({ hasText: 'Ciara Test' })).toHaveCount(1)
  await shot(page, 'staff-estimate-list')
  await asked.getByRole('link').click()
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('Quote requested 25 Nov')
  await expect(next).toContainText('They asked for their quote.')
})
