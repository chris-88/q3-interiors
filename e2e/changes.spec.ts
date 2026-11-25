import { expect, test, type Page } from '@playwright/test'
import { installFakeBackend, submitEnquiry } from './fake-backend'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

async function bookPhone(page: Page) {
  await submitEnquiry(page)
  await page.getByRole('group', { name: 'Suggested times' }).getByRole('button').first().click()
  await page.getByRole('button', { name: /^Book call · / }).click()
  await expect(page.getByRole('heading', { name: 'Your call is booked' })).toBeVisible()
}

test('a customer moves their appointment, then cancels it', async ({ page }) => {
  const { db, calendar } = await installFakeBackend(page)
  await bookPhone(page)
  const booking = db.bookings[0]!
  const eventId = booking.calendar_event_id
  const firstStart = booking.starts_at

  // Move to a time on another day.
  await page.getByRole('button', { name: 'Change time' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a new time' })).toBeVisible()
  await page.getByRole('group', { name: 'Day' }).getByRole('button').nth(1).click()
  await page
    .getByRole('group', { name: /^Time on/ })
    .getByRole('button')
    .nth(2)
    .click()
  await shot(page, 'c1-move-picker')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Move your appointment?' })).toBeVisible()
  await shot(page, 'c2-move-confirm')
  await page.getByRole('button', { name: 'Move to this time' }).click()
  await expect(page.getByText('Your appointment has moved')).toBeVisible()
  await shot(page, 'c3-moved')

  expect(db.bookings).toHaveLength(1)
  expect(db.bookings[0]!.id).toBe(booking.id)
  expect(db.bookings[0]!.starts_at).not.toBe(firstStart)
  expect(calendar.events.size).toBe(1)
  expect(calendar.events.get(eventId)?.start).toBe(db.bookings[0]!.starts_at)

  // Cancel.
  await page.getByRole('button', { name: 'Cancel appointment' }).click()
  await expect(page.getByRole('heading', { name: 'Cancel your appointment?' })).toBeVisible()
  await page.getByLabel('Reason (optional)').fill('Plans changed')
  await shot(page, 'c4-cancel-confirm')
  await page.getByRole('button', { name: 'Yes, cancel it' }).click()
  await expect(page.getByText('Your appointment is cancelled')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Choose a time for your call' })).toBeVisible()
  await shot(page, 'c5-cancelled')
  expect(db.bookings[0]!.state).toBe('cancelled')
  expect(calendar.events.get(eventId)?.status).toBe('cancelled')
  // Confirmation, move and cancellation notices; test@example.com is never actually sent to.
  expect(db.comms.map((c) => c.template).sort()).toEqual([
    'booking_cancelled',
    'booking_confirmation',
    'booking_reminder',
    'booking_reminder',
    'booking_rescheduled',
  ])
  expect(
    db.comms.filter((c) => c.template === 'booking_reminder').every((c) => c.state === 'skipped'),
  ).toBe(true)
})

test('inside the cut-off the customer is asked to ring', async ({ page }) => {
  const { db, clock } = await installFakeBackend(page)
  await bookPhone(page)
  db.settings = { ...db.settings, business_phone: '01 555 0100' }
  clock.offset = Date.parse(db.bookings[0]!.starts_at) - Date.now() - 60 * 60_000
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your call is booked' })).toBeVisible()
  await expect(
    page.getByText('It is too close to your appointment to change it online.'),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: '01 555 0100' })).toHaveAttribute(
    'href',
    'tel:015550100',
  )
  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toHaveCount(0)
  await shot(page, 'c6-ring-us')
})

test('the email links open change time and cancel directly', async ({ page }) => {
  const { db } = await installFakeBackend(page)
  await bookPhone(page)
  const url = page.url()
  await page.goto(`${url}?do=cancel`)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Cancel your appointment?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep my appointment' }).click()
  await expect(page.getByRole('heading', { name: 'Your call is booked' })).toBeVisible()
  await page.goto(`${url}?do=change`)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Choose a new time' })).toBeVisible()
  expect(db.bookings[0]?.state).toBe('confirmed')
})
