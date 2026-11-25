import { expect, test } from '@playwright/test'
import { installFakeStaff, PUBLIC_URL } from './fake-staff'

test('the staff console opens at its own root, signed out', async ({ page }) => {
  await installFakeStaff(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
  await expect(page).toHaveTitle('Q3 Interiors Staff')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  // No customer journey in this build.
  await page.goto('/#/enquire')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('old /staff paths on the staff console drop the prefix and keep the query', async ({
  page,
}) => {
  await installFakeStaff(page)
  await page.goto('/#/staff/forgot')
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/forgot')
  await page.goto('/#/staff/set-password?token_hash=nope&type=recovery')
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible()
})

test('staff URLs on the customer site go to the staff site, query intact', async ({ page }) => {
  // The real staff host is not reachable from the test; capture where the browser is sent.
  const sent: string[] = []
  await page.route('https://staff.q3interiors.ie/**', async (route) => {
    sent.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>staff host</p>' })
  })
  await page.goto(`${PUBLIC_URL}/#/staff/set-password?token_hash=abc&type=recovery&welcome=1`)
  await expect(page.getByText('staff host')).toBeVisible()
  expect(page.url()).toBe(
    'https://staff.q3interiors.ie/#/set-password?token_hash=abc&type=recovery&welcome=1',
  )
  await page.goto(`${PUBLIC_URL}/#/staff`)
  await expect(page.getByText('staff host')).toBeVisible()
  expect(page.url()).toBe('https://staff.q3interiors.ie/#/')
  expect(sent.length).toBeGreaterThanOrEqual(2)
})
