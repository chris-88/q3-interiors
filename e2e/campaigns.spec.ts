import { expect, test, type Page } from '@playwright/test'
import { installFakeStaff, signIn } from './fake-staff'

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

test('an admin builds a tagged link, enters spend, and the report shows what it cost', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const world = await installFakeStaff(page)
  await page.goto('/#/staff/settings/campaigns')
  await signIn(page, 'admin@example.com', 'correct horse battery staple')

  await page.getByRole('button', { name: 'New campaign' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Spring Kitchens 2027')
  await expect(page.getByLabel('Link name (utm_campaign)')).toHaveValue('spring-kitchens-2027')
  await page.getByLabel('Link name (utm_campaign)').fill('Spring Kitchens!')
  await page.getByRole('button', { name: 'Create campaign' }).click()
  await expect(page.getByText('Lower-case letters, digits and single hyphens only')).toBeVisible()
  await page.getByLabel('Link name (utm_campaign)').fill('spring-kitchens')
  await page.getByLabel('Where the link lands').selectOption('/enquire')
  await page.getByRole('button', { name: 'Create campaign' }).click()

  const card = page.getByRole('region', { name: 'Spring Kitchens 2027' })
  await card.getByLabel('New creative').fill('Reel 1: before and after')
  await expect(card.getByText('In links as reel-1-before-and-after.')).toBeVisible()
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  await card.getByLabel('Creative (utm_content)').selectOption('reel-1-before-and-after')
  const expected =
    'https://book.q3interiors.ie/?utm_source=instagram&utm_medium=paid_social&utm_campaign=spring-kitchens&utm_content=reel-1-before-and-after#/enquire'
  await expect(card.getByLabel('Link', { exact: true })).toHaveValue(expected)
  await expect(card.getByRole('link', { name: 'Test this link' })).toHaveAttribute('href', expected)
  await card.getByRole('button', { name: 'Copy link' }).click()
  await expect(card.getByText('Copied. Paste it into the ad.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
  // Once a link is out, the link name is fixed.
  await expect(card.getByText('Link in use')).toBeVisible()
  await card.getByRole('button', { name: 'Edit details' }).click()
  await expect(card.getByLabel('Link name (utm_campaign)')).toHaveAttribute('readonly', '')
  await expect(card.getByText('Links with this name are already out')).toBeVisible()
  await card.getByRole('button', { name: 'Close without saving' }).click()

  await card.getByLabel('Amount (€)').fill('12.345')
  await card.getByRole('button', { name: 'Add spend' }).click()
  await expect(card.getByText('Enter an amount in euro')).toBeVisible()
  await card.getByLabel('Amount (€)').fill('125.50')
  await card.getByLabel('Note (optional)').fill('Week 1')
  await card.getByRole('button', { name: 'Add spend' }).click()
  await expect(card.getByText('Total so far: €125.50')).toBeVisible()
  await shot(page, 'c1-campaign')

  // The report: costs per stage for the campaign, raw tags kept, no spend shown as such.
  world.funnel = [
    {
      campaign: 'spring-kitchens',
      enquiries: 5,
      booked: 2,
      attended: 1,
      won: 0,
      cancelled: 0,
      no_shows: 0,
      won_value: 0,
    },
    {
      campaign: 'ig-old-post',
      enquiries: 1,
      booked: 0,
      attended: 0,
      won: 0,
      cancelled: 0,
      no_shows: 0,
      won_value: 0,
    },
  ]
  await page.getByRole('link', { name: 'Report' }).click()
  const spring = page.getByRole('region', { name: 'Spring Kitchens 2027 (spring-kitchens)' })
  await expect(spring).toContainText('Spend in range€125.50')
  await expect(spring).toContainText('Per enquiry€25.10')
  await expect(spring).toContainText('Per booked appointment€62.75')
  await expect(spring).toContainText('Per won jobNone yet')
  await expect(
    page.getByRole('region', { name: 'ig-old-post (tag, no campaign set up)' }),
  ).toContainText('No spend entered')
  await shot(page, 'c2-report-costs')
})

test('staff see the report without spend and cannot open campaigns', async ({ page }) => {
  const world = await installFakeStaff(page)
  world.funnel = [
    {
      campaign: 'spring-kitchens',
      enquiries: 5,
      booked: 2,
      attended: 1,
      won: 0,
      cancelled: 0,
      no_shows: 0,
      won_value: 0,
    },
  ]
  await page.goto('/#/staff/report')
  await signIn(page, 'staff@example.com', 'another long password')
  await expect(page.getByRole('heading', { name: 'Funnel report' })).toBeVisible()
  await expect(page.getByText('Spend in range')).toHaveCount(0)
  await page.goto('/#/staff/settings/campaigns')
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
})
