import { expect, test, type Page } from '@playwright/test'
import { publishedForms } from '../src/forms/published.ts'
import { installFakeStaff, signIn, staffWorld } from './fake-staff'

/*
 * Slice 7: outcomes after the appointment. Fake backend; SCREENSHOTS_DIR keeps phone-width and
 * desktop screenshots of the enquiry, the filtered list and the report.
 */

const shot = async (page: Page, name: string) => {
  const width = page.viewportSize()?.width ?? 390
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const enquiry = (id: string, reference: string, over: Record<string, unknown> = {}) => ({
  id,
  reference,
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
    name: 'Sample Customer',
    email: 'outcome@example.com',
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
  quote_amount: null,
  quote_date: null,
  won_date: null,
  enquiry_attribution: null,
  enquiry_events: [],
  bookings: [
    { starts_at: '2026-11-20T10:00:00Z', confirmed_at: '2026-11-18T10:05:00Z', state: 'confirmed' },
  ],
  ...over,
})

function world() {
  const w = staffWorld()
  w.tables.enquiries = [
    enquiry('e-visit', 'Q3-VISIT1'),
    enquiry('e-new', 'Q3-NEWWW2', { bookings: [] }),
    enquiry('e-lost', 'Q3-LOSTT3', {
      outcome: 'lost',
      outcome_reason: 'price',
      outcome_at: '2026-11-22T10:00:00Z',
    }),
  ]
  w.tables.form_versions = publishedForms.map((f) => ({
    form_id: f.formId,
    version: f.version,
    schema: f,
  }))
  return w
}

test('staff record a quote, then the win, then correct it; the list filters by outcome', async ({
  page,
}) => {
  const w = world()
  await installFakeStaff(page, w)
  await page.goto('/#/')
  await signIn(page, 'staff@example.com', 'another long password')

  // Grouped by whose move it is: lost ones are under Finished; the visit just over is Q3's move.
  const list = page.getByRole('region', { name: 'Enquiries' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  const yours = page.getByRole('region', { name: /^Your move/ })
  await expect(yours.getByRole('listitem')).toHaveCount(1)
  await expect(yours).toContainText('How did it go?')
  await shot(page, 'list-filter-awaiting-390')
  await yours.getByRole('link').first().click()

  // Record the quote from the Next step card (the Outcome section moved there). Once won, the
  // same card is titled Result (review F7).
  const outcome = page.getByRole('region', { name: /^(Next step|Result)$/ })
  // After the visit the next step is the estimate; a quote is one tap away (review F3).
  await expect(outcome).toContainText('No estimate sent yet')
  await expect(outcome.getByRole('button', { name: 'Mark won' })).toHaveCount(0)
  await outcome.getByRole('button', { name: 'Record a quote or result' }).click()
  await outcome.getByRole('button', { name: 'Record quote' }).click()
  await outcome.getByLabel('Quote amount (€, incl. VAT)').fill('lots')
  await outcome.getByRole('button', { name: 'Save quote' }).click()
  await expect(outcome.getByRole('alert')).toHaveText(
    'Enter the amount in euro, for example 18,450.',
  )
  await expect(outcome.getByLabel('Quote amount (€, incl. VAT)')).toBeFocused()
  await outcome.getByLabel('Quote amount (€, incl. VAT)').fill('18,450.50')
  await outcome.getByLabel('Date quoted').fill('2026-11-21')
  await outcome.getByRole('button', { name: 'Save quote' }).click()
  await expect(outcome).toContainText('Quoted €18,450.50 on 21 Nov 2026')
  await outcome.scrollIntoViewIfNeeded()
  await shot(page, 'enquiry-quoted-390')

  // Mark won: the amount starts from the quote.
  await outcome.getByRole('button', { name: 'Mark won' }).click()
  await expect(outcome.getByLabel('Agreed value (€, incl. VAT)')).toHaveValue('18450.5')
  await outcome.getByLabel('Agreed value (€, incl. VAT)').fill('17900')
  await outcome.getByLabel('Date won').fill('2026-11-24')
  await outcome.getByRole('button', { name: 'Save as won' }).click()
  await expect(outcome).toContainText('Won €17,900.00 on 24 Nov 2026')
  await expect(outcome).toContainText('Quoted €18,450.50 on 21 Nov 2026')

  // Correct the win.
  await outcome.getByRole('button', { name: 'Edit win' }).click()
  await outcome.getByLabel('Agreed value (€, incl. VAT)').fill('18000')
  await outcome.getByRole('button', { name: 'Save as won' }).click()
  await expect(outcome).toContainText('Won €18,000.00 on 24 Nov 2026')
  await page.getByText('More', { exact: true }).click()
  const history = page.getByRole('region', { name: 'History' })
  await expect(history.getByText(/^Won €18,000\.00 on 2026-11-24 \(was won\)$/)).toBeVisible()
  await expect(history.getByText(/^Quoted €18,450\.50 on 2026-11-21$/)).toBeVisible()
  await outcome.scrollIntoViewIfNeeded()
  await shot(page, 'enquiry-won-390')

  // Mark another lost: a reason is required, "other" needs a note.
  await page.goto('/#/enquiries/e-new')
  // Contacted, nothing booked: the outcome is one tap away on the Next step card.
  const other = page.getByRole('region', { name: /^(Next step|Result)$/ })
  await other.getByRole('button', { name: 'Record a quote or result' }).click()
  await other.getByRole('button', { name: 'Mark lost' }).click()
  await other.getByRole('button', { name: 'Save as lost' }).click()
  await expect(other.getByRole('alert')).toHaveText('Choose a reason.')
  await other.getByRole('radio', { name: 'Other' }).check()
  await other.getByRole('button', { name: 'Save as lost' }).click()
  await expect(other.getByRole('alert')).toHaveText('Say why it was lost.')
  await other.getByRole('radio', { name: 'Went elsewhere' }).check()
  await other.getByRole('button', { name: 'Save as lost' }).click()
  await expect(other).toContainText('Lost: Went elsewhere')

  // The list by outcome.
  await page.goto('/#/')
  await page.getByRole('link', { name: /^Finished/ }).click()
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await expect(list.getByRole('listitem').filter({ hasText: 'Won €18,000' })).toHaveCount(1)
  await expect(list.getByRole('listitem').filter({ hasText: /Lost/ })).toHaveCount(2)

  expect(
    w.rpcCalls
      .filter((c) => c.name === 'record_enquiry_outcome')
      .map((c) => (c.body as { p_stage: string }).p_stage),
  ).toEqual(['quoted', 'won', 'won', 'lost'])

  // Desktop width.
  await page.setViewportSize({ width: 1280, height: 900 })
  await shot(page, 'list-finished-desktop')
  await page.goto('/#/enquiries/e-visit')
  await expect(page.getByRole('region', { name: 'Result' })).toContainText('Won €18,000.00')
  await shot(page, 'enquiry-won-desktop')
})

test('the report shows quoted, won and won value beside saved and booked', async ({ page }) => {
  const w = world()
  const row = (dim: string, key: string, over: Record<string, unknown> = {}) => ({
    dim,
    key,
    sessions: 120,
    chose: 80,
    saved: 20,
    booked: 12,
    attended: 10,
    suitable_attended: 9,
    chased: 1,
    quoted: 7,
    won: 3,
    won_value: 54500,
    median_to_saved_seconds: 240,
    median_to_booked_seconds: 600,
    ...over,
  })
  w.pilot = {
    counted_from: '2026-11-25T12:00:00Z',
    rows: [
      row('all', 'all'),
      row('version', '2'),
      row('route', 'on_site', { quoted: 5, won: 2, won_value: 41000 }),
      row('route', 'phone', { quoted: 2, won: 1, won_value: 13500 }),
    ],
    headline: { instagram_sessions: 100, instagram_suitable_attended: 8 },
  }
  await installFakeStaff(page, w)
  await page.goto('/#/report')
  await signIn(page, 'staff@example.com', 'another long password')
  const pilot = page.getByRole('region', { name: 'Pilot measures' })
  const all = pilot.getByRole('region', { name: 'All', exact: true })
  await expect(all.getByRole('row', { name: /^Quoted/ })).toContainText('7')
  await expect(all.getByRole('row', { name: /^Won/ })).toContainText('3')
  await expect(all).toContainText('€54,500.00')
  await expect(pilot.getByRole('region', { name: 'Site visit' })).toContainText('€41,000.00')
  await pilot.scrollIntoViewIfNeeded()
  await shot(page, 'report-390')
  await page.setViewportSize({ width: 1280, height: 900 })
  await shot(page, 'report-desktop')
})

test('a campaign opens to one card per ad, with untagged and folded rows', async ({ page }) => {
  const w = world()
  const row = (dim: string, key: string, over: Record<string, unknown> = {}) => ({
    dim,
    key,
    sessions: 60,
    chose: 30,
    saved: 9,
    booked: 5,
    attended: 4,
    suitable_attended: 4,
    chased: 0,
    quoted: 3,
    won: 1,
    won_value: 14000,
    median_to_saved_seconds: 300,
    median_to_booked_seconds: 900,
    ...over,
  })
  w.pilot = {
    counted_from: '2026-11-25T12:00:00Z',
    rows: [row('all', 'all'), row('campaign', 'type-test-1')],
    headline: { instagram_sessions: 60, instagram_suitable_attended: 4 },
  }
  const none = { quoted: 0, won: 0, won_value: 0 }
  w.pilotByContent['type-test-1'] = {
    campaign: 'type-test-1',
    cap: 25,
    rows: [
      row('content', 'kitchen-calls', { sessions: 30, saved: 6, booked: 3, quoted: 2, won: 1 }),
      row('content', 'price-first', { sessions: 20, saved: 2, booked: 1, ...none, quoted: 1 }),
      row('content', '(none)', { sessions: 6, saved: 1, booked: 1, ...none }),
      row('content', '(other)', { sessions: 4, saved: 0, booked: 0, ...none }),
    ],
  }
  await installFakeStaff(page, w)
  await page.goto('/#/report')
  await signIn(page, 'staff@example.com', 'another long password')
  const campaign = page.getByRole('region', { name: 'type-test-1' })
  const show = campaign.getByRole('button', { name: 'Show each ad' })
  await expect(show).toHaveAttribute('aria-expanded', 'false')
  await show.click()
  const kitchen = campaign.getByRole('region', { name: 'kitchen-calls' })
  await expect(kitchen.getByRole('row', { name: /^Landing sessions/ })).toContainText('30')
  await expect(kitchen.getByRole('row', { name: /^Saved enquiries/ })).toContainText('20.0')
  await expect(kitchen).toContainText('€14,000.00')
  await expect(campaign.getByRole('region', { name: 'No ad tag (utm_content)' })).toBeVisible()
  await expect(
    campaign.getByRole('region', { name: 'Other ads (smaller ones, together)' }),
  ).toBeVisible()
  expect(w.rpcCalls.filter((c) => c.name === 'pilot_report_by_content').map((c) => c.body)).toEqual(
    [expect.objectContaining({ p_campaign: 'type-test-1' })],
  )
  await campaign.scrollIntoViewIfNeeded()
  await shot(page, 'report-by-ad-390')
})
