import { expect, test, type Page } from '@playwright/test'
import { installFakeBackend, startRoute } from './fake-backend'

/*
 * Enquiry form v2: landing choice -> Project -> Details -> Time, four forward actions on a
 * straightforward booking. Set SCREENSHOTS_DIR to keep the screenshots.
 */

const shot = async (page: Page, name: string) => {
  const width = page.viewportSize()?.width ?? 390
  // Every screen must fit the phone without sideways scrolling.
  const wide = await page.evaluate(
    (w) =>
      document.documentElement.scrollWidth <= w
        ? []
        : [`scrollWidth ${document.documentElement.scrollWidth}`].concat(
            [...document.querySelectorAll('body *')]
              .filter((el) => el.getBoundingClientRect().right > w + 1)
              .map((el) => `${el.tagName} ${(el.textContent ?? '').slice(0, 40)}`),
          ),
    width,
  )
  expect(wide, `${name}: wider than ${width}px`).toEqual([])
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const progressStep = (page: Page) =>
  page.getByRole('list', { name: 'Progress' }).locator('[aria-current="step"]')

test('a call, from an Instagram link to booked in four forward actions', async ({ page }) => {
  const urls: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })
  // The first save fails at the network; the retry succeeds.
  const { db, calendar, submitBodies } = await installFakeBackend(page, { failFirstSubmit: true })

  await page.goto(
    '/?utm_source=instagram&utm_medium=paid_social&utm_campaign=kitchens&fbclid=abc#/',
  )
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Let’s talk about your renovation.',
  )
  // Lengths come from the live appointment types.
  const call = page.getByRole('link', { name: /^Phone call/ })
  await expect(call).toContainText('Phone call · 20 minutes')
  await expect(call).toContainText('Talk through your plans.')
  await expect(page.getByRole('link', { name: /^Site visit/ })).toContainText(
    'Site visit · 60 minutes',
  )
  await expect(page.getByText('Both are free.', { exact: true })).toBeVisible()
  await shot(page, '01-landing')

  // 1. The landing choice.
  await call.click()
  await expect(progressStep(page)).toHaveText('Project')
  await expect(page.getByRole('heading', { name: 'What work are you planning?' })).toBeVisible()

  // Inline errors, announced, beside the questions.
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await expect(page.getByRole('alert')).toHaveText(['Choose an option.', 'This is required.'])
  await expect(page.getByRole('radio', { name: 'Kitchen' })).toBeFocused()
  await shot(page, '05-inline-error')

  // Kitchen reveals the optional layout question in place; focus stays on the choice.
  await page.getByRole('radio', { name: 'Kitchen' }).check()
  await expect(page.getByRole('radio', { name: 'Kitchen' })).toBeFocused()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await page.getByRole('radio', { name: 'Changing it' }).check()
  await page.getByLabel('Town or Eircode').fill('Dublin 8')
  await shot(page, '02-project-follow-up')

  // 2. Continue to the details.
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await expect(progressStep(page)).toHaveText('Details')
  await expect(page.getByText('Phone call · Kitchen · Dublin 8')).toBeVisible()
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
  await expect(page.getByLabel('Number we should ring')).toHaveAttribute('type', 'tel')
  await page.getByLabel('Number we should ring').fill('087 123 4567')
  await expect(page.getByLabel('House name or number and street')).toHaveCount(0)

  // Back restores the Project answers, and the details survive the round trip.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('radio', { name: 'Kitchen' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Changing it' })).toBeChecked()
  await expect(page.getByLabel('Town or Eircode')).toHaveValue('Dublin 8')
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await expect(page.getByLabel('Your name')).toHaveValue('Test Person')
  await expect(page.getByLabel('Number we should ring')).toHaveValue('087 123 4567')
  await shot(page, '03-details-call')

  // 3. Send. The first attempt fails: the answers stay and "Try again" is offered.
  await page.getByRole('button', { name: 'Send enquiry & see times' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Your enquiry has not gone through' }),
  ).toBeVisible()
  await expect(page.getByLabel('Your name')).toHaveValue('Test Person')
  await shot(page, '06-failed-save')
  await page.getByRole('button', { name: 'Try again' }).click()

  // The time screen opens for that enquiry.
  await expect(page.getByRole('heading', { name: 'Choose a time for your call' })).toBeVisible()
  await expect(progressStep(page)).toHaveText('Time')
  await expect(page.getByText('Phone call · 20 minutes · Irish time')).toBeVisible()
  const suggestions = page.getByRole('group', { name: 'Suggested times' }).getByRole('button')
  await expect(suggestions).toHaveCount(3)
  // Spread across different days.
  const labels = await suggestions.allTextContents()
  expect(new Set(labels.map((l) => l.split(',')[0])).size).toBe(3)
  await expect(page.getByText('We’ll ring you on 087 123 4567')).toBeVisible()
  await suggestions.nth(1).click()
  await expect(suggestions.nth(1)).toHaveAttribute('aria-pressed', 'true')
  const book = page.getByRole('button', { name: /^Book call · / })
  await expect(book).toHaveText(`Book call · ${labels[1]?.trim()}`)
  await shot(page, '07-time-chosen')

  // 4. Book.
  await book.click()
  await expect(page.getByRole('heading', { name: 'Your call is booked' })).toBeVisible()
  await expect(page.getByText(/will ring you on 087 123 4567\./)).toBeVisible()
  await expect(page.getByText('20 minutes · Irish time')).toBeVisible()
  await expect(page.getByText(/^Reference Q3-/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change time' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toBeVisible()
  await expect(page.locator('output')).toHaveText('Your call is booked')
  await shot(page, '08-booked-call')

  // One enquiry (same key on the retry), v2, with the preference and the follow-up.
  expect(submitBodies).toHaveLength(2)
  expect(submitBodies[1]?.p_idempotency_key).toBe(submitBodies[0]?.p_idempotency_key)
  expect(submitBodies[1]).toMatchObject({
    p_form_id: 'enquiry',
    p_form_version: 3,
    p_marketing_opt_in: false,
    p_answers: {
      appointment_preference: 'phone',
      project_type: 'kitchen',
      kitchen_layout: 'changing',
      location: 'Dublin 8',
      name: 'Test Person',
      email: 'test@example.com',
      phone: '087 123 4567',
    },
    p_attribution: {
      utm_source: 'instagram',
      utm_medium: 'paid_social',
      utm_campaign: 'kitchens',
      click_id_present: true,
      landing_path: '/',
    },
  })
  expect(Object.keys(submitBodies[1]?.p_answers ?? {})).not.toContain('site_street')
  expect(db.bookings).toHaveLength(1)
  expect(db.bookings[0]?.state).toBe('confirmed')
  expect(db.bookings[0]?.appointment_type_id).toBe('phone_consultation')
  expect(calendar.events.size).toBe(1)

  // Nothing personal ever reached a URL.
  for (const url of urls) {
    expect(url).not.toContain('example.com')
    expect(url).not.toContain('Test')
    expect(url).not.toContain('087')
  }
})

test('a site visit: the follow-up is required, the address carried forward, the visit booked', async ({
  page,
}) => {
  const { db, calendar, clock } = await installFakeBackend(page)
  await startRoute(page, 'on_site')
  await expect(page.getByText(/^Site visit · 60 minutes, free\./)).toBeVisible()

  // "Something else" needs a short answer (no minimum length).
  await page.getByRole('radio', { name: 'Something else' }).check()
  await page.getByLabel('Town or Eircode').fill('D07 X2Y3')
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await expect(page.getByRole('alert')).toHaveText('This is required.')
  await expect(page.getByLabel('What would you like us to look at?')).toBeFocused()
  await page.getByLabel('What would you like us to look at?').fill('Shed')
  await page.getByRole('button', { name: 'Continue to your details' }).click()

  // Details for a visit: arrival number, and the address with the town carried forward.
  await expect(page.getByText('Site visit · Something else · D07 X2Y3')).toBeVisible()
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Number we can ring on arrival').fill('087 123 4567')
  await expect(page.getByText('Town or Eircode: D07 X2Y3')).toBeVisible()
  await page.getByLabel('House name or number and street').fill('12 Example Road')
  await page.getByLabel('Apartment or unit (optional)').fill('Apt 3')
  await shot(page, '04-details-visit')
  await page.getByRole('button', { name: 'Send enquiry & see times' }).click()

  await expect(
    page.getByRole('heading', { name: 'Choose a time for your site visit' }),
  ).toBeVisible()
  await expect(page.getByText('We’ll meet you at 12 Example Road, Apt 3, D07 X2Y3')).toBeVisible()
  // The full availability is one tap away.
  await page.getByRole('button', { name: 'See more times' }).click()
  await page.getByRole('group', { name: 'Day' }).getByRole('button').nth(1).click()
  const times = page.getByRole('group', { name: /^Time on/ }).getByRole('button')
  await times.first().click()
  await expect(page.getByRole('button', { name: /^Book site visit · / })).toBeVisible()

  // Google answers slowly: the page says "Confirming…" until the event exists.
  calendar.script.insertError = {
    error: new (await import('../supabase/functions/_shared/google.ts')).GoogleError(
      'timeout',
      'no answer',
    ),
    createAnyway: true,
  }
  await page.getByRole('button', { name: /^Book site visit · / }).click()
  await expect(page.getByRole('heading', { name: 'Confirming your appointment…' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /is booked/ })).toHaveCount(0)
  clock.offset = 31_000
  await expect(page.getByRole('heading', { name: 'Your site visit is booked' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText(/will meet you at 12 Example Road, Apt 3, D07 X2Y3\./)).toBeVisible()
  await shot(page, '09-booked-visit')

  const enquiry = [...db.enquiries.values()][0]
  expect(enquiry?.answers).toMatchObject({
    appointment_preference: 'on_site',
    project_type: 'other',
    project_type_other: 'Shed',
    site_street: '12 Example Road',
    site_unit: 'Apt 3',
  })
  expect(enquiry?.site_details?.site_address).toBe('12 Example Road, Apt 3, D07 X2Y3')
  expect(db.bookings).toHaveLength(1)
  expect(db.bookings[0]?.appointment_type_id).toBe('site_visit')
  expect(calendar.events.size).toBe(1)
})

test('changing between call and visit keeps the details, asks for the address and drops a slot that no longer fits', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  await startRoute(page, 'phone')
  await page.getByRole('radio', { name: 'Several rooms' }).check()
  await page.getByLabel(/Which rooms are involved/).fill('Kitchen and hall')
  await page.getByLabel('Town or Eircode').fill('Dublin 8')

  // On Project: switch to a visit and back; the answers stay.
  await page.getByRole('button', { name: 'Switch to a site visit' }).click()
  await expect(page.getByText(/^Site visit · 60 minutes, free\./)).toBeVisible()
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Number we can ring on arrival').fill('087 123 4567')
  await expect(page.getByLabel('House name or number and street')).toBeVisible()
  await page.getByRole('button', { name: 'Edit your project' }).click()
  await page.getByRole('button', { name: 'Switch to a call' }).click()
  await expect(page.getByLabel(/Which rooms are involved/)).toHaveValue('Kitchen and hall')
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await expect(page.getByText('Phone call · Several rooms · Dublin 8')).toBeVisible()
  await expect(page.getByLabel('Number we should ring')).toHaveValue('087 123 4567')
  await expect(page.getByLabel('House name or number and street')).toHaveCount(0)
  await page.getByRole('button', { name: 'Send enquiry & see times' }).click()

  // On Time: the last call of the day cannot be a 60-minute visit.
  await expect(page.getByRole('heading', { name: 'Choose a time for your call' })).toBeVisible()
  await page.getByRole('button', { name: 'See more times' }).click()
  await page
    .getByRole('group', { name: /^Time on/ })
    .getByRole('button')
    .last()
    .click()
  await expect(page.getByRole('button', { name: /^Book call · .*, 16:30$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Switch to a site visit' }).click()
  await expect(
    page.getByRole('heading', { name: 'Choose a time for your site visit' }),
  ).toBeVisible()
  await expect(
    page.getByText('Your chosen time is not free for a site visit. Choose another time.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Book site visit', exact: true })).toBeVisible()

  // The missing address is asked for; the town is carried forward.
  await expect(page.getByText('Town or Eircode: Dublin 8')).toBeVisible()
  await page.getByRole('button', { name: 'Book site visit', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText([
    'Your chosen time is not free for a site visit. Choose another time.',
    'Choose a time.',
    'This is required.',
  ])
  await page.getByLabel('House name or number and street').fill('4 Sample Street')
  await page.getByRole('group', { name: 'Suggested times' }).getByRole('button').first().click()
  await page.getByRole('button', { name: /^Book site visit · / }).click()
  await expect(page.getByRole('heading', { name: 'Your site visit is booked' })).toBeVisible()
  await expect(page.getByText(/will meet you at 4 Sample Street, Dublin 8\./)).toBeVisible()

  const enquiry = [...db.enquiries.values()][0]
  expect(enquiry?.answers).toMatchObject({
    appointment_preference: 'on_site',
    project_type: 'several_rooms',
    rooms_involved: 'Kitchen and hall',
    site_street: '4 Sample Street',
  })
  expect(enquiry?.site_details?.site_address).toBe('4 Sample Street, Dublin 8')
  expect(db.bookings.map((b) => b.appointment_type_id)).toEqual(['site_visit'])
})

test('the landing and form screens hold at 320px with enlarged text', async ({ page }) => {
  await installFakeBackend(page)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/#/')
  await expect(page.getByRole('link', { name: /^Site visit/ })).toContainText('60 minutes')
  await shot(page, '320-01-landing')
  await page.getByRole('link', { name: /^Site visit/ }).click()
  await page.getByRole('radio', { name: 'Kitchen' }).check()
  await shot(page, '320-02-project')
  await page.getByLabel('Town or Eircode').fill('Dublin 8')
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await shot(page, '320-03-details')
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Number we can ring on arrival').fill('087 123 4567')
  await page.getByLabel('House name or number and street').fill('12 Example Road')
  await page.getByRole('button', { name: 'Send enquiry & see times' }).click()
  await page.getByRole('group', { name: 'Suggested times' }).getByRole('button').first().click()
  await shot(page, '320-04-time')

  // Enlarged text (200%): still no sideways scroll, and the main actions stay reachable.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await shot(page, '320-05-time-large-text')
  const book = page.getByRole('button', { name: /^Book site visit · / })
  await book.scrollIntoViewIfNeeded()
  await expect(book).toBeInViewport()
  const box = await book.boundingBox()
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
  for (const path of ['/#/', '/#/enquire?type=phone']) {
    await page.goto(path)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await shot(page, `320-large-text-${path === '/#/' ? 'landing' : 'project'}`)
  }
})
