import { expect, test, type Page } from '@playwright/test'
import { installFakeBackend } from './fake-backend'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

async function fillToReview(page: Page, options: { trap?: string } = {}) {
  await page.goto('/#/enquire')
  await page.getByRole('radio', { name: 'Kitchen' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('What would you like done?').fill('New kitchen units and worktops.')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Eircode or area').fill('D07 X2Y3')
  await page.getByRole('radio', { name: 'I am flexible' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Phone').fill('087 123 4567')
  if (options.trap) await page.locator('#website').fill(options.trap, { force: true })
  await page.getByRole('button', { name: 'Review your enquiry' }).click()
  await expect(page.getByRole('heading', { name: 'Review your enquiry', level: 1 })).toBeVisible()
}

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
  await fillToReview(page)
  await expect(
    page.getByRole('main').getByRole('link', { name: 'how we use your details', exact: true }),
  ).toHaveAttribute('href', '#/privacy')
})

test('the honeypot is invisible to people and assistive tech, and a bot gets a plain success', async ({
  page,
}) => {
  const { submitBodies, db } = await installFakeBackend(page)
  await fillToReview(page)
  await page.getByRole('button', { name: 'Back' }).click()
  // Not in the accessibility tree, not reachable by keyboard.
  await expect(page.getByRole('textbox', { name: 'Website' })).toHaveCount(0)
  await expect(page.locator('#website')).toHaveAttribute('tabindex', '-1')
  await page.locator('#website').fill('http://spam.example', { force: true })
  await page.getByRole('button', { name: 'Review your enquiry' }).click()
  await page.getByRole('button', { name: 'Send enquiry' }).click()
  await expect(page.getByRole('heading', { name: 'Enquiry received' })).toBeVisible()
  expect(submitBodies.at(-1)?.p_trap).toBe('http://spam.example')
  expect(db.enquiries.size).toBe(0)
})

test('a limited address sees a plain message and keeps its answers', async ({ page }) => {
  await installFakeBackend(page, { limitSubmit: true })
  await fillToReview(page)
  await page.getByRole('button', { name: 'Send enquiry' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Please try again later' })).toBeVisible()
  await expect(page.getByText('Your answers are still here.')).toBeVisible()
  await expect(page.getByText('D07 X2Y3')).toBeVisible()
  await expect(page.getByText(/PT429|rate_limited/)).toHaveCount(0)
  await shot(page, 'p2-limited')
})

test('an unreachable backend keeps the answers and retries with the same key', async ({ page }) => {
  const { submitBodies } = await installFakeBackend(page, { failFirstSubmit: true })
  await fillToReview(page)
  await page.getByRole('button', { name: 'Send enquiry' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Your enquiry has not gone through' }),
  ).toBeVisible()
  await expect(page.getByText('We could not reach our system just now.')).toBeVisible()
  await shot(page, 'p3-failure')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(
    page.getByRole('heading', { name: 'How would you like to talk it through?' }),
  ).toBeVisible()
  expect(submitBodies).toHaveLength(2)
  expect(submitBodies[1]?.p_idempotency_key).toBe(submitBodies[0]?.p_idempotency_key)
})
