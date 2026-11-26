import { expect, test, type Page } from '@playwright/test'
import { installFakeBackend } from './fake-backend'

/*
 * Part C: first-party visit counting. One session per tab, joined to the enquiry by id, never in
 * the way of the journey. SCREENSHOTS_DIR keeps the privacy screenshot.
 */

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

async function sendCall(page: Page) {
  await page.getByRole('link', { name: /^Phone call/ }).click()
  await page.getByRole('radio', { name: 'Bathroom' }).check()
  await page.getByLabel('Town or Eircode').fill('Cork')
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Number we should ring').fill('087 123 4567')
  await page.getByRole('button', { name: 'Send enquiry & see times' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a time for your call' })).toBeVisible()
}

test('one session per visit, with the tapped route, joined to the enquiry; nothing personal sent', async ({
  page,
}) => {
  const { visitBodies, submitBodies } = await installFakeBackend(page)
  await page.goto('/?utm_source=instagram&utm_campaign=kitchens&fbclid=abc#/')
  await expect(page.getByRole('link', { name: /^Phone call/ })).toBeVisible()
  await expect.poll(() => visitBodies.length).toBe(1)
  // A reload is the same visit.
  await page.reload()
  await expect(page.getByRole('link', { name: /^Phone call/ })).toBeVisible()
  await page.waitForTimeout(300)
  expect(visitBodies).toHaveLength(1)

  await sendCall(page)
  // The choice updates the same session; the enquiry carries its id.
  expect(visitBodies).toHaveLength(2)
  const [arrival, choice] = visitBodies
  expect(arrival).toEqual({
    p_session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    p_surface: 'landing',
    p_form_version: 3,
    p_attribution: { utm_source: 'instagram', utm_campaign: 'kitchens', click_id_present: true },
    p_route: null,
  })
  expect(choice).toMatchObject({ p_session_id: arrival?.p_session_id, p_route: 'phone' })
  expect(new Set(visitBodies.map((b) => b.p_session_id)).size).toBe(1)
  expect(submitBodies.at(-1)?.p_session_id).toBe(arrival?.p_session_id)
  const sent = JSON.stringify(visitBodies)
  for (const personal of ['Test Person', 'example.com', '087', 'Cork', 'Bathroom'])
    expect(sent).not.toContain(personal)

  // Booking links and the privacy page are not landing sessions; a new tab is a new session.
  const other = await page.context().newPage()
  await other.goto('/#/privacy')
  await other.waitForTimeout(300)
  expect(visitBodies).toHaveLength(2)
})

test('the journey works when counting fails', async ({ page }) => {
  const { visitBodies, submitBodies } = await installFakeBackend(page, { failVisits: true })
  await page.goto('/#/')
  await sendCall(page)
  expect(visitBodies.length).toBeGreaterThan(0)
  expect(submitBodies).toHaveLength(1)
  await page.getByRole('group', { name: 'Suggested times' }).getByRole('button').first().click()
  await page.getByRole('button', { name: /^Book call · / }).click()
  await expect(page.getByRole('heading', { name: 'Your call is booked' })).toBeVisible()
})

test('the privacy notice says visits are counted without personal details or cookies', async ({
  page,
}) => {
  await installFakeBackend(page)
  await page.goto('/#/privacy')
  const line = page.getByText(/We count visits to this site and which advert they came from/)
  await expect(line).toContainText('without personal details or cookies')
  await line.scrollIntoViewIfNeeded()
  await shot(page, '03-privacy-line')
})
