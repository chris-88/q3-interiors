import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import {
  chooseAction,
  installFakeStaff,
  primaryAction,
  signIn,
  taskAction,
  staffWorld,
  type StaffWorld,
} from './fake-staff'

/*
 * Moving a customer on after the introductory call: "We already spoke", then the three next
 * steps (an estimate from the call, staff booking the site visit, a booking link). Fake backend
 * only (sample people, example.com addresses). SCREENSHOTS_DIR keeps 390px screenshots.
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
    submitted_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    answers: {
      appointment_preference: 'phone',
      project_type: 'kitchen',
      location: 'Dublin 8',
      name,
      email: `${name.split(' ')[0]?.toLowerCase()}@example.com`,
      phone: '087 765 4321',
    } as Record<string, string>,
    marketing_opt_in: false,
    marketing_opt_in_at: null,
    site_details: null as Record<string, string> | null,
    site_details_form_version: null,
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
    call_held_at: null as string | null,
    visit_link_sent_at: null as string | null,
    enquiry_attribution: null,
    enquiry_events: [],
    bookings: [] as unknown[],
    estimates: [] as unknown[],
    ...over,
  }
}

function bookCall(
  world: StaffWorld,
  e: ReturnType<typeof enquiry>,
  id: string,
  start: string,
  attendance: string | null = null,
) {
  const row = {
    id,
    enquiry_id: e.id,
    state: 'confirmed',
    starts_at: start,
    ends_at: new Date(Date.parse(start) + 20 * 60_000).toISOString(),
    confirmed_at: '2026-11-20T10:05:00Z',
    failure_reason: null,
    calendar_event_id: `q3${id}`,
    calendar_event_link: null,
    created_at: '2026-11-20T10:05:00Z',
    attendance,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
    calendar_mismatch: null,
    appointment_types: { label: 'Phone consultation', mode: 'phone' },
    enquiries: { reference: e.reference, answers: e.answers, outcome: null, site_details: null },
  }
  world.tables.bookings = [...(world.tables.bookings ?? []), row]
  e.bookings.push({
    starts_at: start,
    confirmed_at: row.confirmed_at,
    state: 'confirmed',
    attendance,
    appointment_types: { mode: 'phone' },
  })
}

// Free site visit times next week (Irish time is UTC in winter).
const slot = (date: string, hour: number) => {
  const start = `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`
  return {
    start,
    end: new Date(Date.parse(start) + 3_600_000).toISOString(),
    date,
    time: `${String(hour).padStart(2, '0')}:00`,
  }
}

function seed(world: StaffWorld) {
  // Rang before their call on Tuesday.
  const early = enquiry('e-early1', 'Aoife Sample')
  bookCall(world, early, 'b-early', '2026-12-01T11:00:00Z')
  // The call happened and was marked attended.
  const held = enquiry('e-held01', 'Brian Example')
  bookCall(world, held, 'b-held', '2026-11-25T11:00:00Z', 'attended')
  // Nothing booked yet.
  const fresh = enquiry('e-fresh1', 'Ciara Test', { status: 'new' })
  world.tables.enquiries = [early, held, fresh]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.business.contact_phone = '01 555 0100'
  world.tables.estimate_work_items = [
    ['kitchen', 'New units and worktop'],
    ['kitchen', 'Tiled floor'],
    [null, 'Painting'],
  ].map(([type, label], i) => ({
    id: `wi-${i}`,
    label,
    project_type: type,
    archived_at: null,
    position: i + 1,
  }))
  world.visitOptions = {
    status: 'ok',
    timezone: 'Europe/Dublin',
    slots: [slot('2026-12-02', 10), slot('2026-12-02', 14), slot('2026-12-03', 10)],
    typeLabel: 'On-site estimate visit',
    eligibility: 'site_address_required',
    siteAddress: null,
  }
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

const now = (page: Page) => page.getByRole('region', { name: 'Now', exact: true })

test('"We already spoke" cancels the call quietly and offers the three next steps', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-early1')
  await expect(now(page)).toContainText('Call Tue 1 Dec, 11:00')
  // Before the call: How did it go? We spoke earlier (the call is cancelled with no email).
  const sheet = await chooseAction(page, /^How did it go/)
  await expect(sheet.getByRole('heading', { name: 'How did the call go?' })).toBeVisible()
  const spoke = sheet.getByRole('button', { name: /^We spoke earlier/ })
  await expect(spoke).toContainText('cancelled, with no email to them')
  await shot(page, 'after-call-we-already-spoke')
  await spoke.click()

  // It carries on to the next step: the site visit first (filled), the estimate last.
  await expect(sheet.getByRole('heading', { name: 'Choose the next step' })).toBeVisible()
  const choices = sheet
    .getByRole('button', { name: 'Send a booking link' })
    .or(sheet.getByRole('link', { name: /^(Book the site visit|Write the estimate)$/ }))
  await expect(choices).toHaveText([
    'Book the site visit',
    'Send a booking link',
    'Write the estimate',
  ])
  await expect(choices.first()).toHaveClass(/bg-primary/)
  await page.keyboard.press('Escape')
  await expect(now(page)).toContainText('Choose the next step')
  await expect(now(page)).toContainText(/Spoke \w{3} \d{1,2} \w{3}/)
  expect(world.rpcCalls.find((c) => c.name === 'record_call_held_early')?.body).toEqual({
    p_enquiry_id: 'e-early1',
  })
  // The call is cancelled by the server; no cancel request (and so no email) was made.
  expect(world.staffBookingCalls ?? []).toEqual([])
  await shot(page, 'after-call-choices')
})

test('an estimate straight from the call: thanks for talking, the work we talked about', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-held01')
  await expect(now(page)).toContainText('Spoke Wed 25 Nov')
  await primaryAction(page).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Write the estimate' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const section = page.locator('main')
  await expect(
    section.getByText(/After the call on Wed 25 Nov, 11:00, no site visit\./),
  ).toBeVisible()
  await expect(section.getByRole('group', { name: /Work we talked about/ })).toBeVisible()
  await section.getByLabel('Price in euro').fill('8000')
  await section.getByText('New units and worktop', { exact: true }).click()
  await taskAction(page, 'Check and send').click()
  const email = page.frameLocator('iframe[title="Estimate email"]')
  await expect(email.getByText('Thanks for talking the work through with us.')).toBeVisible()
  await expect(email.getByText('The work we talked about:')).toBeVisible()
  await expect(email.getByText(/based on what you told us on the call/)).toBeVisible()
  await shot(page, 'after-call-estimate-form')
  await taskAction(page, 'Send to Brian').click()
  await expect(page.getByText('Estimate sent to brian@example.com.')).toBeVisible()
  expect(world.rpcCalls.find((c) => c.name === 'send_estimate')?.body).toEqual({
    p_booking_id: 'b-held',
    p_price: 8000,
    p_percent: 10,
    p_work: '',
    p_items: ['New units and worktop'],
  })
})

test('held early with no booking: the estimate goes with the enquiry alone', async ({ page }) => {
  const world = await open(page, '/#/enquiries/e-fresh1')
  // They rang before anything was booked: How did it go? We spoke, then the estimate (last).
  const sheet = await chooseAction(page, /^How did it go/)
  await sheet.getByRole('button', { name: /^We spoke/ }).click()
  await sheet.getByRole('link', { name: 'Write the estimate' }).click()
  await page.getByLabel('Price in euro').fill('3000')
  await page.getByLabel('Anything else (optional)').fill('Hall floor relaid.')
  await taskAction(page, 'Check and send').click()
  await taskAction(page, 'Send to Ciara').click()
  await expect(page.getByText('Estimate sent to ciara@example.com.')).toBeVisible()
  expect(world.rpcCalls.find((c) => c.name === 'send_estimate')?.body).toMatchObject({
    p_booking_id: null,
    p_enquiry_id: 'e-fresh1',
  })
})

test('staff book the site visit, typing the address it needs', async ({ page }) => {
  const world = await open(page, '/#/enquiries/e-held01')
  // Its own screen; the bar's action is the booking, naming the time once one is chosen.
  await chooseAction(page, /^Book the site visit/)
  await expect(page).toHaveURL(/#\/enquiries\/e-held01\/visit$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Book the site visit' })).toBeFocused()
  await expect(page.getByText('A site visit needs the address.')).toBeVisible()
  await expect(taskAction(page, 'Book the visit')).toBeVisible()
  await page.getByLabel('House name or number and street').fill('12 Example Road')
  await page.getByRole('button', { name: /^Wed/ }).click()
  await page.getByRole('button', { name: '14:00' }).click()
  await shot(page, 'after-call-book-visit')
  await taskAction(page, /^Book Wed 2 Dec, 14:00/).click()
  await expect(page.getByText(/Site visit booked for Wed 2 Dec, 14:00/)).toBeVisible()
  await expect(now(page)).toContainText('Wed 2 Dec, 14:00')
  const call = (world.staffBookingCalls ?? []).find((c) => c.action === 'book_visit')
  expect(call).toMatchObject({
    action: 'book_visit',
    enquiryId: 'e-held01',
    start: '2026-12-02T14:00:00.000Z',
    siteStreet: '12 Example Road',
    siteUnit: '',
  })
})

test('a booking link: confirm, then the enquiry shows it was sent until they book', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-held01')
  const sheet = await chooseAction(page, /^Send a booking link/)
  await expect(sheet.getByRole('alertdialog')).toContainText(
    'Email brian@example.com a link to book their site visit?',
  )
  await sheet.getByRole('button', { name: 'Yes, send it' }).click()
  await expect(sheet.getByText('Link sent to brian@example.com.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(now(page)).toContainText('Waiting on Brian')
  await expect(now(page)).toContainText(/Visit link sent \d{1,2} \w{3}/)
  expect(world.rpcCalls.find((c) => c.name === 'send_visit_link')?.body).toEqual({
    p_enquiry_id: 'e-held01',
  })
  await shot(page, 'after-call-link-sent')

  await page.getByRole('link', { name: 'All enquiries' }).click()
  const row = page.getByRole('link', { name: /Brian Example/ })
  await expect(row).toContainText(/Visit link sent \d{1,2} \w{3}/)
  await expect(page.getByRole('region', { name: /^Waiting on them/ })).toContainText(
    'Brian Example',
  )
  await shot(page, 'after-call-list')
})
