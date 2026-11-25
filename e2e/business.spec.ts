import { expect, test, type Page } from '@playwright/test'
import { submitEnquiry } from './fake-backend'
import { installFakeStaff, PUBLIC_URL, signIn, STAFF_URL_LOCAL } from './fake-staff'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

test('business details reach the public pages, and stay available when the server is down', async ({
  page,
}) => {
  const world = await installFakeStaff(page)

  // Nothing set: the public pages claim nothing and the notice is a draft.
  await page.goto('/#/privacy')
  await expect(
    page.getByRole('heading', { name: 'How we use your details', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText('Draft', { exact: true })).toBeVisible()
  await expect(page.getByText(/to be added/)).toHaveCount(0)
  await expect(page.getByRole('contentinfo')).not.toContainText('Contact:')

  // An admin fills them in.
  await page.goto(`${STAFF_URL_LOCAL}/#/settings/business`)
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  // Saving with most boxes still empty works and says so.
  await page.getByLabel('Service area').fill('Dublin')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Saved. The website shows the new details now.')).toBeVisible()
  expect(world.business.service_area).toBe('Dublin')
  await page.getByLabel('Legal name').fill('Q3 Interiors Test Ltd')
  await page.getByLabel('Postal address').fill('1 Example Road, Dublin 7')
  await page.getByLabel('Contact phone').fill('call me')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Use digits, spaces and + ( ) - only.')).toBeVisible()
  await page.getByLabel('Contact phone').fill('01 555 0100')
  await page.getByLabel('Contact email').fill('hello@example.com')
  await page.getByLabel('Service area').fill('Dublin and north Kildare')
  await page.getByLabel('Privacy contact').fill('privacy@example.com')
  await shot(page, 'b1-business-details')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Saved. The website shows the new details now.')).toBeVisible()
  expect(world.business.contact_phone).toBe('01 555 0100')

  // The public pages show them.
  await page.goto(`${PUBLIC_URL}/#/`)
  const footer = page.getByRole('contentinfo')
  await expect(footer).toContainText('Contact: 01 555 0100 · hello@example.com')
  await expect(footer).toContainText('We work in Dublin and north Kildare.')
  await page.goto('/#/privacy')
  await expect(page.getByText('Q3 Interiors Test Ltd, trading as Q3 Interiors, is')).toBeVisible()
  await expect(page.getByText('Contact us at privacy@example.com')).toBeVisible()

  // The server goes away: the last copy this browser saw still gives the customer a way through.
  await page.route('**/rest/v1/rpc/**', (route) => route.abort('internetdisconnected'))
  await page.goto('/#/enquire')
  await page.reload()
  await submitEnquiry(page)
  const alert = page.getByRole('alert').filter({ hasText: 'could not reach our system' })
  await expect(alert).toContainText('You can also contact us on 01 555 0100 or hello@example.com.')
  await shot(page, 'b2-offline-contact')
})

test('staff cannot change business details', async ({ page }) => {
  await installFakeStaff(page)
  await page.goto(`${STAFF_URL_LOCAL}/#/settings/business`)
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
})
