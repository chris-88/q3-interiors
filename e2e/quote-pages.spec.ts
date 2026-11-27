import { expect, test, type Page } from '@playwright/test'
import { installFakeBackend } from './fake-backend'

/*
 * The quote email's three pages: View my quote (the document and the PDF), Pay my deposit (a
 * holding page) and Ask for a change. Fake backend (the real public-booking logic over in-memory
 * stores). Opening any of them records nothing. SCREENSHOTS_DIR keeps the screenshots.
 */

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const TOKEN = 'quote-token-0123456789abcdefghij'
const QUOTE = '00000000-0000-4000-8000-0000000a0001'

async function setup(page: Page) {
  const backend = await installFakeBackend(page)
  const { db, quoteFiles } = backend
  db.settings.business_phone = '01 555 0100'
  const enquiryId = db.addEnquiry(
    {
      project_type: 'kitchen',
      location: 'Dublin 8',
      name: 'Mary Byrne',
      email: 'mary@example.com',
      phone: '087 123 4567',
    },
    TOKEN,
    { siteDetails: { site_address: '12 Example Road, Dublin 8' } },
  )
  const path = `${enquiryId}/${QUOTE}.pdf`
  quoteFiles.set(path, new TextEncoder().encode('%PDF-1.7 sample'))
  db.quotes.set(QUOTE, {
    id: QUOTE,
    enquiry_id: enquiryId,
    number: 'Q3-Q-0001',
    version: 1,
    price_eur: 10200,
    included: ['Strip out the old kitchen', 'New units and worktop', 'Tiled floor'],
    excluded: ['Appliances'],
    note: 'The window stays.',
    deposit_percent: 10,
    deposit_eur: 1020,
    valid_until: '2026-12-18',
    terms: 'This quote is one price for the work listed. It’s good until Fri 18 Dec 2026.',
    sent_at: '2026-11-27T10:00:00Z',
    pdf_path: path,
    change_requested_at: null,
  })
  return backend
}

test('View my quote: the document, the PDF, and the two next steps; nothing recorded', async ({
  page,
}) => {
  const { db, bookingBodies } = await setup(page)
  await page.goto(`/#/quote/${TOKEN}/${QUOTE}`)
  await expect(page.getByRole('heading', { name: 'Your quote Q3-Q-0001' })).toBeVisible()
  await expect(page.getByText('€10,200, VAT included')).toBeVisible()
  await expect(page.getByText('Good until Fri 18 Dec 2026')).toBeVisible()
  const doc = page.frameLocator('iframe[title="Quote Q3-Q-0001"]')
  await expect(doc.getByText('Tiled floor')).toBeVisible()
  await expect(doc.getByText('The window stays.')).toBeVisible()
  await shot(page, 'customer-quote')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download the PDF' }).click()
  expect((await download).suggestedFilename()).toBe('Q3-Q-0001.pdf')
  expect(bookingBodies.map((b) => b.action)).toEqual(['quote', 'quote_pdf'])
  expect(db.quoteChanges).toHaveLength(0)
  await expect(page.getByRole('link', { name: 'Pay my deposit' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ask for a change' })).toBeVisible()
})

test('Pay my deposit: a holding page with the amount and how to pay; records nothing', async ({
  page,
}) => {
  const { db, bookingBodies } = await setup(page)
  await page.goto(`/#/quote/${TOKEN}/${QUOTE}`)
  await page.getByRole('link', { name: 'Pay my deposit' }).click()
  await expect(page.getByRole('heading', { name: 'Paying online is coming soon.' })).toBeVisible()
  await expect(page.getByText('Your deposit is €1,020, which is 10% of your quote.')).toBeVisible()
  await expect(page.getByRole('link', { name: '01 555 0100' })).toHaveAttribute(
    'href',
    'tel:015550100',
  )
  await expect(
    page.getByText(/or reply to your quote email and we’ll sort it with you\./),
  ).toBeVisible()
  await expect(page.getByText('We confirm your start date once the deposit is in.')).toBeVisible()
  await shot(page, 'customer-quote-deposit')
  expect(bookingBodies.every((b) => b.action === 'quote')).toBe(true)
  expect(db.quotes.get(QUOTE)?.change_requested_at).toBeNull()
})

test('Ask for a change: only the Send button records it', async ({ page }) => {
  const { db, bookingBodies } = await setup(page)
  await page.goto(`/#/quote/${TOKEN}/${QUOTE}/change`)
  await expect(page.getByRole('heading', { name: 'Ask for a change' })).toBeVisible()
  expect(db.quoteChanges).toHaveLength(0)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(
    page.getByText('Tell us what you’d like changed or added.', { exact: true }),
  ).toBeVisible()
  await page
    .getByLabel('Tell us what you’d like changed or added')
    .fill('Can you add the utility room floor?')
  await shot(page, 'customer-quote-change')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(
    page.getByRole('heading', {
      name: 'Thanks. We’ll ring you about it and send an updated quote.',
    }),
  ).toBeVisible()
  expect(db.quoteChanges).toEqual([{ quoteId: QUOTE, text: 'Can you add the utility room floor?' }])
  expect(bookingBodies.filter((b) => b.action === 'quote_change')).toHaveLength(1)
  await shot(page, 'customer-quote-change-thanks')
})

test('another enquiry’s quote, or an old link, says the link has expired', async ({ page }) => {
  const { db } = await setup(page)
  db.addEnquiry({ name: 'Other', email: 'o@example.com' }, 'other-token-0123456789abcdefgh')
  await page.goto(`/#/quote/other-token-0123456789abcdefgh/${QUOTE}`)
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
})
