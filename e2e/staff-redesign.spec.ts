import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld, type StaffWorld } from './fake-staff'

/*
 * The redesigned Enquiries list, enquiry page and Appointments agenda. Fake backend only (sample
 * people, example.com addresses); the clock is fixed at Thursday 26 November 2026, 12:00 Irish
 * time so day headings and "upcoming" are stable. SCREENSHOTS_DIR keeps phone and desktop shots.
 */

const NOW = '2026-11-26T12:00:00Z'

const shot = async (page: Page, name: string) => {
  const width = page.viewportSize()?.width ?? 390
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

type Booking = {
  id: string
  start: string
  mode: 'phone' | 'on_site'
  state?: string
  attendance?: string | null
}

const events = (submitted: string) => [
  {
    id: 1,
    kind: 'submitted',
    detail: null,
    from_status: null,
    to_status: 'new',
    reason: null,
    actor_name: null,
    created_at: submitted,
  },
]

function enquiry(
  id: string,
  name: string,
  submitted: string,
  over: Record<string, unknown> = {},
  answers: Record<string, string> = {},
) {
  const first = name.split(' ')[0]?.toLowerCase() ?? 'x'
  return {
    id,
    reference: `Q3-${id.slice(2, 8).toUpperCase().padEnd(6, 'X')}`,
    status: 'new',
    status_reason: null,
    form_id: 'enquiry',
    form_version: 2,
    submitted_at: submitted,
    updated_at: submitted,
    answers: {
      appointment_preference: 'on_site',
      project_type: 'kitchen',
      location: 'Dublin 8',
      name,
      email: `${first}@example.com`,
      phone: '087 765 4321',
      site_street: '12 Example Road',
      ...answers,
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
    enquiry_attribution: {
      tracking: 'tagged',
      utm_source: 'instagram',
      utm_medium: 'paid',
      utm_campaign: 'kitchens',
      utm_content: null,
      utm_term: null,
      click_id_present: true,
      landing_path: '/',
      first_seen_at: submitted,
    },
    enquiry_events: events(submitted),
    bookings: [] as unknown[],
    ...over,
  }
}

/** Adds bookings to the table and to the enquiry's own list, as the server would return them. */
function book(world: StaffWorld, e: ReturnType<typeof enquiry>, list: Booking[]) {
  for (const b of list) {
    const state = b.state ?? 'confirmed'
    const row = {
      id: b.id,
      enquiry_id: e.id,
      state,
      starts_at: b.start,
      ends_at: new Date(
        Date.parse(b.start) + (b.mode === 'phone' ? 20 : 60) * 60_000,
      ).toISOString(),
      confirmed_at: state === 'cancelled' || state === 'confirmed' ? '2026-11-15T10:00:00Z' : null,
      failure_reason: null,
      calendar_event_id: `q3${b.id}`,
      calendar_event_link: null,
      created_at: '2026-11-15T10:00:00Z',
      attendance: b.attendance ?? null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      calendar_mismatch: null,
      appointment_types:
        b.mode === 'phone'
          ? { label: 'Phone consultation', mode: 'phone' }
          : { label: 'On-site estimate visit', mode: 'on_site' },
      enquiries: {
        reference: e.reference,
        answers: e.answers,
        outcome: e.outcome,
        site_details: e.site_details,
      },
    }
    world.tables.bookings = [...(world.tables.bookings ?? []), row]
    e.bookings.push({
      starts_at: row.starts_at,
      confirmed_at: row.confirmed_at,
      state,
      appointment_types: { mode: b.mode },
    })
  }
}

function seed(world: StaffWorld) {
  const call = enquiry(
    'e-call01',
    'Aoife Sample',
    '2026-11-26T09:00:00Z',
    {
      contact_requested_at: '2026-11-26T09:05:00Z',
      contact_request_reason: 'No suitable time online',
      site_details: null,
      site_details_form_version: null,
    },
    { appointment_preference: 'phone', site_street: '' },
  )
  const visit = enquiry('e-visit1', 'Brian Example', '2026-11-26T08:00:00Z', {
    status: 'contacted',
  })
  const fresh = enquiry(
    'e-new001',
    'Ciara Test',
    '2026-11-25T10:00:00Z',
    {},
    { location: 'Bray', site_street: '3 Sample Lane', kitchen_layout: 'changing' },
  )
  const awaiting = enquiry(
    'e-await1',
    'Declan Sample',
    '2026-11-22T10:00:00Z',
    {},
    { project_type: 'bathroom', location: 'Cork' },
  )
  const quoted = enquiry('e-quote1', 'Eimear Example', '2026-11-18T10:00:00Z', {
    outcome: 'quoted',
    quote_amount: 18450,
    quote_date: '2026-11-21',
  })
  const won = enquiry('e-won001', 'Fiona Test', '2026-11-10T10:00:00Z', {
    outcome: 'won',
    quote_amount: 18450,
    quote_date: '2026-11-15',
    outcome_value: 18000,
    won_date: '2026-11-20',
  })
  const lost = enquiry('e-lost01', 'Gerry Sample', '2026-11-05T10:00:00Z', {
    outcome: 'lost',
    outcome_reason: 'price',
  })
  book(world, visit, [
    { id: 'b-visit', start: '2026-11-27T10:30:00Z', mode: 'on_site' },
    { id: 'b-visit-old', start: '2026-11-24T09:00:00Z', mode: 'phone', state: 'cancelled' },
  ])
  book(world, awaiting, [{ id: 'b-await', start: '2026-11-24T10:00:00Z', mode: 'on_site' }])
  book(world, quoted, [{ id: 'b-quote', start: '2026-11-20T10:00:00Z', mode: 'on_site' }])
  book(world, won, [
    { id: 'b-won', start: '2026-11-12T10:00:00Z', mode: 'phone', attendance: 'attended' },
  ])
  // A second upcoming appointment, later today, and one next week.
  const later = enquiry('e-later1', 'Helen Example', '2026-11-20T10:00:00Z', {
    status: 'contacted',
  })
  book(world, later, [{ id: 'b-today', start: '2026-11-26T15:00:00Z', mode: 'phone' }])
  const next = enquiry('e-next01', 'Ian Sample', '2026-11-19T10:00:00Z', { status: 'contacted' })
  book(world, next, [{ id: 'b-next', start: '2026-12-02T11:00:00Z', mode: 'on_site' }])
  world.tables.enquiries = [call, visit, fresh, awaiting, later, next, quoted, won, lost]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.tables.calendar_connections = [
    { staff_user_id: 'u-staff', status: 'connected', last_error: null },
  ]
}

async function open(page: Page, path = '/#/') {
  const world = staffWorld()
  seed(world)
  await page.clock.setFixedTime(new Date(NOW))
  await installFakeStaff(page, world)
  await page.goto(path)
  await signIn(page, 'staff@example.com', 'another long password')
  return world
}

const list = (page: Page) => page.getByRole('list', { name: 'Enquiries' })
const names = (page: Page) =>
  list(page)
    .getByRole('listitem')
    .evaluateAll((items) =>
      items.map((li) => li.querySelector('.font-medium')?.textContent?.trim() ?? ''),
    )
const chip = (page: Page, name: RegExp) => page.getByRole('radio', { name })

test('the list: one line each, chips with counts, action first, search, remembered chip', async ({
  page,
}) => {
  await open(page)
  await expect(list(page).getByRole('listitem')).toHaveCount(7)
  await expect(chip(page, /^Open/)).toBeChecked()
  await expect(chip(page, /^Open/)).toHaveAccessibleName('Open 7')
  await expect(chip(page, /^Needs action/)).toHaveAccessibleName('Needs action 3')
  await expect(chip(page, /^All/)).toHaveAccessibleName('All 9')

  // Needs action first (new, call back, awaiting quote), then the rest in the order received.
  expect(await names(page)).toEqual([
    'Aoife Sample',
    'Ciara Test',
    'Declan Sample',
    'Brian Example',
    'Helen Example',
    'Ian Sample',
    'Eimear Example',
  ])
  const first = list(page).getByRole('listitem').first()
  await expect(first).toContainText('Kitchen · Dublin 8')
  await expect(first).toContainText('Asked to be contacted')
  await expect(first).toContainText('Call back')
  await expect(first).toContainText('Needs action')
  await expect(first).not.toContainText('Q3-')
  await expect(first.locator('time')).toHaveText(/3 h/)
  const visit = list(page).getByRole('listitem').filter({ hasText: 'Brian Example' })
  await expect(visit).toContainText('Site visit Fri 27 Nov, 10:30')
  await expect(visit).toContainText('Booked')
  await expect(visit).not.toContainText('Needs action')
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Eimear' })).toContainText(
    'Quoted €18,450',
  )
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Declan' })).toContainText(
    'Site visit Tue 24 Nov, no estimate yet',
  )
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Needs attention' })).toHaveCount(0)
  await shot(page, 'list-open-390')

  await chip(page, /^Won/).check({ force: true })
  await expect(list(page)).toContainText('Won €18,000')
  await chip(page, /^Lost/).check({ force: true })
  await expect(list(page)).toContainText('Lost: Price')

  // Search: by name, phone and reference, as you type, on top of the chip.
  await chip(page, /^All/).check({ force: true })
  const search = page.getByRole('searchbox', { name: 'Search enquiries' })
  await search.fill('Sample')
  expect(await names(page)).toEqual(['Aoife Sample', 'Declan Sample', 'Ian Sample', 'Gerry Sample'])
  await expect(chip(page, /^All/)).toHaveAccessibleName('All 4')
  await expect(chip(page, /^Open/)).toHaveAccessibleName('Open 3')
  await search.fill('q3-won')
  expect(await names(page)).toEqual(['Fiona Test'])
  await search.fill('cork')
  expect(await names(page)).toEqual(['Declan Sample'])
  await search.fill('nobody')
  await expect(page.getByText('Nothing under “All” matches “nobody”.')).toBeVisible()
  await search.fill('sample')
  await chip(page, /^Needs action/).check({ force: true })
  expect(await names(page)).toEqual(['Aoife Sample', 'Declan Sample'])
  await shot(page, 'list-search-390')

  // The chip and search are kept in this tab.
  await page.reload()
  await expect(chip(page, /^Needs action/)).toBeChecked()
  await expect(search).toHaveValue('sample')
  expect(await names(page)).toEqual(['Aoife Sample', 'Declan Sample'])
})

test('a single system problem is one compact line; contact requests are not in it', async ({
  page,
}) => {
  const world = staffWorld()
  seed(world)
  world.tables.calendar_connections = []
  await page.clock.setFixedTime(new Date(NOW))
  await installFakeStaff(page, world)
  await page.goto('/#/')
  await signIn(page, 'staff@example.com', 'another long password')
  const attention = page.getByRole('region', { name: 'Needs attention' })
  await expect(attention.getByRole('link')).toHaveCount(1)
  await expect(attention).toContainText('Needs attention: No Google Calendar is connected.')
  await expect(attention).not.toContainText('asked to be contacted')
})

test('the enquiry page walks the list and offers call, email and directions', async ({ page }) => {
  await open(page)
  await list(page).getByRole('link').first().click()
  const walk = page.getByRole('navigation', { name: 'Enquiries in this list' })
  await expect(walk).toContainText('1 of 7')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aoife Sample')
  await expect(page.getByText('Kitchen · Dublin 8').first()).toBeVisible()
  await expect(page.getByText('Q3-CALL01')).toBeVisible()
  await walk.getByRole('link', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ciara Test')
  await expect(walk).toContainText('2 of 7')
  await walk.getByRole('link', { name: 'Previous' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aoife Sample')

  // Quick actions: a call route has no street, so no Directions.
  const quick = page.getByRole('navigation', { name: 'Quick actions' })
  await expect(quick.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:0877654321')
  await expect(quick.getByRole('link', { name: 'Email' })).toHaveAttribute(
    'href',
    'mailto:aoife@example.com',
  )
  await expect(quick.getByRole('link', { name: 'Directions' })).toHaveCount(0)
  await page.goto('/#/enquiries/e-visit1')
  await expect(quick.getByRole('link', { name: 'Directions' })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/dir/?api=1&destination=12%20Example%20Road%2C%20Dublin%208',
  )
  for (const name of ['Call', 'Email', 'Directions']) {
    const box = await quick.getByRole('link', { name }).boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(48)
  }
})

test('Next step: a contact request, then marked contacted; empty answers are hidden', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-call01')
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('Asked to be contacted')
  await expect(next).toContainText('No suitable time online')
  await expect(next.getByRole('link', { name: 'Ring Aoife' })).toHaveAttribute(
    'href',
    'tel:0877654321',
  )
  // Empty answers are left out, not shown as "Not given".
  const project = page.getByRole('region', { name: 'Project' })
  await expect(project).toContainText('Town or Eircode')
  await expect(project).not.toContainText('House name or number and street')
  await expect(project).not.toContainText('layout')
  await expect(page.getByText(/Not given|Not answered/)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Help us prepare' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Appointments' })).toHaveCount(0)
  await shot(page, 'enquiry-contact-390')

  await next.getByRole('button', { name: 'Mark as contacted' }).click()
  await expect(next).toContainText('Contacted. Nothing booked yet.')
  await expect(page.getByText('Contacted', { exact: true }).first()).toBeVisible()
  expect(world.rpcCalls.filter((c) => c.name === 'set_enquiry_status').map((c) => c.body)).toEqual([
    { p_enquiry_id: 'e-call01', p_status: 'contacted', p_reason: null },
  ])
})

test('Next step: an upcoming appointment, moved and then cancelled from the card', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-visit1')
  world.moveOptions = {
    status: 'ok',
    timezone: 'Europe/Dublin',
    slots: [
      {
        start: '2026-11-30T11:00:00Z',
        end: '2026-12-01T12:00:00Z',
        date: '2026-11-30',
        time: '11:00',
      },
    ],
  }
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('On-site estimate visit')
  await expect(next).toContainText('Fri 27 Nov, 10:30')
  // The past, cancelled call is in the history list with its badge; the card holds the visit.
  const appointments = page.getByRole('region', { name: 'Appointments' })
  await expect(appointments).toContainText('Cancelled')
  await expect(appointments.getByRole('button', { name: 'Move' })).toHaveCount(0)
  await shot(page, 'enquiry-appointment-390')

  await next.getByRole('button', { name: 'Move' }).click()
  await next.getByRole('button', { name: /11:00/ }).click()
  await next.getByRole('button', { name: 'Move to 11:00' }).click()
  await expect(next).toContainText('Mon 30 Nov, 11:00')

  await next.getByRole('button', { name: 'Cancel' }).click()
  await next.getByLabel('Reason (shown in history)').fill('Customer rang to cancel')
  await next.getByRole('button', { name: 'Cancel appointment' }).click()
  await expect(next).toContainText('Contacted. Nothing booked yet.')
  const booking = (world.tables.bookings as Record<string, unknown>[]).find(
    (b) => b.id === 'b-visit',
  )
  expect(booking?.state).toBe('cancelled')
  expect(booking?.cancel_reason).toBe('Customer rang to cancel')
})

test('Next step: after the appointment, attendance and the quote; then won from Quoted', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-await1')
  const next = page.getByRole('region', { name: /^(Next step|Result)$/ })
  await expect(next).toContainText('Tue 24 Nov, 10:00')
  await expect(next).toContainText('No estimate sent yet.')
  await next.getByRole('button', { name: 'Attended' }).click()
  await expect(next.getByRole('button', { name: 'Attended' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await next.getByRole('button', { name: 'Record a quote or result' }).click()
  await next.getByRole('button', { name: 'Record quote' }).click()
  await next.getByLabel('Quote amount (€, incl. VAT)').fill('12,300')
  await next.getByLabel('Date quoted').fill('2026-11-25')
  await next.getByRole('button', { name: 'Save quote' }).click()
  await expect(next).toContainText('Quoted €12,300.00 on 25 Nov 2026')
  await expect(next.getByRole('button', { name: 'Mark won' })).toBeVisible()
  expect(world.rpcCalls.map((c) => c.name)).toEqual(
    expect.arrayContaining(['set_booking_attendance', 'record_enquiry_outcome']),
  )

  // A quoted enquiry: Mark won is the main action, Edit quote and Mark lost beside it.
  await page.goto('/#/enquiries/e-quote1')
  await expect(next).toContainText('Quoted €18,450.00 on 21 Nov 2026')
  await expect(next.getByRole('button', { name: 'Edit quote' })).toBeVisible()
  await expect(next.getByRole('button', { name: 'Mark lost' })).toBeVisible()
  await shot(page, 'enquiry-quoted-390')
  await next.getByRole('button', { name: 'Mark won' }).click()
  await next.getByLabel('Date won').fill('2026-11-25')
  await next.getByRole('button', { name: 'Save as won' }).click()
  await expect(next).toContainText('Won €18,450.00 on 25 Nov 2026')
  await expect(next.getByRole('button', { name: 'Edit win' })).toBeVisible()
})

test('Notes, the demoted status, and everything else under More', async ({ page }) => {
  const world = await open(page, '/#/enquiries/e-new001')
  // Ciara's answers include the kitchen layout; empty ones (rooms) are not shown.
  const project = page.getByRole('region', { name: 'Project' })
  await expect(project).toContainText('Changing it')
  await expect(project).not.toContainText('Which rooms')

  const notes = page.getByRole('region', { name: 'Notes' })
  await notes.getByRole('button', { name: 'Save note' }).click()
  await expect(notes.getByRole('alert')).toHaveText('Write the note first.')
  await notes.getByLabel('Add a note').fill('Rang at 11, no answer. Try after 5.')
  await notes.getByRole('button', { name: 'Save note' }).click()
  await expect(notes).toContainText('Rang at 11, no answer. Try after 5.')
  await expect(notes).toContainText('Sam Staff')
  await expect(notes.getByLabel('Add a note')).toHaveValue('')
  expect(world.rpcCalls.filter((c) => c.name === 'add_enquiry_note').map((c) => c.body)).toEqual([
    { p_enquiry_id: 'e-new001', p_note: 'Rang at 11, no answer. Try after 5.' },
  ])

  // The status select is still there, one tap down.
  await expect(page.getByRole('region', { name: 'Change status' })).toBeHidden()
  await notes.getByText(/^Change status/).click()
  await expect(
    page.getByRole('region', { name: 'Change status' }).getByLabel('Status'),
  ).toBeVisible()

  // More: history, where they came from, chase, delete.
  await expect(page.getByRole('region', { name: 'History' })).toBeHidden()
  await page.getByText('More', { exact: true }).click()
  await expect(page.getByRole('region', { name: 'History' })).toContainText('Note added')
  await expect(page.getByRole('region', { name: 'Where they came from' })).toContainText(
    'instagram',
  )
  await expect(page.getByRole('region', { name: 'Had to chase details' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Delete' })).toBeVisible()
  await shot(page, 'enquiry-more-390')
})

test('Appointments: an agenda by day, To wrap up, and Past', async ({ page }) => {
  await open(page, '/#/appointments')
  await expect(page.getByRole('radio', { name: 'Upcoming' })).toBeChecked()
  const wrap = page.getByRole('region', { name: 'To wrap up' })
  // Declan's visit is over with no outcome; Eimear's (quoted) and Fiona's (won) are not listed.
  await expect(wrap.getByRole('link')).toHaveCount(1)
  await expect(wrap).toContainText('Declan Sample')
  await expect(wrap).toContainText('Site visit Tue 24 Nov')

  const headings = page.getByRole('heading', { level: 2 })
  await expect(headings).toHaveText(['To wrap up', 'Today', 'Tomorrow', 'Wed 2 Dec'])
  const today = page.getByRole('region', { name: 'Today' })
  await expect(today).toContainText('15:00')
  await expect(today).toContainText('Helen Example')
  await expect(today).toContainText('Call')
  await expect(today.getByRole('link', { name: 'Call Helen Example' })).toHaveAttribute(
    'href',
    'tel:0877654321',
  )
  await expect(today.getByRole('link', { name: /Directions/ })).toHaveCount(0)
  const tomorrow = page.getByRole('region', { name: 'Tomorrow' })
  await expect(tomorrow).toContainText('10:30')
  await expect(tomorrow).toContainText('Site visit · Dublin 8')
  await expect(tomorrow.getByRole('link', { name: 'Directions to Brian Example' })).toBeVisible()
  // No reference codes, no Move or Cancel, no badge on a normal confirmed appointment.
  await expect(page.getByText(/Q3-/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Move|Cancel/ })).toHaveCount(0)
  await expect(tomorrow.getByText('Confirmed')).toHaveCount(0)
  await expect(page.getByText('Times in Irish time.')).toBeVisible()
  await shot(page, 'appointments-upcoming-390')

  await tomorrow
    .getByRole('link', { name: /Brian Example/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Brian Example')
  await page.goBack()

  await page.getByText('Past', { exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Past' })).toBeChecked()
  await expect(page.getByRole('region', { name: 'Yesterday' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Tue 24 Nov' })).toContainText('Cancelled')
  await expect(page.getByRole('region', { name: 'To wrap up' })).toHaveCount(0)
  await shot(page, 'appointments-past-390')
})

test('desktop: the list, the enquiry in two columns, and the agenda', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page)
  await expect(list(page).getByRole('listitem')).toHaveCount(7)
  await shot(page, 'list-desktop')

  await page.goto('/#/enquiries/e-visit1')
  const next = page.getByRole('region', { name: 'Next step' })
  const project = page.getByRole('region', { name: 'Project' })
  await expect(next).toBeVisible()
  const left = await next.boundingBox()
  const right = await project.boundingBox()
  expect(left && right && left.x + left.width <= right.x).toBe(true)
  await shot(page, 'enquiry-desktop')
  // The left column stays in view while the sections scroll.
  await page.mouse.wheel(0, 600)
  await expect.poll(async () => (await next.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0)

  await page.goto('/#/appointments')
  await expect(page.getByRole('region', { name: 'To wrap up' })).toBeVisible()
  await shot(page, 'appointments-desktop')
})
