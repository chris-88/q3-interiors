import { expect, test, type Page } from '@playwright/test'
import { installFakeStaff, signIn } from './fake-staff'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

test('the go-live checklist shows what is left and takes the admin ticks', async ({ page }) => {
  const world = await installFakeStaff(page)
  world.tables.calendar_connections = [
    { staff_user_id: 'u-admin', status: 'connected', google_email: 'test-account@example.com' },
  ]
  await page.goto('/#/staff/settings')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  await page.getByRole('link', { name: /Go-live checklist/ }).click()
  await expect(page.getByRole('heading', { name: 'Go-live checklist' })).toBeVisible()
  await expect(page.getByText('11 of 12 still to do.')).toBeVisible()
  const item = (title: string) => page.getByRole('listitem').filter({ hasText: title })
  await expect(item('Business details are complete')).toContainText(
    'Still to fill in: legal name, postal address, contact phone, contact email, service area and privacy contact.',
  )
  await expect(
    item('Business details are complete').getByRole('link', { name: 'Business details' }),
  ).toHaveAttribute('href', '#/staff/settings/business')
  await expect(item('Someone takes bookings')).toContainText('Done: ')
  await expect(item('The enquiry form has Q3’s real options')).toContainText('still version 1')

  // The test account is marked; it stays amber while bookings use it.
  await item('Bookings no longer use the test Google account')
    .getByRole('button', { name: 'This is the test account' })
    .click()
  await expect(item('Bookings no longer use the test Google account')).toContainText(
    'Bookings still go to the test account (test-account@example.com).',
  )

  // A manual tick.
  await item('Checked on a phone').getByRole('button', { name: 'Tick: done' }).click()
  await expect(item('Checked on a phone')).toContainText('Ticked by Chris Admin')
  await expect(page.getByText('10 of 12 still to do.')).toBeVisible()

  // The privacy review needs the legal details first; then it removes "Draft" from the notice.
  const privacy = item('The privacy notice is reviewed')
  await expect(privacy.getByRole('button', { name: 'Mark reviewed' })).toBeDisabled()
  Object.assign(world.business, {
    legal_name: 'Q3 Interiors Test Ltd',
    postal_address: '1 Example Road, Dublin 7',
    privacy_contact: 'privacy@example.com',
  })
  await page.reload()
  await privacy.getByRole('button', { name: 'Mark reviewed' }).click()
  await expect(privacy).toContainText('Done:')
  await shot(page, 'k1-checklist')
  await page.goto('/#/privacy')
  await expect(
    page.getByRole('heading', { name: 'How we use your details', level: 1 }),
  ).toBeVisible()
  await expect(page.getByText('Draft', { exact: true })).toHaveCount(0)
})

test('staff cannot see the checklist', async ({ page }) => {
  await installFakeStaff(page)
  await page.goto('/#/staff/settings/checklist')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
})
