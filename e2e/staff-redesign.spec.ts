import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import {
  chooseAction,
  installFakeStaff,
  nowCard,
  openActions,
  openFold,
  openFolds,
  primaryAction,
  signIn,
  type StaffWorld,
  staffWorld,
} from './fake-staff'

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

const list = (page: Page) => page.getByRole('region', { name: 'Enquiries' })
const names = (page: Page) =>
  list(page)
    .getByRole('listitem')
    .evaluateAll((items) =>
      items.map((li) => li.querySelector('.font-medium')?.textContent?.trim() ?? ''),
    )
const YOUR_MOVE = ['Declan Sample', 'Ciara Test', 'Aoife Sample']
const WAITING = ['Eimear Example']
const SEARCH_SAMPLE = ['Declan Sample', 'Aoife Sample', 'Ian Sample']

const group = (page: Page, name: RegExp) => page.getByRole('region', { name })
const groupNames = (page: Page, name: RegExp) =>
  group(page, name)
    .getByRole('listitem')
    .evaluateAll((items) =>
      items.map((li) => li.querySelector('.font-medium')?.textContent?.trim() ?? ''),
    )

test('the list: grouped by whose move it is, two lines with a due chip, search, Finished', async ({
  page,
}) => {
  await open(page)
  await expect(list(page).getByRole('listitem')).toHaveCount(7)
  // No chips, no dot, no age: three groups say whose move it is.
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(list(page).locator('time')).toHaveCount(0)
  await expect(group(page, /^Your move/)).toBeVisible()
  expect(await groupNames(page, /^Your move/)).toEqual(YOUR_MOVE)
  expect(await groupNames(page, /^In the diary/)).toEqual([
    'Helen Example',
    'Brian Example',
    'Ian Sample',
  ])
  expect(await groupNames(page, /^Waiting on them/)).toEqual(WAITING)

  const first = list(page).getByRole('listitem').first()
  await expect(first).not.toContainText('Q3-')
  const visit = list(page).getByRole('listitem').filter({ hasText: 'Brian Example' })
  await expect(visit).toContainText('Visit tomorrow 10:30')
  await expect(visit).toContainText('Site visit booked')
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Eimear' })).toContainText(
    'Quoted €18,450',
  )
  await expect(list(page).getByRole('listitem').filter({ hasText: 'Declan' })).toContainText(
    'How did it go?',
  )
  // Rows are two lines of at least 64px and nothing is cut off at 390px.
  for (const box of await list(page)
    .getByRole('link')
    .evaluateAll((links) => links.map((l) => l.getBoundingClientRect().height)))
    expect(box).toBeGreaterThanOrEqual(64)
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Needs attention' })).toHaveCount(0)
  await shot(page, 'list-open-390')

  // Won, lost and closed are behind Finished.
  await page.getByRole('link', { name: 'Finished (2)' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finished')
  await expect(list(page)).toContainText('Won €18,000')
  await expect(list(page)).toContainText('Lost: Price')
  await page.getByRole('link', { name: 'Back to open enquiries' }).click()

  // Search: by name, phone and reference, as you type, across the groups.
  const search = page.getByRole('searchbox', { name: 'Search enquiries' })
  await search.fill('Sample')
  expect(await names(page)).toEqual(SEARCH_SAMPLE)
  await search.fill('cork')
  expect(await names(page)).toEqual(['Declan Sample'])
  await search.fill('q3-won')
  await expect(
    page.getByText('No open enquiry matches “q3-won”. 1 finished one does.'),
  ).toBeVisible()
  await search.fill('sample')
  await shot(page, 'list-search-390')

  // The search is kept in this tab.
  await page.reload()
  await expect(search).toHaveValue('sample')
  expect(await names(page)).toEqual(SEARCH_SAMPLE)
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
  // The walk follows the list as shown: Your move (Declan, Ciara, Aoife), then the diary.
  await list(page)
    .getByRole('link', { name: /Aoife Sample/ })
    .click()
  const walk = page.getByRole('navigation', { name: 'Enquiries in this list' })
  await expect(walk).toContainText('3 of 7')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aoife Sample')
  await expect(page.getByText('Kitchen · Dublin 8').first()).toBeVisible()
  await openFold(page, 'Details')
  await expect(page.getByText('Q3-CALL01')).toBeVisible()
  await walk.getByRole('link', { name: 'Next' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Helen Example')
  await expect(walk).toContainText('4 of 7')
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

test('the now card: a contact request, then marked contacted; empty answers are hidden', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-call01')
  await expect(nowCard(page)).toContainText('Your move')
  await expect(nowCard(page)).toContainText('Asked us to ring')
  await expect(nowCard(page)).toContainText('No suitable time online')
  // One primary in the bar: ring them.
  await expect(primaryAction(page)).toHaveText('Ring Aoife')
  await expect(primaryAction(page)).toHaveAttribute('href', 'tel:0877654321')
  // The strip says where they are.
  await expect(page.getByRole('list', { name: 'Where they are' }).getByRole('listitem')).toHaveText(
    [/^Call\s*now$/, 'Site visit', 'Estimate', 'Quote', 'Deposit'],
  )
  // Sections are folded to one line each; empty answers are left out when opened.
  await expect(page.getByRole('region', { name: 'Project' })).toBeHidden()
  await openFold(page, 'Their answers')
  const project = page.getByRole('region', { name: 'Project' })
  await expect(project).toContainText('Town or Eircode')
  await expect(project).not.toContainText('House name or number and street')
  await expect(project).not.toContainText('layout')
  await expect(page.getByText(/Not given|Not answered/)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Help us prepare' })).toHaveCount(0)
  await expect(page.locator('#fold-appointments')).toHaveCount(0)
  await shot(page, 'enquiry-contact-390')

  // Other actions: each says what it does; "How did it go?" is one of them, after ringing.
  const sheet = await openActions(page)
  await expect(sheet.getByRole('heading', { name: 'Call back: other actions' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^How did it go/ })).toBeVisible()
  for (const row of await sheet.getByRole('listitem').all())
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(56)
  await shot(page, 'enquiry-actions-sheet-390')
  await sheet.getByRole('button', { name: /^How did it go/ }).click()
  await expect(sheet.getByRole('button', { name: /^We spoke/ })).toBeVisible()
  await shot(page, 'how-did-it-go-ring-390')
  await sheet.getByRole('button', { name: /^No answer, or I left a message/ }).click()
  await expect(sheet).toHaveCount(0)
  await expect(nowCard(page)).toContainText('Waiting on Aoife')
  await expect(nowCard(page)).toContainText('Contacted, nothing booked')
  // Focus is back on the button that opened the sheet.
  await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused()
  expect(world.rpcCalls.filter((c) => c.name === 'set_enquiry_status').map((c) => c.body)).toEqual([
    { p_enquiry_id: 'e-call01', p_status: 'contacted', p_reason: null },
  ])
})

test('an appointment to come: in the diary; moved, then cancelled, from the actions', async ({
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
  await expect(nowCard(page)).toContainText('In the diary')
  await expect(nowCard(page)).toContainText('Site visit Fri 27 Nov, 10:30')
  // The past, cancelled call is in the appointments with its badge, without Move.
  await openFold(page, 'Appointments')
  const appointments = page.getByRole('region', { name: 'Appointments' })
  await expect(appointments).toContainText('Cancelled')
  await expect(appointments.getByRole('button', { name: 'Move' })).toHaveCount(0)
  await shot(page, 'enquiry-appointment-390')

  await expect(primaryAction(page)).toHaveText('Move or cancel')
  await primaryAction(page).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Move' }).click()
  await sheet.getByRole('button', { name: /11:00/ }).click()
  await sheet.getByRole('button', { name: 'Move to 11:00' }).click()
  await page.keyboard.press('Escape')
  await expect(nowCard(page)).toContainText('Mon 30 Nov, 11:00')

  await primaryAction(page).click()
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await sheet.getByLabel('Reason (shown in history)').fill('Customer rang to cancel')
  await sheet.getByRole('button', { name: 'Cancel appointment' }).click()
  await page.keyboard.press('Escape')
  await expect(nowCard(page)).toContainText('Contacted, nothing booked')
  const booking = (world.tables.bookings as Record<string, unknown>[]).find(
    (b) => b.id === 'b-visit',
  )
  expect(booking?.state).toBe('cancelled')
  expect(booking?.cancel_reason).toBe('Customer rang to cancel')
})

test('after the appointment: how it went, a quote recorded; then won from the actions', async ({
  page,
}) => {
  const world = await open(page, '/#/enquiries/e-await1')
  await expect(nowCard(page)).toContainText('How did it go?')
  await expect(nowCard(page)).toContainText('Site visit Tue 24 Nov')
  await expect(primaryAction(page)).toHaveText('How did it go?')
  await primaryAction(page).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'How did the site visit go?' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^It went ahead/ })).toContainText(
    'Next: the estimate form opens',
  )
  await expect(sheet.getByRole('button', { name: /^They didn’t show/ })).toContainText(
    'Next: ring them, then rebook',
  )
  await shot(page, 'how-did-it-go-visit-390')
  await sheet.getByRole('button', { name: /^It went ahead/ }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByLabel('Price in euro')).toBeFocused()
  await expect(nowCard(page)).toContainText('Write the estimate')
  expect(world.rpcCalls.find((c) => c.name === 'set_booking_attendance')?.body).toEqual({
    p_booking_id: 'b-await',
    p_attendance: 'attended',
  })
  const quote = await chooseAction(page, /^Record a quote or result/)
  await quote.getByRole('button', { name: 'Record quote' }).click()
  await quote.getByLabel('Quote amount (€, incl. VAT)').fill('12,300')
  await quote.getByLabel('Date quoted').fill('2026-11-25')
  await quote.getByRole('button', { name: 'Save quote' }).click()
  await expect(quote).toContainText('Quoted €12,300.00 on 25 Nov 2026')
  expect(world.rpcCalls.map((c) => c.name)).toEqual(
    expect.arrayContaining(['set_booking_attendance', 'record_enquiry_outcome']),
  )

  // A quoted enquiry waits on them; Mark won stays among the other actions.
  await page.goto('/#/enquiries/e-quote1')
  await expect(nowCard(page)).toContainText('Waiting on')
  await expect(nowCard(page)).toContainText('Quoted €18,450')
  await shot(page, 'enquiry-quoted-390')
  // Mark won opens its own small form (no row of other outcome buttons); saving ends it.
  const won = await chooseAction(page, /^Mark won/)
  await expect(won.getByRole('button', { name: 'Mark lost' })).toHaveCount(0)
  await won.getByLabel('Date won').fill('2026-11-25')
  await won.getByRole('button', { name: 'Save as won' }).click()
  await expect(won).toHaveCount(0)
  // Won: the result only; corrections are in the actions.
  await expect(nowCard(page)).toContainText('Result')
  await expect(nowCard(page)).toContainText('Won €18,450')
  const fix = await chooseAction(page, /^Correct the result/)
  await expect(fix.getByRole('button', { name: 'Edit win' })).toBeVisible()
})

test('WCAG 2.4.11: nothing focused hides under the fixed action bar at 390 x 640', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await open(page, '/#/enquiries/e-new001')
  await openFolds(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  const bar = page.getByRole('region', { name: 'Actions' })
  const barTop = (await bar.boundingBox())?.y ?? 0
  expect(barTop).toBeLessThan(640)
  // Tab through the whole page: every focused thing outside the bar stays at least partly above it.
  let checked = 0
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab')
    const at = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body || el.closest('[data-action-bar]')) return null
      const r = el.getBoundingClientRect()
      return {
        top: r.top,
        bottom: r.bottom,
        h: r.height,
        tag: el.tagName,
        text: el.textContent?.slice(0, 40),
      }
    })
    if (!at || at.h === 0) continue
    checked++
    expect(at.top, `${at.tag} ${at.text}`).toBeLessThan(barTop)
  }
  expect(checked).toBeGreaterThan(10)
})

test('the actions sheet: focus on its title, Back only from the list, 48px close', async ({
  page,
}) => {
  await open(page, '/#/enquiries/e-await1')
  // Opened straight from the bar: the title has focus and there is no list to go back to.
  await primaryAction(page).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'How did the site visit go?' })).toBeFocused()
  await expect(sheet.getByRole('button', { name: 'Back to the actions' })).toHaveCount(0)
  const close = sheet.getByRole('button', { name: 'Close' })
  expect((await close.boundingBox())?.height).toBeGreaterThanOrEqual(48)
  await page.keyboard.press('Escape')
  await expect(primaryAction(page)).toBeFocused()

  // From the list: the title has focus (not the first row), and a chosen row has Back.
  await openActions(page)
  await expect(sheet.getByRole('heading', { name: /other actions$/ })).toBeFocused()
  await sheet.getByRole('button', { name: /^Move or cancel/ }).click()
  await sheet.getByRole('button', { name: 'Back to the actions' }).click()
  await expect(sheet.getByRole('heading', { name: /other actions$/ })).toBeVisible()
})

test('Notes, the demoted status, and everything else under More', async ({ page }) => {
  const world = await open(page, '/#/enquiries/e-new001')
  await openFolds(page)
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

  // Notes and history together; Details: where they came from, chase, delete.
  await expect(page.getByRole('region', { name: 'History' })).toContainText('Note added')
  await expect(page.getByRole('region', { name: 'Where they came from' })).toContainText(
    'instagram',
  )
  await expect(page.getByRole('region', { name: 'Had to chase details' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Delete' })).toBeVisible()
  await shot(page, 'enquiry-more-390')
})

test('Appointments: an agenda by day and Past; over-and-unrecorded ones are under Your move', async ({
  page,
}) => {
  await open(page, '/#/appointments')
  await expect(page.getByRole('radio', { name: 'Upcoming' })).toBeChecked()
  // "To wrap up" is gone: Declan's visit (over, nothing recorded) is under Your move instead.
  await expect(page.getByRole('region', { name: 'To wrap up' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Your move' })).toBeVisible()

  const headings = page.getByRole('heading', { level: 2 })
  await expect(headings).toHaveText(['Today', 'Tomorrow', 'Wed 2 Dec'])
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
  // From 1024px the header, strip, now card and actions are the left column.
  const next = nowCard(page)
  const project = page.locator('#fold-answers')
  await expect(next).toBeVisible()
  await expect(page.getByRole('region', { name: 'Actions' })).toBeVisible()
  const left = await next.boundingBox()
  const right = await project.boundingBox()
  expect(left && right && left.x + left.width <= right.x).toBe(true)
  await shot(page, 'enquiry-desktop')
  // The left column stays in view while the sections scroll.
  await page.mouse.wheel(0, 600)
  await expect.poll(async () => (await next.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0)

  await page.goto('/#/appointments')
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible()
  await shot(page, 'appointments-desktop')
})
