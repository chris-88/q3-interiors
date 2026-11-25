import { expect, test, type Page } from '@playwright/test'
import { installFakeStaff, signIn } from './fake-staff'

const fits = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
const shot = async (page: Page, name: string) => {
  await fits(page)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

test('an admin adds a person, who chooses a password from the emailed link', async ({ page }) => {
  const world = await installFakeStaff(page)
  await page.goto('/#/settings/people')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()

  // Validation first, then a real add.
  await page.getByRole('button', { name: 'Add and send the email' }).click()
  await expect(page.getByText('Enter their name.')).toBeVisible()
  await page.getByLabel('Name').fill('Pat Example')
  await page.getByLabel('Email', { exact: true }).fill('pat@example.com')
  await shot(page, 's1-add-person')
  await page.getByRole('button', { name: 'Add and send the email' }).click()
  await expect(page.getByText('Added Pat Example. We have emailed them a link')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Pat Example' })).toContainText('Staff')
  const pat = [...world.staff.values()].find((s) => s.email === 'pat@example.com')
  expect(pat?.role).toBe('staff')
  expect(world.queued).toEqual([{ userId: pat?.user_id, template: 'staff_invite' }])

  // Pat opens the link (in a fresh session).
  await page.evaluate(() => window.localStorage.clear())
  await page.goto(`/#/set-password?token_hash=hash-${pat?.user_id}&type=recovery&welcome=1`)
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible()
  // The single-use token is no longer in the address bar.
  expect(page.url()).not.toContain('token_hash')
  await page.getByLabel('New password').fill('too short')
  await page.getByLabel('Type it again').fill('too short')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByText('Use at least 12 characters.')).toBeVisible()
  await expect(page.getByLabel('New password')).toHaveAttribute('aria-invalid', 'true')
  await page.getByLabel('New password').fill('blue kettle on the stairs')
  await page.getByLabel('Type it again').fill('blue kettle on the stairs')
  await shot(page, 's2-set-password')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('heading', { name: 'Password saved' })).toBeVisible()
  expect(world.passwords.get(pat?.user_id ?? '')).toBe('blue kettle on the stairs')
  await page.getByRole('link', { name: 'Go to enquiries' }).click()
  await expect(page.getByRole('heading', { name: 'Enquiries' })).toBeVisible()

  // The same link again (a new page load, as from the email): used up.
  await page.goto('about:blank')
  await page.goto(`/#/set-password?token_hash=hash-${pat?.user_id}&type=recovery`)
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible()
  await shot(page, 's3-link-used')
})

test('forgot password answers the same for anyone', async ({ page }) => {
  const world = await installFakeStaff(page)
  await page.goto('/#/')
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  await page.getByLabel('Email').fill('nobody@example.com')
  await page.getByRole('button', { name: 'Send me a link' }).click()
  await expect(page.getByText('If that address belongs to a staff account')).toBeVisible()
  expect(world.queued).toHaveLength(0)
  await page.getByRole('link', { name: 'Back to sign in' }).click()
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  await page.getByLabel('Email').fill('staff@example.com')
  await page.getByRole('button', { name: 'Send me a link' }).click()
  await expect(page.getByText('If that address belongs to a staff account')).toBeVisible()
  await shot(page, 's4-forgot')
  expect(world.queued).toEqual([{ userId: 'u-staff', template: 'staff_password_reset' }])
})

test('an admin hands bookings to someone, is warned about the calendar, and can switch people off', async ({
  page,
}) => {
  const world = await installFakeStaff(page)
  world.tables.calendar_connections = [
    { staff_user_id: 'u-admin', status: 'connected', google_email: 'admin@example.com' },
  ]
  await page.goto('/#/settings/people')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')
  await page.getByRole('radio', { name: /Sam Staff/ }).check()
  await expect(page.getByText('Sam Staff has not connected a Google Calendar')).toBeVisible()
  await shot(page, 's5-who-takes-bookings')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved. New bookings go to Sam Staff.')).toBeVisible()
  expect(world.bookable.id).toBe('u-staff')

  // The person who takes bookings cannot be switched off.
  const sam = page.getByRole('listitem').filter({ hasText: 'Sam Staff' })
  await sam.getByRole('button', { name: 'Switch off…' }).click()
  await sam.getByRole('button', { name: 'Yes, switch off' }).click()
  await expect(sam.getByRole('alert')).toContainText('Choose someone else to take bookings first')
  expect(world.staff.get('u-staff')?.active).toBe(true)
})

test('staff cannot open admin screens, and a switched-off account is told so', async ({ page }) => {
  const world = await installFakeStaff(page)
  await page.goto('/#/settings/people')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
  await page.goto('/#/settings')
  await expect(page.getByRole('navigation', { name: 'Set-up (admins)' })).toHaveCount(0)

  world.staff.get('u-staff')!.active = false
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your account is switched off' })).toBeVisible()
})
