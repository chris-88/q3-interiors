import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld } from './fake-staff'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const enquiry = {
  id: 'e-chase',
  reference: 'Q3-DDDD44',
  status: 'contacted',
  status_reason: null,
  form_id: 'enquiry',
  form_version: 2,
  submitted_at: '2026-11-27T10:00:00Z',
  updated_at: '2026-11-27T10:00:00Z',
  answers: {
    appointment_preference: 'on_site',
    project_type: 'kitchen',
    location: 'Dublin 8',
    name: 'Sample Customer',
    email: 'chase@example.com',
    phone: '087 765 4321',
    site_street: '12 Example Road',
  },
  marketing_opt_in: false,
  marketing_opt_in_at: null,
  site_details: { site_address: '12 Example Road, Dublin 8' },
  site_details_form_version: 1,
  contact_requested_at: null,
  contact_request_reason: null,
  outcome: null,
  outcome_value: null,
  outcome_reason: null,
  outcome_note: null,
  enquiry_attribution: null,
  enquiry_events: [],
}

test('any staff member flags "had to chase details" with what was missing; history kept', async ({
  page,
}) => {
  const world = staffWorld()
  world.tables.enquiries = [enquiry]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  await installFakeStaff(page, world)
  await page.goto('/#/enquiries/e-chase')
  await signIn(page, 'staff@example.com', 'another long password')
  const chase = page.getByRole('region', { name: 'Had to chase details' })
  await chase.getByRole('checkbox', { name: 'Had to chase details' }).click()
  await chase.getByLabel('What was missing?').fill('x')
  await chase.getByRole('button', { name: 'Save' }).click()
  await expect(chase.getByRole('alert')).toHaveText('Say what was missing (3 to 500 characters).')
  await chase.getByLabel('What was missing?').fill('No house number; had to ring for it')
  await chase.getByRole('button', { name: 'Save' }).click()
  await expect(chase).toContainText('Flagged')
  await expect(chase).toContainText('by Sam Staff')
  await expect(page.getByText('Flagged: had to chase details')).toBeVisible()
  await chase.scrollIntoViewIfNeeded()
  await shot(page, '02-chase-flag')
  expect(world.rpcCalls.filter((c) => c.name === 'set_chase_details')).toHaveLength(1)
})

test('the report shows the pilot measures by form version, route and campaign', async ({
  page,
}) => {
  const world = staffWorld()
  const row = (dim: string, key: string, over: Record<string, unknown> = {}) => ({
    dim,
    key,
    sessions: 240,
    chose: 150,
    saved: 36,
    booked: 24,
    attended: 20,
    suitable_attended: 18,
    chased: 3,
    median_to_saved_seconds: 260,
    median_to_booked_seconds: 520,
    ...over,
  })
  world.pilot = {
    counted_from: '2026-11-27T12:00:00Z',
    rows: [
      row('all', 'all', { saved: 50, booked: 31, attended: 26, suitable_attended: 23, chased: 4 }),
      row('version', '2'),
      row('version', '1', {
        sessions: null,
        chose: null,
        saved: 14,
        booked: 7,
        attended: 6,
        suitable_attended: 5,
        chased: 1,
        median_to_saved_seconds: null,
        median_to_booked_seconds: null,
      }),
      row('route', 'phone', { sessions: 90, saved: 20, booked: 14 }),
      row('route', 'on_site', { sessions: 60, saved: 16, booked: 10 }),
      row('campaign', 'kitchens', { sessions: 180 }),
    ],
    headline: { instagram_sessions: 200, instagram_suitable_attended: 16 },
  }
  await installFakeStaff(page, world)
  await page.goto('/#/report')
  await signIn(page, 'staff@example.com', 'another long password')
  await page.getByLabel('From').fill('2026-11-01')
  await page.getByLabel('To').fill('2026-12-31')
  const pilot = page.getByRole('region', { name: 'Pilot measures' })
  await expect(pilot).toContainText(
    'Landing sessions are counted on this site from 27 November 2026',
  )
  await expect(pilot).toContainText('days before that show “not counted”')
  await expect(
    pilot.getByText('Suitable, attended appointments per 100 Instagram landing sessions'),
  ).toBeVisible()
  await expect(pilot).toContainText('8.0') // 16 per 200 sessions
  await expect(pilot).toContainText('13%') // 4 of 31 bookings chased
  const v1 = pilot.getByRole('region', { name: 'Form v1' })
  await expect(v1.getByRole('row', { name: /Landing sessions/ })).toContainText('not counted')
  await expect(v1.getByRole('row', { name: /Saved enquiries/ })).toContainText('14')
  const v2 = pilot.getByRole('region', { name: 'Form v2' })
  await expect(v2.getByRole('row', { name: /Confirmed bookings/ })).toContainText('24')
  await expect(v2.getByRole('row', { name: /Confirmed bookings/ })).toContainText('10.0')
  await expect(v2).toContainText('4 min')
  await expect(pilot.getByRole('region', { name: 'Site visit' })).toBeVisible()
  await expect(pilot.getByRole('region', { name: 'kitchens' })).toBeVisible()
  await pilot.scrollIntoViewIfNeeded()
  await shot(page, '01-report-pilot')

  // A range wholly before counting began says "not counted", never zero.
  await page.getByLabel('From').fill('2026-10-01')
  await page.getByLabel('To').fill('2026-10-31')
  await expect(
    pilot
      .getByRole('region', { name: 'All', exact: true })
      .getByRole('row', { name: /Landing sessions/ }),
  ).toContainText('not counted')
})
