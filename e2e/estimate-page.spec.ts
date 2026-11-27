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
    work_looked_at: 'Kitchen: strip out, new units, tiled floor.',
    caveats: 'This is an estimate, not a quote.',
    sent_at: new Date(sent).toISOString(),
    valid_until: new Date(sent + 10 * 86_400_000).toISOString(),
    quote_requested_at: null as string | null,
  }
  db.estimates.set(ESTIMATE, estimate)

  await page.goto(`/#/estimate/${TOKEN}/${ESTIMATE}`)
  await expect(page.getByRole('heading', { name: 'Get your quote' })).toBeVisible()
  await expect(page.getByText('€9,500 to €10,500, VAT included')).toBeVisible()
  await expect(page.getByText('The work we looked at: Kitchen: strip out')).toBeVisible()
  // A mail scanner opening the link only reads.
  expect(estimate.quote_requested_at).toBeNull()
  expect(bookingBodies.map((b) => b.action)).toEqual(['estimate'])
  await shot(page, 'customer-estimate-page')

  await page.getByRole('button', { name: 'Get my quote' }).click()
  await expect(page.getByRole('heading', { name: 'Thanks.' })).toBeVisible()
  await expect(
    page.getByText('We’ll send your quote: one price, with what’s included and what isn’t.'),
  ).toBeVisible()
  expect(estimate.quote_requested_at).not.toBeNull()
  expect(db.quoteAlerts).toEqual([ESTIMATE])
  await shot(page, 'customer-quote-thanks')

  // Coming back later: the thanks, not a second request.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Thanks.' })).toBeVisible()
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
