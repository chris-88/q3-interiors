import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld, type StaffWorld } from './fake-staff'

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

const nextStep = (page: Page) => page.getByRole('region', { name: 'Next step' })

test('"We already spoke" cancels the call quietly and offers the three next steps', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-early1')
  const card = nextStep(page)
  await expect(card.getByText('Tue 1 Dec, 11:00')).toBeVisible()
  await card.getByRole('button', { name: 'We already spoke' }).click()
  const confirm = card.getByRole('alertdialog')
  await expect(confirm).toContainText('No email goes to the customer and no reminder is sent.')
  await shot(page, 'after-call-we-already-spoke')
  await confirm.getByRole('button', { name: 'Yes, we spoke' }).click()

  await expect(card.getByText('Call held 27 Nov')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Write the estimate' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Book the site visit' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Send a booking link' })).toBeVisible()
  await expect(page.getByText('Call held', { exact: true }).first()).toBeVisible()
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
  await expect(nextStep(page).getByText('Call held 25 Nov')).toBeVisible()
  await nextStep(page).getByRole('button', { name: 'Write the estimate' }).click()
  const section = page.getByRole('region', { name: 'Estimate' })
  await expect(
    section.getByText('After the call on Wed 25 Nov, 11:00, no site visit.'),
  ).toBeVisible()
  await expect(section.getByRole('group', { name: /Work we talked about/ })).toBeVisible()
  await section.getByLabel('Price in euro').fill('8000')
  await section.getByText('New units and worktop', { exact: true }).click()
  const email = page.frameLocator('iframe[title="Estimate email preview"]')
  await expect(email.getByText('Thanks for talking the work through with us.')).toBeVisible()
  await expect(email.getByText('The work we talked about:')).toBeVisible()
  await expect(email.getByText(/based on what you told us on the call/)).toBeVisible()
  await shot(page, 'after-call-estimate-form')
  await section.getByRole('button', { name: 'Send estimate' }).click()
  await section.getByRole('alertdialog').getByRole('button', { name: 'Yes, send it' }).click()
  await expect(section).toContainText('Estimate sent to brian@example.com.')
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
  const card = nextStep(page)
  await card.getByRole('button', { name: 'We already spoke' }).click()
  await expect(card.getByRole('alertdialog')).toContainText('Nothing is sent to the customer.')
  await card.getByRole('button', { name: 'Yes, we spoke' }).click()
  await card.getByRole('button', { name: 'Write the estimate' }).click()
  const section = page.getByRole('region', { name: 'Estimate' })
  await section.getByLabel('Price in euro').fill('3000')
  await section.getByLabel('Anything else (optional)').fill('Hall floor relaid.')
  await section.getByRole('button', { name: 'Send estimate' }).click()
  await section.getByRole('alertdialog').getByRole('button', { name: 'Yes, send it' }).click()
  await expect(section).toContainText('Estimate sent to ciara@example.com.')
  expect(world.rpcCalls.find((c) => c.name === 'send_estimate')?.body).toMatchObject({
    p_booking_id: null,
    p_enquiry_id: 'e-fresh1',
  })
})

test('staff book the site visit, typing the address it needs', async ({ page }) => {
  const world = await open(page, '/#/enquiries/e-held01')
  const card = nextStep(page)
  await card.getByRole('button', { name: 'Book the site visit' }).click()
  await expect(card.getByText('A site visit needs the address.')).toBeVisible()
  await card.getByLabel('House name or number and street').fill('12 Example Road')
  await card.getByRole('button', { name: /^Wed/ }).click()
  await card.getByRole('button', { name: '14:00' }).click()
  await shot(page, 'after-call-book-visit')
  await card.getByRole('button', { name: /^Book Wed 2 Dec, 14:00/ }).click()
  await expect(nextStep(page).getByText('Wed 2 Dec, 14:00')).toBeVisible()
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
  const card = nextStep(page)
  await card.getByRole('button', { name: 'Send a booking link' }).click()
  await expect(card.getByRole('alertdialog')).toContainText(
    'Email brian@example.com a link to book their site visit?',
  )
  await card.getByRole('button', { name: 'Yes, send it' }).click()
  await expect(
    card.getByText('Site visit link sent 27 Nov. Waiting for them to book.'),
  ).toBeVisible()
  await expect(card.getByRole('button', { name: 'Send the booking link again' })).toBeVisible()
  expect(world.rpcCalls.find((c) => c.name === 'send_visit_link')?.body).toEqual({
    p_enquiry_id: 'e-held01',
  })
  await shot(page, 'after-call-link-sent')

  await page.getByRole('link', { name: 'All enquiries' }).click()
  const row = page.getByRole('link', { name: /Brian Example/ })
  await expect(row).toContainText('Visit link sent 27 Nov')
  await expect(page.getByRole('region', { name: /^Waiting on them/ })).toContainText(
    'Brian Example',
  )
  await shot(page, 'after-call-list')
})
