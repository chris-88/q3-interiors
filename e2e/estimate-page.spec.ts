import { expect, test, type Page } from '@playwright/test'
import { installFakeBackend } from './fake-backend'

/*
 * The estimate email's "Get my quote" page. Fake backend (the real public-booking logic over
 * in-memory stores); nothing reaches the stack. SCREENSHOTS_DIR keeps the screenshots.
 */

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const TOKEN = 'estimate-token-0123456789abcdef'
const ESTIMATE = '00000000-0000-4000-8000-0000000e0001'

test('opening the link records nothing; the button asks for the quote once', async ({ page }) => {
  const { db, bookingBodies } = await installFakeBackend(page)
  const enquiryId = db.addEnquiry(
    { name: 'Mary Byrne', email: 'mary@example.com', phone: '087 123 4567' },
    TOKEN,
  )
  const sent = Date.now() - 86_400_000
  const estimate = {
    id: ESTIMATE,
    enquiry_id: enquiryId,
    low_eur: 9500,
    high_eur: 10500,
    work_items: ['Strip out the old kitchen', 'New units and worktop'],
    work_looked_at: 'Keep the window.',
    caveats: 'This is an estimate, not a quote.',
    sent_at: new Date(sent).toISOString(),
    valid_until: new Date(sent + 10 * 86_400_000).toISOString(),
    quote_requested_at: null as string | null,
  }
  db.estimates.set(ESTIMATE, estimate)
  db.settings.business_phone = '01 555 0100'

  await page.goto(`/#/estimate/${TOKEN}/${ESTIMATE}`)
  await expect(page.getByRole('heading', { name: 'Happy with your estimate?' })).toBeVisible()
  await expect(page.getByText('€9,500 to €10,500, VAT included')).toBeVisible()
  await expect(page.getByText('The work we looked at:')).toBeVisible()
  await expect(page.getByRole('list').first().getByRole('listitem')).toHaveText([
    'Strip out the old kitchen',
    'New units and worktop',
  ])
  await expect(page.getByText('If you’re happy with it, ask us for your quote.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What a quote is' })).toBeVisible()
  await expect(
    page.getByText('One price for the work, in writing. It lists what’s included and what isn’t.'),
  ).toBeVisible()
  const steps = [
    'We send your quote by email within 3 working days, with a PDF copy.',
    'If you want anything changed or added, tell us and we update the quote.',
    'A 10% deposit books your start date.',
    'We confirm your start date once the deposit is in.',
  ]
  await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible()
  await expect(page.getByRole('list').nth(1).getByRole('listitem')).toHaveText(steps)
  await expect(
    page.getByText('You don’t commit to anything until you accept the quote and pay the deposit.'),
  ).toBeVisible()
  await expect(page.getByText('Keep the window.')).toBeVisible()
  // A mail scanner opening the link only reads.
  expect(estimate.quote_requested_at).toBeNull()
  expect(bookingBodies.map((b) => b.action)).toEqual(['estimate'])
  await shot(page, 'customer-estimate-page')

  await page.getByRole('button', { name: 'Get my quote' }).click()
  await expect(
    page.getByRole('heading', { name: 'Thanks. We’re preparing your quote.' }),
  ).toBeVisible()
  await expect(page.getByText('You’ll have your quote within 3 working days.')).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveText(steps)
  await expect(page.getByRole('link', { name: '01 555 0100' })).toHaveAttribute(
    'href',
    'tel:015550100',
  )
  expect(estimate.quote_requested_at).not.toBeNull()
  expect(db.quoteAlerts).toEqual([ESTIMATE])
  await shot(page, 'customer-quote-thanks')

  // Coming back later: the thanks, not a second request.
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Thanks. We’re preparing your quote.' }),
  ).toBeVisible()
  expect(db.quoteAlerts).toEqual([ESTIMATE])
  expect(bookingBodies.filter((b) => b.action === 'request_quote')).toHaveLength(1)
})

test('a link for someone else’s estimate, or an expired token, says the link has expired', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  db.addEnquiry({ name: 'Mary Byrne', email: 'mary@example.com' }, TOKEN)
  await page.goto(`/#/estimate/${TOKEN}/${ESTIMATE}`)
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
  await page.goto(`/#/estimate/not-a-real-token-0000000000/${ESTIMATE}`)
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
})

test('the timing line is staff wording: left out when emptied', async ({ page }) => {
  const { db } = await installFakeBackend(page)
  const enquiryId = db.addEnquiry({ name: 'Mary Byrne', email: 'mary@example.com' }, TOKEN)
  const sent = Date.now() - 86_400_000
  db.estimates.set(ESTIMATE, {
    id: ESTIMATE,
    enquiry_id: enquiryId,
    low_eur: 9500,
    high_eur: 10500,
    work_items: ['Tiled floor'],
    work_looked_at: null,
    caveats: 'This is an estimate, not a quote.',
    sent_at: new Date(sent).toISOString(),
    valid_until: new Date(sent + 10 * 86_400_000).toISOString(),
    quote_requested_at: new Date().toISOString(),
  })
  db.wording = { quote_timing: '', quote_page_steps: 'We ring you.\nWe send the quote.' }
  await page.goto(`/#/estimate/${TOKEN}/${ESTIMATE}`)
  await expect(
    page.getByRole('heading', { name: 'Thanks. We’re preparing your quote.' }),
  ).toBeVisible()
  await expect(page.getByText(/within 3 working days/)).toHaveCount(0)
  await expect(page.getByRole('listitem')).toHaveText(['We ring you.', 'We send the quote.'])
})
