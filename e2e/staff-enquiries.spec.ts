import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld } from './fake-staff'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const base = {
  status: 'new',
  status_reason: null,
  marketing_opt_in: false,
  marketing_opt_in_at: null,
  updated_at: '2026-11-26T10:00:00Z',
  site_details_form_version: null,
  contact_request_reason: null,
  outcome: null,
  outcome_value: null,
  outcome_reason: null,
  outcome_note: null,
  enquiry_attribution: null,
}

const v1 = {
  ...base,
  id: 'e-v1',
  reference: 'Q3-AAAA11',
  form_id: 'enquiry',
  form_version: 1,
  submitted_at: '2026-11-24T09:00:00Z',
  answers: {
    project_type: 'whole_home',
    description: 'Full refit of the ground floor.',
    rooms: ['kitchen', 'bedrooms'],
    location: 'D07 X2Y3',
    timing: 'flexible',
    name: 'Test Person',
    email: 'v1@example.com',
    phone: '087 123 4567',
  },
  site_details: null,
  contact_requested_at: null,
  enquiry_events: [
    {
      id: 1,
      kind: 'submitted',
      detail: null,
      from_status: null,
      to_status: 'new',
      reason: null,
      actor_name: null,
      created_at: '2026-11-24T09:00:00Z',
    },
  ],
}

const v2 = {
  ...base,
  id: 'e-v2',
  reference: 'Q3-BBBB22',
  form_id: 'enquiry',
  form_version: 2,
  submitted_at: '2026-11-26T10:00:00Z',
  answers: {
    appointment_preference: 'on_site',
    project_type: 'kitchen',
    kitchen_layout: 'changing',
    location: 'Dublin 8',
    name: 'Sample Customer',
    email: 'v2@example.com',
    phone: '087 765 4321',
    site_street: '12 Example Road',
  },
  site_details: { site_address: '12 Example Road, Dublin 8' },
  site_details_form_version: 1,
  contact_requested_at: '2026-11-26T10:05:00Z',
  contact_request_reason: 'No suitable time online',
  enquiry_events: [
    {
      id: 3,
      kind: 'contact_requested',
      detail: 'No suitable time online',
      from_status: null,
      to_status: null,
      reason: null,
      actor_name: null,
      created_at: '2026-11-26T10:05:00Z',
    },
    {
      id: 2,
      kind: 'submitted',
      detail: null,
      from_status: null,
      to_status: 'new',
      reason: null,
      actor_name: null,
      created_at: '2026-11-26T10:00:00Z',
    },
  ],
}

test('staff see v2 enquiries with the preference, project answers and contact request, and v1 ones as before', async ({
  page,
}) => {
  const world = staffWorld()
  world.tables.enquiries = [v2, v1]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  await installFakeStaff(page, world)
  await page.goto('/#/')
  await signIn(page, 'staff@example.com', 'another long password')

  // The list: the choice, the follow-up and the contact request at a glance.
  const rows = page.getByRole('main').getByRole('listitem')
  await expect(rows.first()).toContainText('Kitchen')
  await expect(rows.first()).toContainText('Dublin 8 · Layout: Changing it')
  await expect(rows.first()).toContainText('Wants a site visit')
  await expect(rows.first()).toContainText('Contact request')
  await expect(rows.nth(1)).toContainText('Whole home renovation')
  await expect(rows.nth(1)).not.toContainText('Wants a')
  await shot(page, 's1-enquiry-list')

  // A v2 enquiry with a contact request.
  await rows.first().getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Q3-BBBB22' })).toBeVisible()
  await expect(page.getByText('Wants a site visit')).toBeVisible()
  await expect(
    page.getByText('Contact request: the customer asked us to contact them'),
  ).toBeVisible()
  await expect(page.getByText(/No suitable time online/).first()).toBeVisible()
  const project = page.getByRole('region', { name: 'Project' })
  await expect(project).toContainText('Appointment preference')
  await expect(project).toContainText('Site visit')
  await expect(project).toContainText('Are you keeping the layout or changing it?')
  await expect(project).toContainText('Changing it')
  await expect(project).toContainText('Town or Eircode')
  const contact = page.getByRole('region', { name: 'Contact' })
  await expect(contact).toContainText('Phone number')
  await expect(contact).toContainText('House name or number and street')
  await expect(page.getByRole('region', { name: 'Property' })).toContainText(
    '12 Example Road, Dublin 8',
  )
  await shot(page, '11-staff-v2-contact-request')

  // A v1 enquiry still renders through its own version.
  await page.goto('/#/enquiries/e-v1')
  await expect(page.getByRole('heading', { name: 'Q3-AAAA11' })).toBeVisible()
  const v1Project = page.getByRole('region', { name: 'Project' })
  await expect(v1Project).toContainText('What would you like done?')
  await expect(v1Project).toContainText('Full refit of the ground floor.')
  await expect(v1Project).toContainText('Kitchen, Bedrooms')
  await expect(v1Project).toContainText('Form: enquiry version 1')
  await expect(page.getByText('Contact request')).toHaveCount(0)
  await shot(page, 's2-staff-v1')
})
