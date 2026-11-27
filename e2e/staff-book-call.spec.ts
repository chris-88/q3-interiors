import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import {
  chooseAction,
  installFakeStaff,
  nowCard,
  openActions,
  primaryAction,
  signIn,
  staffWorld,
  type StaffWorld,
} from './fake-staff'

/*
 * Staff book a call for a customer, "if he wants to put it in his diary and speak with someone":
 * Book a call (outlined) in Next step before any call is held, the same free call times the
 * customer sees, then the call shows as Booked with Move and Cancel. Fake backend only (sample
 * people, example.com addresses); clock fixed at Thursday 26 November 2026, 12:00.
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
    status: 'new',
    status_reason: null,
    form_id: 'enquiry',
    form_version: 2,
    submitted_at: '2026-11-25T10:00:00Z',
    updated_at: '2026-11-25T10:00:00Z',
    answers: {
      appointment_preference: 'phone',
      project_type: 'kitchen',
      location: 'Dublin 8',
      name,
      email: `${name.split(' ')[0]?.toLowerCase()}@example.com`,
      phone: '087 765 4321',
    },
    marketing_opt_in: false,
    marketing_opt_in_at: null,
    site_details: null,
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
    call_held_at: null,
    visit_link_sent_at: null,
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
  over: { state?: string; attendance?: string | null; mode?: 'phone' | 'on_site' } = {},
) {
  const mode = over.mode ?? 'phone'
  const state = over.state ?? 'confirmed'
  const row = {
    id,
    enquiry_id: e.id,
    state,
    starts_at: start,
    ends_at: new Date(Date.parse(start) + 20 * 60_000).toISOString(),
    confirmed_at: '2026-11-15T10:00:00Z',
    failure_reason: null,
    calendar_event_id: `q3${id}`,
    calendar_event_link: null,
    created_at: '2026-11-15T10:00:00Z',
    attendance: over.attendance ?? null,
    cancelled_at: state === 'cancelled' ? '2026-11-20T10:00:00Z' : null,
    cancelled_by: state === 'cancelled' ? 'customer' : null,
    cancel_reason: null,
    calendar_mismatch: null,
    appointment_types:
      mode === 'phone'
        ? { label: 'Phone consultation', mode: 'phone' }
        : { label: 'On-site estimate visit', mode: 'on_site' },
    enquiries: { reference: e.reference, answers: e.answers, outcome: null, site_details: null },
  }
  world.tables.bookings = [...(world.tables.bookings ?? []), row]
  e.bookings.push({
    starts_at: start,
    confirmed_at: row.confirmed_at,
    state,
    attendance: row.attendance,
    appointment_types: { mode },
  })
}

const slot = (date: string, hour: number) => {
  const start = `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`
  return {
    start,
    end: new Date(Date.parse(start) + 20 * 60_000).toISOString(),
    date,
    time: `${String(hour).padStart(2, '0')}:00`,
  }
}

function seed(world: StaffWorld) {
  const fresh = enquiry('e-new001', 'Aoife Sample')
  const asked = enquiry('e-ask001', 'Brian Example', {
    contact_requested_at: '2026-11-25T11:00:00Z',
    contact_request_reason: 'No suitable time online',
  })
  const missed = enquiry('e-miss01', 'Ciara Test', { status: 'contacted' })
  book(world, missed, 'b-miss', '2026-11-24T10:00:00Z', { attendance: 'no_show' })
  const cancelled = enquiry('e-canc01', 'Declan Sample', { status: 'contacted' })
  book(world, cancelled, 'b-canc', '2026-11-30T10:00:00Z', { state: 'cancelled' })
  const coming = enquiry('e-come01', 'Eimear Example', { status: 'contacted' })
  book(world, coming, 'b-come', '2026-12-01T10:00:00Z')
  const held = enquiry('e-held01', 'Fiona Test', {
    status: 'contacted',
    call_held_at: '2026-11-25T11:00:00Z',
  })
  const missedVisit = enquiry('e-mvis01', 'Gerry Sample', {
    status: 'contacted',
    answers: {
      appointment_preference: 'on_site',
      project_type: 'kitchen',
      location: 'Dublin 8',
      name: 'Gerry Sample',
      email: 'gerry@example.com',
      phone: '087 765 4321',
      site_street: '12 Example Road',
    },
    site_details: { site_address: '12 Example Road, Dublin 8' },
  })
  book(world, missedVisit, 'b-mvis', '2026-11-25T10:00:00Z', {
    attendance: 'no_show',
    mode: 'on_site',
  })
  world.tables.enquiries = [fresh, asked, missed, cancelled, coming, held, missedVisit]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.tables.calendar_connections = [
    { staff_user_id: 'u-staff', status: 'connected', last_error: null },
  ]
  world.callOptions = {
    status: 'ok',
    timezone: 'Europe/Dublin',
    slots: [slot('2026-12-02', 10), slot('2026-12-02', 14), slot('2026-12-03', 10)],
    typeLabel: 'Phone consultation',
    eligibility: 'eligible',
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

const sheet = (page: Page) => page.getByRole('dialog')
const filled = (page: Page) =>
  // Filled actions in the sheet; a chosen time (pressed) is a selection, not an action.
  sheet(page).locator('[data-slot="button"].bg-primary:not([aria-pressed="true"]), a.bg-primary')
const offered = async (page: Page) => {
  const s = await openActions(page)
  const names = await s
    .getByRole('listitem')
    .evaluateAll((items) => items.map((li) => li.querySelector('.font-medium')?.textContent ?? ''))
  await page.keyboard.press('Escape')
  return names
}

test('book a call for a new enquiry: the customer’s free times, then Booked with Move and Cancel', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-new001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aoife Sample')
  // Ring is the primary; Book a call is in the other actions with what it does.
  await expect(primaryAction(page)).toHaveText('Ring Aoife')
  const s = await chooseAction(page, /^Book a call/)
  await expect(
    s.getByText('Pick a time for the call. Aoife gets the usual confirmation email.'),
  ).toBeVisible()
  await s.getByRole('button', { name: /^Wed/ }).click()
  await s.getByRole('button', { name: '14:00' }).click()
  // One filled button: the panel's Book.
  await expect(filled(page)).toHaveCount(1)
  await expect(filled(page)).toHaveText('Book Wed 2 Dec, 14:00')
  await shot(page, 'book-call-panel')
  await filled(page).click()

  // Now in the diary: the call, with Move and Cancel under the actions.
  await expect(nowCard(page)).toContainText('Wed 2 Dec, 14:00')
  await expect(nowCard(page)).toContainText('In the diary')
  expect(await offered(page)).not.toContain('Book a call')
  await shot(page, 'book-call-booked')
  expect((world.staffBookingCalls ?? []).find((c) => c.action === 'book_call')).toMatchObject({
    action: 'book_call',
    enquiryId: 'e-new001',
    start: '2026-12-02T14:00:00.000Z',
    idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
  })
  await page.getByRole('link', { name: 'All enquiries' }).click()
  const row = page.getByRole('region', { name: 'Enquiries' }).getByRole('listitem').filter({
    hasText: 'Aoife Sample',
  })
  await expect(row).toContainText('Call Wed 14:00')
  await expect(row).toContainText('Call booked')
})

test('a call-back request: Ring is the main action; Book a call is one of the others', async ({
  page,
}) => {
  await open(page, '/#/enquiries/e-ask001')
  await expect(primaryAction(page)).toHaveText('Ring Brian')
  const s = await chooseAction(page, /^Book a call/)
  await s.getByRole('button', { name: /^Thu/ }).click()
  await s.getByRole('button', { name: '10:00' }).click()
  await expect(filled(page)).toHaveCount(1)
  await expect(filled(page)).toHaveText('Book Thu 3 Dec, 10:00')
  await shot(page, 'book-call-callback')
})

test('offered after a missed or cancelled call; not with a call to come or a call held', async ({
  page,
}) => {
  await open(page, '/#/enquiries/e-miss01')
  expect(await offered(page)).toContain('Book a call')
  await shot(page, 'missed-call')
  await page.goto('/#/enquiries/e-canc01')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Declan Sample')
  // Contacted, the call cancelled: waiting on them, and booking a call is the main action.
  await expect(primaryAction(page)).toHaveText('Book a call')
  await page.goto('/#/enquiries/e-come01')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Eimear Example')
  await expect(primaryAction(page)).toHaveText('Move or cancel')
  expect(await offered(page)).not.toContain('Book a call')
  await page.goto('/#/enquiries/e-held01')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fiona Test')
  await expect(primaryAction(page)).toHaveText('Choose the next step')
  expect(await offered(page)).not.toContain('Book a call')
})

test('a missed call or visit: its own stage, Ring first, then rebook; not "Estimate to write"', async ({
  page,
}) => {
  await open(page, '/#/')
  const rows = page.getByRole('region', { name: 'Enquiries' }).getByRole('listitem')
  const ciara = rows.filter({ hasText: 'Ciara Test' })
  await expect(ciara).toContainText('Missed call Tue 24 Nov')
  await expect(ciara).toContainText('Ring, due Tue 24 Nov')
  await expect(ciara).not.toContainText('Estimate to write')
  const gerry = rows.filter({ hasText: 'Gerry Sample' })
  await expect(gerry).toContainText('Missed visit Wed 25 Nov')
  // Both are Q3's move.
  const yours = page.getByRole('region', { name: /^Your move/ })
  await expect(yours.getByRole('listitem').filter({ hasText: 'Ciara Test' })).toHaveCount(1)
  await expect(yours.getByRole('listitem').filter({ hasText: 'Gerry Sample' })).toHaveCount(1)
  await shot(page, 'missed-list')

  await gerry.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gerry Sample')
  await expect(nowCard(page)).toContainText('Missed visit Wed 25 Nov')
  await expect(primaryAction(page)).toHaveText('Ring Gerry')
  const visitActions = await offered(page)
  expect(visitActions).toContain('Book the site visit')
  expect(visitActions).toContain('Send a booking link')
  expect(visitActions).not.toContain('Write the estimate')
  expect(visitActions).not.toContain('Mark won')
  await shot(page, 'missed-visit')

  await page.goto('/#/enquiries/e-miss01')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ciara Test')
  await expect(primaryAction(page)).toHaveText('Ring Ciara')
  expect(await offered(page)).not.toContain('Send a booking link')

  // A missed appointment already has its attendance: nothing to wrap up on Appointments.
  await page.goto('/#/appointments')
  await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'To wrap up' })).toHaveCount(0)
})
