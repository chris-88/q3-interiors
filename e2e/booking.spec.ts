import { expect, test, type Page } from '@playwright/test'
import { GoogleError } from '../supabase/functions/_shared/google.ts'
import { installFakeBackend, submitEnquiry } from './fake-backend'

// Set SCREENSHOTS_DIR to keep 390px screenshots of each step.
const shot = async (page: Page, name: string) => {
  // Every step must fit a 390px phone without sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

test('a customer books an estimate visit straight after the enquiry, with Google faked', async ({
  page,
}) => {
  const { db, calendar, clock } = await installFakeBackend(page)
  await page.goto('/#/enquire')
  await submitEnquiry(page)

  // Appointment type.
  await expect(
    page.getByRole('heading', { name: 'How would you like to talk it through?' }),
  ).toBeVisible()
  await shot(page, 'b1-type')
  await page.getByRole('radio', { name: /Estimate visit at your home/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  // The visit needs the address first; validation is visible.
  await expect(page.getByRole('heading', { name: 'Where is the property?' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert').first()).toContainText('required')
  await page
    .getByLabel('Address of the property')
    .fill('12 Example Road, Phibsborough, Dublin 7, D07 X2Y3')
  await page.getByLabel(/Anything we should know/).fill('Side gate, ring the bell')
  await shot(page, 'b2-address')
  await page.getByRole('button', { name: 'Continue' }).click()

  // Slot picker, in Irish time.
  await expect(page.getByRole('heading', { name: 'Choose a time' })).toBeVisible()
  await expect(page.getByText('Irish time (Europe/Dublin)')).toBeVisible()
  const times = page.getByRole('group', { name: /^Time on/ }).getByRole('button')
  await expect(times.first()).toBeVisible()
  const firstTime = (await times.first().textContent())?.trim() ?? ''
  await times.first().click()
  await shot(page, 'b3-slots')

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Check and book' })).toBeVisible()
  await expect(page.getByText(new RegExp(` at ${firstTime}`))).toBeVisible()

  // Make the first insert time out after Google created the event, to show the pending state.
  calendar.script.insertError = {
    error: new GoogleError('timeout', 'no answer'),
    createAnyway: true,
  }
  await page.getByRole('button', { name: 'Book this time' }).click()

  await expect(page.getByRole('heading', { name: 'Confirming your appointment' })).toBeVisible()
  await shot(page, 'b4-pending')
  // The retry becomes due; the next status poll reconciles the existing event.
  clock.offset = 31_000
  await expect(page.getByRole('heading', { name: 'You are booked in' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('Irish time (Europe/Dublin)')).toBeVisible()
  await expect(page.getByText(/will visit you at/)).toBeVisible()
  await expect(page.getByText('12 Example Road, Phibsborough, Dublin 7, D07 X2Y3')).toBeVisible()
  await shot(page, 'b5-confirmed')

  expect(calendar.events.size).toBe(1)
  expect(calendar.insertCalls).toBe(1)
  expect(db.bookings).toHaveLength(1)
  expect(db.bookings[0]?.state).toBe('confirmed')
  // test@example.com is a reserved test address: the email is recorded, never sent.
  expect(db.comms).toHaveLength(1)
})

test('two customers want the same time: the second gets fresh alternatives and books one', async ({
  page,
}) => {
  const { db, calendar } = await installFakeBackend(page)
  await page.goto('/#/enquire')
  await submitEnquiry(page)
  await page.getByRole('radio', { name: /Phone consultation/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  const times = page.getByRole('group', { name: /^Time on/ }).getByRole('button')
  await times.first().click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Check and book' })).toBeVisible()

  // Another customer books the same time first.
  const ours = [...db.enquiries.keys()][0] ?? ''
  const other = db.addEnquiry(
    { name: 'Other', email: 'o@example.com', phone: '0870000000' },
    'tok-other-customer-0000000000',
  )
  const startOfFirst = await (async () => {
    // The first offered phone slot is the one the customer picked.
    const { handlePublic } = await import('../supabase/functions/_shared/public-booking.ts')
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
    return (res.body as { slots: { start: string }[] }).slots[0]?.start ?? ''
  })()
  expect(
    (
      await db.reserve(
        other,
        'phone_consultation',
        startOfFirst,
        '00000000-0000-4000-8000-0000000000ff',
      )
    ).status,
  ).toBe('reserved')

  await page.getByRole('button', { name: 'Book this time' }).click()
  await expect(page.getByText('Sorry, that time has just gone')).toBeVisible()
  await shot(page, 'b6-alternatives')
  const alternatives = page.getByRole('list', { name: 'Nearest free times' }).getByRole('button')
  await expect(alternatives.first()).toBeVisible()
  await alternatives.first().click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Book this time' }).click()
  await expect(page.getByRole('heading', { name: 'You are booked in' })).toBeVisible()
  await expect(page.getByText(/will ring you on 087 123 4567/)).toBeVisible()

  // Two live bookings at different times; ours is confirmed, nothing overlaps.
  const live = db.bookings.filter((b) => b.state !== 'failed')
  expect(live).toHaveLength(2)
  expect(new Set(live.map((b) => b.starts_at)).size).toBe(2)
  expect(live.find((b) => b.enquiry_id === ours)?.state).toBe('confirmed')
})

test('with the calendar disconnected the customer is offered a call-back instead', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  db.connection = null
  await page.goto('/#/enquire')
  await submitEnquiry(page)
  await expect(
    page.getByRole('heading', { name: 'We cannot show available times right now' }),
  ).toBeVisible()
  await shot(page, 'b7-contact-path')
  await page.getByRole('button', { name: 'Ask us to contact me' }).click()
  await expect(page.getByRole('heading', { name: 'We will be in touch' })).toBeVisible()
  expect([...db.enquiries.values()][0]?.contact_requested_at).not.toBeNull()
})
