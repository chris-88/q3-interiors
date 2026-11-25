import { expect, test, type Page } from '@playwright/test'
import { fillDetails, fillProject, installFakeBackend, startRoute } from './fake-backend'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

async function fillToDetails(page: Page, options: { trap?: string } = {}) {
  await startRoute(page, 'phone')
  await fillProject(page)
  await fillDetails(page, 'phone')
  if (options.trap) await page.locator('#website').fill(options.trap, { force: true })
}

const send = (page: Page) => page.getByRole('button', { name: 'Send enquiry & see times' }).click()

test('the privacy notice is linked from the footer and the submit step', async ({ page }) => {
  await installFakeBackend(page)
  await page.goto('/#/')
  await page.getByRole('link', { name: 'How we use your details' }).click()
  await expect(
    page.getByRole('heading', { name: 'How we use your details', level: 1 }),
  ).toBeVisible()
  for (const name of [
    'What we collect',
    'Who handles it for us',
    'How long we keep it',
    'Your rights',
  ]) {
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await expect(page.getByText('We do not use advertising pixels or tracking cookies')).toBeVisible()
  // Nothing unconfirmed is shown: no placeholder gaps on the public notice.
  await expect(page.getByText(/to be added/)).toHaveCount(0)
  await shot(page, 'p1-privacy')
  await fillToDetails(page)
  await expect(
    page.getByRole('main').getByRole('link', { name: 'How we use your details', exact: true }),
  ).toHaveAttribute('href', '#/privacy')
  // The form screens carry small Contact and Privacy links instead of the black footer.
  await expect(page.getByRole('navigation', { name: 'Help' }).getByRole('link')).toHaveText([
    'Privacy',
  ])
})

test('the honeypot is invisible to people and assistive tech, and a bot gets a plain success', async ({
  page,
}) => {
  const { submitBodies, db } = await installFakeBackend(page)
  await fillToDetails(page)
  // Not in the accessibility tree, not reachable by keyboard.
  await expect(page.getByRole('textbox', { name: 'Website' })).toHaveCount(0)
  await expect(page.locator('#website')).toHaveAttribute('tabindex', '-1')
  await page.locator('#website').fill('http://spam.example', { force: true })
  await send(page)
  await expect(page.getByRole('heading', { name: 'Enquiry received' })).toBeVisible()
  expect(submitBodies.at(-1)?.p_trap).toBe('http://spam.example')
  expect(db.enquiries.size).toBe(0)
})

test('a limited address sees a plain message and keeps its answers', async ({ page }) => {
  await installFakeBackend(page, { limitSubmit: true })
  await fillToDetails(page)
  await send(page)
  await expect(page.getByRole('alert').filter({ hasText: 'Please try again later' })).toBeVisible()
  await expect(page.getByText('Your answers are still here.')).toBeVisible()
  await expect(page.getByLabel('Your name')).toHaveValue('Test Person')
  await expect(page.getByText(/PT429|rate_limited/)).toHaveCount(0)
  await shot(page, 'p2-limited')
})

test('an unreachable backend keeps the answers and retries with the same key', async ({ page }) => {
  const { submitBodies } = await installFakeBackend(page, { failFirstSubmit: true })
  await fillToDetails(page)
  await send(page)
  await expect(
    page.getByRole('alert').filter({ hasText: 'Your enquiry has not gone through' }),
  ).toBeVisible()
  await expect(page.getByText('We could not reach our system just now.')).toBeVisible()
  await shot(page, 'p3-failure')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a time for your call' })).toBeVisible()
  expect(submitBodies).toHaveLength(2)
  expect(submitBodies[1]?.p_idempotency_key).toBe(submitBodies[0]?.p_idempotency_key)
})
