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
 * Stage rules and labels from the first UX review of the staff console: an appointment still to
 * come is never hidden by an estimate, "To wrap up" agrees with Needs action, "Estimate to write",
 * one filled button in Next step, news-first list lines, a Result card, staff wording. Fake
 * backend only (sample people, example.com addresses); the clock is fixed at Thursday
 * 26 November 2026, 12:00. SCREENSHOTS_DIR keeps the 390px screenshots.
 */

const NOW = '2026-11-26T12:00:00Z'

const shot = async (page: Page, name: string) => {
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
    call_held_at: null,
    visit_link_sent_at: null,
    enquiry_attribution: null,
    enquiry_events: [],
    bookings: [] as unknown[],
    estimates: [] as unknown[],
    ...over,
  }
}

type E = ReturnType<typeof enquiry>

function book(
  world: StaffWorld,
  e: E,
  id: string,
  start: string,
  mode: 'phone' | 'on_site',
  attendance: string | null = null,
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
    attendance,
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
      outcome: e.outcome,
      site_details: e.site_details,
    },
  }
  world.tables.bookings = [...(world.tables.bookings ?? []), row]
  e.bookings.push({
    starts_at: start,
    confirmed_at: row.confirmed_at,
    state: 'confirmed',
    attendance,
    appointment_types: { mode },
  })
}

const estimate = (sent: string, requested: string | null = null, after = 'visit') => ({
  id: `00000000-0000-4000-8000-${sent.slice(8, 10)}0000000000`,
  booking_id: null,
  price_eur: 10000,
  plus_minus_percent: 5,
  low_eur: 9500,
  high_eur: 10500,
  work_items: ['Strip out the old kitchen'],
  work_looked_at: null,
  caveats: 'This is an estimate, not a quote.',
  sent_at: sent,
  valid_until: new Date(Date.parse(sent) + 10 * 86_400_000).toISOString(),
  quote_requested_at: requested,
  created_by_name: 'Sam Staff',
  after,
})

function seed(world: StaffWorld) {
  // Call held, estimate sent after it, then a site visit booked for later.
  const mixed = enquiry('e-mix001', 'Orla Test', {
    estimates: [estimate('2026-11-20T15:00:00Z', null, 'call')],
  })
  book(world, mixed, 'b-mcall', '2026-11-18T10:00:00Z', 'phone', 'attended')
  book(world, mixed, 'b-mvisit', '2026-11-28T10:00:00Z', 'on_site')
  // A visit that has happened, attendance not recorded yet.
  const visited = enquiry('e-visit1', 'Brian Example')
  book(world, visited, 'b-visit', '2026-11-24T10:00:00Z', 'on_site')
  // A visit attended, estimate not written.
  const attended = enquiry('e-attnd1', 'Helen Example')
  book(world, attended, 'b-attnd', '2026-11-23T10:00:00Z', 'on_site', 'attended')
  // An estimate with no answer after 10 days.
  const quiet = enquiry('e-quiet1', 'Ciara Test', { estimates: [estimate('2026-11-12T15:00:00Z')] })
  book(world, quiet, 'b-quiet', '2026-11-12T10:00:00Z', 'on_site', 'attended')
  // Asked for the quote; the visit's attendance was never recorded.
  const asked = enquiry('e-asked1', 'Declan Sample', {
    estimates: [estimate('2026-11-23T15:00:00Z', '2026-11-25T09:00:00Z')],
  })
  book(world, asked, 'b-asked', '2026-11-23T10:00:00Z', 'on_site')
  // Won.
  const won = enquiry('e-won001', 'Fiona Test', {
    outcome: 'won',
    outcome_value: 18000,
    won_date: '2026-11-25',
    quote_amount: 18000,
    quote_date: '2026-11-22',
    estimates: [estimate('2026-11-16T15:00:00Z', '2026-11-17T09:00:00Z')],
  })
  book(world, won, 'b-won', '2026-11-16T10:00:00Z', 'on_site', 'attended')
  world.tables.enquiries = [mixed, visited, attended, quiet, asked, won]
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

const rows = (page: Page) => page.getByRole('region', { name: 'Enquiries' }).getByRole('listitem')
const row = (page: Page, name: string) => rows(page).filter({ hasText: name })
const h1 = (page: Page, name: string) =>
  expect(page.getByRole('heading', { level: 1 })).toHaveText(name)

test('screens at 390px for the review (before and after)', async ({ page }) => {
  await open(page)
  await expect(rows(page).first()).toBeVisible()
  await shot(page, 'list-open')
  await page.getByRole('link', { name: /^Finished/ }).click()
  await expect(row(page, 'Fiona Test')).toBeVisible()
  await shot(page, 'list-finished')
  for (const [id, name, file] of [
    ['e-mix001', 'Orla Test', 'f1-mixed-detail'],
    ['e-visit1', 'Brian Example', 'f3-visit-happened'],
    ['e-asked1', 'Declan Sample', 'f4-quote-requested'],
    ['e-won001', 'Fiona Test', 'f5-won'],
    ['e-attnd1', 'Helen Example', 'f6-project-and-status'],
  ] as const) {
    await page.goto(`/#/enquiries/${id}`)
    await h1(page, name)
    await expect(page.getByRole('list', { name: 'Where they are' })).toBeVisible()
    await shot(page, file)
  }
  await page.goto('/#/enquiries/e-visit1')
  await h1(page, 'Brian Example')
  // How did it go? It went ahead: the estimate form opens.
  await primaryAction(page).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^It went ahead/ })
    .click()
  await expect(page.getByLabel('Price in euro')).toBeFocused()
  await expect(page.getByRole('group', { name: 'Plus or minus' })).toBeVisible()
  await shot(page, 'f7-f8-estimate-form')
  await page.goto('/#/appointments')
  await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible()
  await shot(page, 'f2-appointments')
})

test('F1: a visit still to come is never hidden by an estimate', async ({ page }) => {
  await open(page)
  const orla = row(page, 'Orla Test')
  await expect(orla).toContainText('Visit Sat 10:00')
  await expect(orla).toContainText('Estimate sent 20 Nov')
  // In the diary, not waiting on the estimate.
  await expect(
    page.getByRole('region', { name: /^In the diary/ }).getByRole('listitem'),
  ).toHaveCount(1)
  await expect(page.getByRole('region', { name: /^In the diary/ })).toContainText('Orla Test')
  await orla.getByRole('link').click()
  await h1(page, 'Orla Test')
  await expect(nowCard(page)).toContainText('In the diary')
  await expect(nowCard(page)).toContainText('Sat 28 Nov, 10:00')
  await primaryAction(page).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Move' })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeVisible()
  await page.keyboard.press('Escape')
  // The estimate is still there, in its own section.
  await expect(page.locator('#fold-estimate summary')).toContainText('€9,500 to €10,500')
})

test('F2: one list of work: an appointment over and unrecorded is under Your move', async ({
  page,
}) => {
  await open(page, '/#/appointments')
  await expect(page.getByRole('region', { name: 'To wrap up' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Enquiries' }).click()
  const yours = page.getByRole('region', { name: /^Your move/ })
  await expect(yours.getByRole('listitem').filter({ hasText: 'Brian Example' })).toContainText(
    'How did it go?',
  )
  await expect(yours.getByRole('listitem').filter({ hasText: 'How did it go?' })).toHaveCount(1)
})

test('F3, F7: after a visit the next step is the estimate, with one filled button', async ({
  page,
}) => {
  await open(page, '/#/enquiries/e-visit1')
  await h1(page, 'Brian Example')
  await expect(nowCard(page)).toContainText('How did it go?')
  // One filled button on the page: the primary action, in the bar.
  const filled = page.locator('[data-slot="button"].bg-primary:visible, a.bg-primary:visible')
  await expect(filled).toHaveCount(1)
  await expect(filled).toHaveText('How did it go?')
  // Won and lost are not offered before anything has gone out.
  const sheet = await openActions(page)
  await expect(sheet.getByRole('button', { name: /^Mark won/ })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: /^Mark lost/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // The visit went ahead; then the estimate is the one action (the section does not repeat it).
  // How did it go? It went ahead: the estimate form opens.
  await primaryAction(page).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^It went ahead/ })
    .click()
  await expect(page.getByLabel('Price in euro')).toBeFocused()

  // The plus-or-minus chips are 48px targets.
  const chips = page.getByRole('group', { name: 'Plus or minus' }).locator('label')
  await expect(chips).toHaveCount(5)
  for (const chip of await chips.all())
    expect((await chip.boundingBox())?.height).toBeGreaterThanOrEqual(48)
  // Back on the enquiry, the Estimate section does not repeat the bar's action.
  await page.getByRole('link', { name: /^Back to/ }).click()
  await openFold(page, 'Estimate')
  const estimate = page.getByRole('region', { name: 'Estimate', exact: true })
  await expect(estimate).toContainText('No estimate sent yet.')
  await expect(estimate.getByRole('link', { name: /Write (the|an) estimate/ })).toHaveCount(0)
})

test('F4: list lines lead with the news', async ({ page }) => {
  await open(page)
  await expect(row(page, 'Declan Sample')).toContainText('Quote due Mon 30 Nov')
  await expect(row(page, 'Declan Sample')).toContainText('Asked for a quote 25 Nov')
  await expect(row(page, 'Ciara Test')).toContainText('No answer')
  await expect(row(page, 'Ciara Test')).toContainText('Estimate €9,500 to €10,500')
  await expect(row(page, 'Brian Example')).toContainText('How did it go?')
})

test('F5: a won enquiry shows the result only; corrections are in the actions', async ({
  page,
}) => {
  await open(page, '/#/enquiries/e-won001')
  await h1(page, 'Fiona Test')
  await expect(nowCard(page)).toContainText('Result')
  await expect(nowCard(page)).toContainText('Won €18,000')
  // The one filled action is the job plan (a won job is planned next); no outcome buttons.
  await expect(
    page.locator('[data-slot="button"].bg-primary:visible, a.bg-primary:visible'),
  ).toHaveText(['Open the job plan'])
  const sheet = await chooseAction(page, /^Correct the result/)
  await expect(sheet.getByRole('button', { name: 'Edit win' })).toBeVisible()
})

test('F6: staff wording on the enquiry page', async ({ page }) => {
  await open(page, '/#/enquiries/e-attnd1')
  await h1(page, 'Helen Example')
  await openFolds(page)
  const project = page.getByRole('region', { name: 'Project' })
  await expect(project).toContainText('Name')
  await expect(project).toContainText('Wants')
  await expect(project).not.toContainText('Your name')
  await expect(project).not.toContainText('Appointment preference')
  await expect(project).not.toContainText('Form: enquiry version')
  await expect(page.getByText('Change status (now: Contacted)')).toBeVisible()
  await expect(page.getByText(/form enquiry version 2/)).toBeVisible()
})
