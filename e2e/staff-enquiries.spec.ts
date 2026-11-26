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

  // The list (redesigned 2026-11-28): name, project and town, where it stands, one stage badge.
  // The layout follow-up and the preference moved to the enquiry page (no pile of pills).
  const rows = page.getByRole('list', { name: 'Enquiries' }).getByRole('listitem')
  await expect(rows.first()).toContainText('Sample Customer')
  await expect(rows.first()).toContainText('Kitchen · Dublin 8')
  await expect(rows.first()).toContainText('Asked to be contacted')
  await expect(rows.first()).toContainText('Call back')
  await expect(rows.nth(1)).toContainText('Whole home renovation')
  await expect(rows.nth(1)).toContainText('Not booked yet')
  await shot(page, 's1-enquiry-list')

  // A v2 enquiry with a contact request.
  await rows.first().getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Customer')
  await expect(page.getByText('Q3-BBBB22')).toBeVisible()
  // The contact request is the Next step (it was a red alert at the top).
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('Asked to be contacted')
  await expect(next).toContainText('No suitable time online')
  const project = page.getByRole('region', { name: 'Project' })
  await expect(project).toContainText('Appointment preference')
  await expect(project).toContainText('Site visit')
  await expect(project).toContainText('Are you keeping the layout or changing it?')
  await expect(project).toContainText('Changing it')
  await expect(project).toContainText('Town or Eircode')
  // Contact answers and the street are part of Project now (one section of their answers).
  await expect(project).toContainText('Phone number')
  await expect(project).toContainText('House name or number and street')
  await expect(project).toContainText('12 Example Road')
  await shot(page, '11-staff-v2-contact-request')

  // A v1 enquiry still renders through its own version.
  await page.goto('/#/enquiries/e-v1')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test Person')
  const v1Project = page.getByRole('region', { name: 'Project' })
  await expect(v1Project).toContainText('What would you like done?')
  await expect(v1Project).toContainText('Full refit of the ground floor.')
  await expect(v1Project).toContainText('Kitchen, Bedrooms')
  await expect(v1Project).toContainText('Form: enquiry version 1')
  await expect(page.getByText('Asked to be contacted')).toHaveCount(0)
  await shot(page, 's2-staff-v1')
})

test('staff see what a customer added after booking: the marker, the answers and the photos', async ({
  page,
}) => {
  // Two real JPEGs made in the browser: a thumbnail and the full-size photo.
  const [thumb, full] = await page.evaluate(() =>
    [320, 1600].map((w) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = Math.round((w * 3) / 4)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#c8b8a0'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#6b5a45'
        ctx.fillRect(canvas.width / 8, canvas.height / 2, (canvas.width * 3) / 4, canvas.height / 3)
      }
      return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? ''
    }),
  )
  const world = staffWorld()
  const path = 'enquiries/e-v2p/00000000-0000-4000-9000-000000000001.jpg'
  world.tables.enquiries = [
    {
      ...v2,
      id: 'e-v2p',
      reference: 'Q3-CCCC33',
      contact_requested_at: null,
      contact_request_reason: null,
      added_after_booking_at: '2026-11-26T18:20:00Z',
      prepare_details: { budget: '25k_50k', timing: 'flexible' },
      prepare_form_version: 1,
      site_details: { site_address: '12 Example Road, Dublin 8', access_notes: 'Side gate' },
      enquiry_events: [
        {
          id: 5,
          kind: 'photo_added',
          detail: null,
          from_status: null,
          to_status: null,
          reason: null,
          actor_name: null,
          created_at: '2026-11-26T18:20:00Z',
        },
      ],
    },
  ]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  world.tables.enquiry_photos = [
    {
      id: 'ph-1',
      enquiry_id: 'e-v2p',
      object_path: path,
      width: 1600,
      height: 1200,
      thumb_jpeg: `\\x${Buffer.from(thumb ?? '', 'base64').toString('hex')}`,
      uploaded_at: '2026-11-26T18:20:00Z',
    },
  ]
  world.photoFiles.set(path, Buffer.from(full ?? '', 'base64'))
  await installFakeStaff(page, world)
  await page.goto('/#/')
  await signIn(page, 'staff@example.com', 'another long password')
  const row = page.getByRole('list', { name: 'Enquiries' }).getByRole('listitem').first()
  await expect(row).toContainText('Added after booking')
  await row.getByRole('link').click()

  const prepared = page.getByRole('region', { name: 'Help us prepare' })
  await expect(prepared).toContainText('Added after booking')
  await expect(prepared).toContainText('Rough budget')
  await expect(prepared).toContainText('€25,000 to €50,000')
  await expect(prepared).toContainText('I’m flexible')
  // Access notes sit with the rest of "Help us prepare" now.
  await expect(prepared).toContainText('Side gate')
  await page.getByText('More', { exact: true }).click()
  await expect(page.getByText('Customer added a photo (after booking)')).toBeVisible()
  await shot(page, '05-staff-photos')

  await prepared.getByRole('button', { name: /^Customer upload 1/ }).click()
  const viewer = page.getByRole('dialog', { name: 'Photo, full size' })
  await expect(viewer.getByRole('img')).toBeVisible()
  expect(
    await viewer.getByRole('img').evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBe(1600)
  await shot(page, '05b-staff-photo-full')
  await viewer.getByRole('button', { name: 'Close' }).click()
  await expect(viewer).toBeHidden()
})
