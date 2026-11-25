import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld, type StaffWorld } from './fake-staff'

/*
 * Forward compatibility: every staff screen must cope with data a newer release wrote (new enum
 * values, new event kinds, extra columns, rows it cannot read) and with a newer build being live.
 */

const event = (id: number, kind: string, detail: string | null = null) => ({
  id,
  kind,
  detail,
  from_status: null,
  to_status: kind === 'submitted' ? 'new' : null,
  reason: null,
  actor_name: null,
  created_at: '2026-11-27T10:00:00Z',
})

const enquiry = (over: Record<string, unknown>) => ({
  id: 'e-1',
  reference: 'Q3-AAAA11',
  status: 'new',
  status_reason: null,
  form_id: 'enquiry',
  form_version: 2,
  submitted_at: '2026-11-27T10:00:00Z',
  updated_at: '2026-11-27T10:00:00Z',
  answers: {
    appointment_preference: 'phone',
    project_type: 'kitchen',
    location: 'Dublin 8',
    name: 'Sample Customer',
    email: 'compat@example.com',
    phone: '087 765 4321',
  },
  marketing_opt_in: false,
  marketing_opt_in_at: null,
  site_details: null,
  site_details_form_version: null,
  contact_requested_at: null,
  contact_request_reason: null,
  outcome: null,
  outcome_value: null,
  outcome_reason: null,
  outcome_note: null,
  enquiry_attribution: null,
  enquiry_events: [event(1, 'submitted')],
  // A column a newer release added.
  sentiment_score: 0.9,
  ...over,
})

function seed(world: StaffWorld) {
  world.tables.enquiries = [
    enquiry({
      id: 'e-new',
      reference: 'Q3-NEWW22',
      status: 'awaiting_survey',
      outcome: 'deferred',
      enquiry_events: [event(3, 'survey_sent', 'Sent the pre-visit survey'), event(1, 'submitted')],
    }),
    enquiry({}),
    // A row this build cannot read at all (no reference).
    enquiry({ id: 'e-bad', reference: null }),
  ]
  world.tables.form_versions = [
    ...publishedForms.map((f) => ({ form_id: f.formId, version: f.version, schema: f })),
    // A form version with a field type this build does not know.
    {
      form_id: 'enquiry',
      version: 3,
      schema: {
        formId: 'enquiry',
        version: 3,
        title: 'x',
        steps: [
          {
            id: 's',
            title: 's',
            fields: [{ id: 'when', type: 'date', label: 'When', required: true }],
          },
        ],
      },
    },
  ]
  world.tables.bookings = [
    {
      id: 'b-1',
      enquiry_id: 'e-1',
      state: 'awaiting_deposit',
      starts_at: '2026-12-02T10:00:00Z',
      ends_at: '2026-12-02T10:20:00Z',
      failure_reason: null,
      calendar_event_id: 'q3b1',
      calendar_event_link: null,
      created_at: '2026-11-27T10:00:00Z',
      attendance: null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      calendar_mismatch: null,
      appointment_types: { label: 'Video call', mode: 'video' },
      enquiries: { reference: 'Q3-AAAA11', answers: {} },
      extra_column: true,
    },
  ]
  world.funnel = [
    {
      campaign: 'kitchens',
      enquiries: 3,
      booked: 1,
      attended: 1,
      won: 0,
      cancelled: 0,
      no_shows: 0,
      won_value: 0,
      spend_per_lead: 12,
    },
  ]
  world.pilot = {
    counted_from: '2026-11-25T12:00:00Z',
    rows: [
      {
        dim: 'all',
        key: 'all',
        sessions: 10,
        chose: 5,
        saved: 3,
        booked: 1,
        attended: 1,
        suitable_attended: 1,
        chased: 0,
        median_to_saved_seconds: 300,
        median_to_booked_seconds: 900,
      },
      { dim: 'device', key: 'mobile', sessions: 7 },
    ],
    headline: { instagram_sessions: 5, instagram_suitable_attended: 1, new_measure: 3 },
  }
  world.tables.ads = [
    {
      id: 'ad-1',
      name: 'An ad from the future',
      status: 'scheduled',
      created_at: '2026-11-25T10:00:00Z',
      created_by_name: null,
      campaign_creatives: null,
      ad_versions: [
        {
          id: 'ver-1',
          version: 1,
          caption: 'Caption',
          headline: null,
          button_label: null,
          notes: null,
          created_at: '2026-11-25T10:00:00Z',
          ad_variants: [
            {
              id: 'v-1',
              size: 'portrait',
              width: 1440,
              height: 1800,
              html_path: 'ad-1/v1/portrait.html',
              export_path: 'ad-1/v1/portrait.png',
              export_bytes: 10,
            },
            {
              id: 'v-2',
              size: 'billboard',
              width: 1440,
              height: 720,
              html_path: 'ad-1/v1/billboard.html',
              export_path: 'ad-1/v1/billboard.png',
              export_bytes: 10,
            },
          ],
        },
      ],
      ad_requests: [],
    },
  ]
  world.adFiles.set('ad-1/v1/portrait.html', {
    body: '<!doctype html><html><head></head><body style="margin:0;width:1440px;height:1800px;background:#eee">Ad</body></html>',
    type: 'text/html',
  })
}

const bar = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'version of the staff console' })

test('screens cope with values, kinds, fields and rows a newer release added', async ({ page }) => {
  const world = staffWorld()
  seed(world)
  await installFakeStaff(page, world)
  page.on('console', (m) => {
    // Issue paths are logged; values never are.
    if (m.type() === 'warning') expect(m.text()).not.toContain('compat@example.com')
  })
  await page.goto('/#/')
  await signIn(page, 'staff@example.com', 'another long password')

  // The list: unknown status shown plainly, the unreadable row left out with a note.
  const rows = page.getByRole('list', { name: 'Enquiries' }).getByRole('link')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('awaiting_survey')
  await expect(bar(page)).toContainText(/Some enquiries.* could not be shown by this version/)
  await expect(bar(page).getByRole('button', { name: 'Reload' })).toBeVisible()

  // The detail: unknown history kind and outcome degrade, the page works.
  await rows.first().click()
  await expect(page.getByRole('heading', { name: 'Q3-NEWW22' })).toBeVisible()
  await expect(page.getByText('Update recorded')).toBeVisible()
  await expect(page.getByText('Sent the pre-visit survey')).toBeVisible()
  await expect(
    page.getByText('This was set by a newer version of the console.').first(),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Project' })).toContainText('Kitchen')

  // Appointments: an unknown state and mode.
  await page.getByRole('link', { name: 'Appointments' }).click()
  await expect(page.getByText('awaiting_deposit')).toBeVisible()

  // Report: extra funnel field, unknown pilot dimension and headline.
  await page.getByRole('link', { name: 'Report' }).click()
  await page.getByLabel('From').fill('2026-11-01')
  await page.getByLabel('To').fill('2026-12-31')
  await expect(page.getByRole('region', { name: 'Pilot measures' })).toContainText(
    'Landing sessions',
  )
  await expect(
    page.getByRole('region', { name: 'kitchens (tag, no campaign set up)' }),
  ).toBeVisible()

  // Ads: unknown status; a size this build cannot frame is left out.
  await page.getByRole('link', { name: /^Ads/ }).click()
  await expect(page.getByText('An ad from the future')).toBeVisible()
  await expect(page.getByText('scheduled')).toBeVisible()
  await page.getByRole('link', { name: /An ad from the future/ }).click()
  await expect(page.getByRole('heading', { name: 'An ad from the future' })).toBeVisible()
})

test('a newer build reloads the app at once when nobody is typing', async ({ page }) => {
  const world = staffWorld()
  world.tables.enquiries = [enquiry({})]
  await installFakeStaff(page, world)
  let newer = false
  await page.route('**/version.json', (route) =>
    newer
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"app":"StaffApp-NEWER.js"}',
        })
      : route.continue(),
  )
  await page.goto('/#/')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByRole('list', { name: 'Enquiries' }).getByRole('link')).toHaveCount(1)
  let loads = 0
  page.on('load', () => (loads += 1))
  newer = true
  // Coming back to the app checks for a newer build.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => loads).toBeGreaterThan(0)
})

test('while someone is typing, a newer build waits behind a bar that cannot be dismissed', async ({
  page,
}) => {
  const world = staffWorld()
  world.tables.enquiries = [enquiry({})]
  world.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  await installFakeStaff(page, world)
  let newer = false
  await page.route('**/version.json', (route) =>
    newer
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"app":"StaffApp-NEWER.js"}',
        })
      : route.continue(),
  )
  await page.goto('/#/enquiries/e-1')
  await signIn(page, 'staff@example.com', 'another long password')
  await page
    .getByRole('region', { name: 'Change status' })
    .getByLabel('Note (optional)')
    .fill('Rang twice')
  let loads = 0
  page.on('load', () => (loads += 1))
  newer = true
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(bar(page)).toHaveText(/A new version of the staff console is ready\.\s*Reload/)
  await expect(bar(page).getByRole('button', { name: /close|dismiss/i })).toHaveCount(0)
  expect(loads).toBe(0)
  await expect(
    page.getByRole('region', { name: 'Change status' }).getByLabel('Note (optional)'),
  ).toHaveValue('Rang twice')
  // Moving to another screen picks up the new version.
  await page.getByRole('link', { name: 'All enquiries' }).click()
  await expect.poll(() => loads).toBeGreaterThan(0)
})

test('a screen that cannot read its data checks for a newer build, else says so with Reload', async ({
  page,
}) => {
  const world = staffWorld()
  world.tables.enquiries = [
    enquiry({ id: 'e-odd', reference: 'Q3-ODDD11', answers: 'not answers' }),
  ]
  await installFakeStaff(page, world)
  await page.goto('/#/enquiries/e-odd')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByText('Could not load this enquiry')).toBeVisible()
  await expect(bar(page)).toContainText('could not read this enquiry')
  await expect(bar(page).getByRole('button', { name: 'Reload' })).toBeVisible()
})
