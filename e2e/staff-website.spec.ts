import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld } from './fake-staff'

/*
 * Staff see where a website enquiry started and the new project type (form enquiry@3). Fake
 * backend, sample people. SCREENSHOTS_DIR keeps the phone screenshot.
 */

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const enquiry = (over: Record<string, unknown>) => ({
  id: 'e-web',
  reference: 'Q3-WEB123',
  status: 'new',
  status_reason: null,
  form_id: 'enquiry',
  form_version: 3,
  submitted_at: '2026-11-28T10:00:00Z',
  updated_at: '2026-11-28T10:00:00Z',
  answers: {
    appointment_preference: 'on_site',
    project_type: 'workplace',
    location: 'Dublin 2',
    name: 'Sample Customer',
    email: 'website@example.com',
    phone: '087 765 4321',
    site_street: '1 Example Square',
  },
  marketing_opt_in: false,
  marketing_opt_in_at: null,
  site_details: { site_address: '1 Example Square, Dublin 2' },
  site_details_form_version: 1,
  contact_requested_at: null,
  contact_request_reason: null,
  outcome: null,
  outcome_value: null,
  outcome_reason: null,
  outcome_note: null,
  inspiration: 'fitzwilliam-office',
  enquiry_attribution: null,
  enquiry_events: [],
  bookings: [],
  ...over,
})

test('the enquiry page says which website project it came from; v3 types read plainly', async ({
  page,
}) => {
  const world = staffWorld()
  world.tables.enquiries = [
    enquiry({}),
    enquiry({
      id: 'e-old',
      reference: 'Q3-OLD123',
      inspiration: 'a-project-added-later',
      answers: { project_type: 'kitchen', location: 'Cork', name: 'Other Sample' },
    }),
    enquiry({ id: 'e-none', reference: 'Q3-NON123', inspiration: undefined, form_version: 2 }),
  ]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.tables.calendar_connections = [
    { staff_user_id: 'u-staff', status: 'connected', last_error: null },
  ]
  await installFakeStaff(page, world)
  await page.goto('/#/')
  await signIn(page, 'staff@example.com', 'another long password')
  const rows = page.getByRole('list', { name: 'Enquiries' }).getByRole('listitem')
  await expect(rows.first()).toContainText('Workplace fit-out · Dublin 2')

  await rows.first().getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Customer')
  await expect(
    page.getByText('Came from the website: Georgian office fit-out, Fitzwilliam Square, Dublin 2'),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Project' })).toContainText('Workplace fit-out')
  await shot(page, 'staff-enquiry-website-390')

  // A slug this build does not know shows as stored; an enquiry without one says nothing.
  await page.goto('/#/enquiries/e-old')
  await expect(page.getByText('Came from the website: a-project-added-later')).toBeVisible()
  await page.goto('/#/enquiries/e-none')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/Came from the website/)).toHaveCount(0)
})
