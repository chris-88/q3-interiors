import { expect, test, type Page } from '@playwright/test'
import { STAFF_ID } from '../supabase/functions/_shared/testing/fakes.ts'
import { installFakeBackend } from './fake-backend'

/*
 * "Book your site visit", the link emailed after a call: it opens on the site visit times (not on
 * the call that already happened) and books one. Fake backend (the real public-booking logic over
 * in-memory stores). SCREENSHOTS_DIR keeps the screenshots.
 */

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const TOKEN = 'visit-link-token-0123456789abcdef'

test('after an attended call, the link opens on the site visit times and books one', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  const id = db.addEnquiry(
    {
      appointment_preference: 'phone',
      project_type: 'kitchen',
      location: 'D07 X2Y3',
      name: 'Mary Byrne',
      email: 'mary@example.com',
      phone: '087 123 4567',
    },
    TOKEN,
  )
  // The call two days ago, marked attended by staff.
  const start = Date.now() - 2 * 86_400_000
  db.bookings.push({
    id: 'b0000000-0000-4000-8000-00000000c411',
    enquiry_id: id,
    staff_user_id: STAFF_ID,
    appointment_type_id: 'phone_consultation',
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + 20 * 60_000).toISOString(),
    state: 'confirmed',
    calendar_event_id: 'q3call',
    idempotency_key: '00000000-0000-4000-8000-00000000c411',
    created_at: new Date(start - 86_400_000).toISOString(),
    confirmed_at: new Date(start - 86_400_000).toISOString(),
    attendance: 'attended',
    blocked: { start, end: start + 30 * 60_000 },
    failure_reason: null,
    link: null,
  })

  await page.goto(`/#/book/${TOKEN}?visit=1`)
  await expect(
    page.getByRole('heading', { name: 'Choose a time for your site visit' }),
  ).toBeVisible()
  await expect(page.getByText(/cancelled/i)).toHaveCount(0)
  await shot(page, 'visit-link-time-step')
  await page.getByRole('group', { name: 'Suggested times' }).getByRole('button').first().click()
  // A call enquiry has no address yet: the time step asks for it, as for any site visit.
  await page.getByRole('textbox').first().fill('12 Example Road')
  await page.getByRole('button', { name: /^Book site visit · / }).click()
  await expect(page.getByRole('heading', { name: 'Your site visit is booked' })).toBeVisible()
  const visit = db.bookings.find((b) => b.appointment_type_id === 'site_visit')
  expect(visit?.enquiry_id).toBe(id)
})
