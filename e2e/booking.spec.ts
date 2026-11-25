import { expect, test, type Page } from '@playwright/test'
import { renderMessage } from '../supabase/functions/_shared/messages.ts'
import { handlePublic } from '../supabase/functions/_shared/public-booking.ts'
import { installFakeBackend, submitEnquiry } from './fake-backend'

// Set SCREENSHOTS_DIR to keep 390px screenshots of each step.
const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const suggestions = (page: Page) =>
  page.getByRole('group', { name: 'Suggested times' }).getByRole('button')

test('someone else takes the slot: the customer is told and books another time', async ({
  page,
}) => {
  const { db, calendar } = await installFakeBackend(page)
  await submitEnquiry(page)
  await expect(page.getByRole('heading', { name: 'Choose a time for your call' })).toBeVisible()
  await suggestions(page).first().click()
  const firstLabel = (await suggestions(page).first().textContent())?.trim()

  // Another customer books the same time first.
  const ours = [...db.enquiries.keys()][0] ?? ''
  const other = db.addEnquiry(
    { name: 'Other', email: 'o@example.com', phone: '0870000000' },
    'tok-other-customer-0000000000',
  )
  const res = await handlePublic(
    {
      action: 'availability',
      token: 'tok-other-customer-0000000000',
      typeId: 'phone_consultation',
    },
    {
      db,
      calendar,
      accessToken: async () => 't',
      mailer: null,
      appUrl: 'x',
      now: () => Date.now(),
    },
  )
  const taken = (res.body as { slots: { start: string }[] }).slots[0]?.start ?? ''
  expect(
    (await db.reserve(other, 'phone_consultation', taken, '00000000-0000-4000-8000-0000000000ff'))
      .status,
  ).toBe('reserved')

  await page.getByRole('button', { name: /^Book call · / }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'That time has just been booked. Choose another time.',
  )
  // The options are refreshed and the enquiry kept; the taken time is no longer offered.
  await expect(suggestions(page).first()).not.toHaveText(firstLabel ?? '')
  await expect(page.getByRole('button', { name: 'Book call', exact: true })).toBeVisible()
  await shot(page, 'b1-slot-taken')
  await suggestions(page).first().click()
  await page.getByRole('button', { name: /^Book call · / }).click()
  await expect(page.getByRole('heading', { name: 'Your call is booked' })).toBeVisible()

  const live = db.bookings.filter((b) => b.state !== 'failed')
  expect(live).toHaveLength(2)
  expect(new Set(live.map((b) => b.starts_at)).size).toBe(2)
  expect(live.find((b) => b.enquiry_id === ours)?.state).toBe('confirmed')
})

test('a double tap on Book makes one booking and one calendar event', async ({ page }) => {
  const { db, calendar } = await installFakeBackend(page)
  await submitEnquiry(page)
  await suggestions(page).nth(2).click()
  await page.getByRole('button', { name: /^Book call · / }).dblclick()
  await expect(page.getByRole('heading', { name: 'Your call is booked' })).toBeVisible()
  expect(db.bookings).toHaveLength(1)
  expect(calendar.insertCalls).toBe(1)
  expect(calendar.events.size).toBe(1)
  expect(db.comms.filter((c) => c.template === 'booking_confirmation')).toHaveLength(1)
})

test('the number to ring can be corrected on the time screen before booking', async ({ page }) => {
  const { db } = await installFakeBackend(page)
  await submitEnquiry(page)
  await page.getByRole('button', { name: 'Change the number' }).click()
  await page.getByLabel('Number we should ring').fill('x')
  await suggestions(page).first().click()
  await page.getByRole('button', { name: /^Book call · / }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter a phone number, e.g. 087 123 4567.')
  await page.getByLabel('Number we should ring').fill('01 234 5678')
  await page.getByRole('button', { name: /^Book call · / }).click()
  await expect(page.getByText(/will ring you on 01 234 5678\./)).toBeVisible()
  expect([...db.enquiries.values()][0]?.answers.phone).toBe('01 234 5678')
})

test('no times to offer: the enquiry is saved and the customer asks Q3 to contact them', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  db.availabilityRow = { ...db.availabilityRow, working_hours: {} }
  await submitEnquiry(page)
  await expect(page.getByRole('heading', { name: 'Your enquiry is saved' })).toBeVisible()
  await expect(page.getByText(/no times free for a call/)).toBeVisible()
  await shot(page, '10-no-times')
  await page.getByRole('button', { name: 'Ask Q3 to contact me' }).click()
  await expect(page.getByRole('heading', { name: 'We’ll be in touch' })).toBeVisible()
  const enquiry = [...db.enquiries.values()][0]
  expect(enquiry?.contact_requested_at).not.toBeNull()
  expect(db.events).toContainEqual(
    expect.objectContaining({ kind: 'contact_requested', detail: 'No times available online' }),
  )
})

test('none of the times suit: the customer can ask Q3 to contact them instead', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  await submitEnquiry(page)
  await page.getByRole('button', { name: 'None of these suit? Ask Q3 to contact me' }).click()
  await page.getByRole('button', { name: 'Ask Q3 to contact me' }).click()
  await expect(page.getByRole('heading', { name: 'We’ll be in touch' })).toBeVisible()
  expect(db.events).toContainEqual(
    expect.objectContaining({ kind: 'contact_requested', detail: 'No suitable time online' }),
  )
  expect(db.bookings).toHaveLength(0)
})

test('with the calendar disconnected the customer is offered a contact request', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  db.connection = null
  await submitEnquiry(page)
  await expect(page.getByRole('heading', { name: 'Your enquiry is saved' })).toBeVisible()
  await page.getByRole('button', { name: 'Ask Q3 to contact me' }).click()
  await expect(page.getByRole('heading', { name: 'We’ll be in touch' })).toBeVisible()
  expect([...db.enquiries.values()][0]?.contact_requested_at).not.toBeNull()
})

test('the confirmation email leads with the time and what will happen', async ({ page }) => {
  const { db } = await installFakeBackend(page)
  await submitEnquiry(page, 'on_site')
  await suggestions(page).first().click()
  await page.getByRole('button', { name: /^Book site visit · / }).click()
  await expect(page.getByRole('heading', { name: 'Your site visit is booked' })).toBeVisible()
  const ctx = await db.bookingContext(db.bookings[0]?.id ?? '')
  if (!ctx) throw new Error('no booking')
  const origin = new URL(page.url()).origin
  const email = renderMessage('booking_confirmation', {
    ctx,
    manageUrl: `${origin}/#/book/example-token`,
    businessPhone: null,
    privacyUrl: `${origin}/#/privacy`,
    siteUrl: origin,
  })
  expect(email.text).toMatch(
    /\(Irish time\)\nAbout 60 minutes\n\n.+ will meet you at 12 Example Road, D07 X2Y3\.\n\nYour enquiry reference is Q3-/,
  )
  await page.setContent(email.html)
  await expect(page.getByRole('link', { name: 'Change time' })).toHaveAttribute(
    'href',
    `${origin}/#/book/example-token?do=change`,
  )
  await expect(page.getByRole('link', { name: 'Cancel appointment' })).toHaveAttribute(
    'href',
    `${origin}/#/book/example-token?do=cancel`,
  )
  await shot(page, '12-confirmation-email')
})
