import { expect, test, type Page } from '@playwright/test'
import { installFakeBackend } from './fake-backend'

/*
 * Links from the website (q3interiors.ie): `?appointment=call|visit[&inspiration=<slug>]
 * [&project_type=<label>][&utm_*]` open the Project screen directly. Fake backend only.
 * SCREENSHOTS_DIR keeps the phone screenshots.
 */

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

const project = (page: Page) => page.getByRole('heading', { name: 'What work are you planning?' })
const context = (page: Page) =>
  page.getByRole('complementary', { name: 'The project you were looking at' })
const backToSite = (page: Page) => page.getByRole('link', { name: 'Back to q3interiors.ie' })

async function sendDetails(page: Page, route: 'call' | 'visit') {
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  if (route === 'call') await page.getByLabel('Number we should ring').fill('087 123 4567')
  else {
    await page.getByLabel('Number we can ring on arrival').fill('087 123 4567')
    await page.getByLabel('House name or number and street').fill('12 Example Road')
  }
  await page.getByRole('button', { name: 'Send enquiry & see times' }).click()
  await expect(page.getByRole('heading', { name: /^Choose a time for your/ })).toBeVisible()
}

test('a call from the homepage opens Project, keeps the tags, and a reload does not restart it', async ({
  page,
}) => {
  const { submitBodies, visitBodies } = await installFakeBackend(page)
  await page.goto('/?appointment=call&utm_source=q3website&utm_medium=referral&utm_campaign=home')
  await expect(project(page)).toBeVisible()
  await expect(page.getByText(/^Phone call · 20 minutes, free\./)).toBeVisible()
  // The address is tidied: the entry is taken, the campaign tags stay.
  await expect.poll(() => new URL(page.url()).hash).toBe('#/enquire')
  expect(new URL(page.url()).search).toBe(
    '?utm_source=q3website&utm_medium=referral&utm_campaign=home',
  )
  await expect(backToSite(page)).toHaveAttribute('href', 'https://q3interiors.ie')
  await expect(context(page)).toHaveCount(0)
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)

  await page.getByRole('radio', { name: 'Kitchen' }).check()
  await page.getByLabel('Town or Eircode').fill('Dublin 8')
  await page.reload()
  await expect(project(page)).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Kitchen' })).toBeChecked()
  await expect(page.getByLabel('Town or Eircode')).toHaveValue('Dublin 8')

  await sendDetails(page, 'call')
  const sent = submitBodies.at(-1)
  expect(sent).toMatchObject({
    p_form_version: 3,
    p_answers: { appointment_preference: 'phone', project_type: 'kitchen' },
    p_attribution: { utm_source: 'q3website', utm_medium: 'referral', utm_campaign: 'home' },
  })
  expect(sent).not.toHaveProperty('p_inspiration')
  // Counted as a landing session with its tags and the route, so the funnel holds.
  expect(visitBodies[0]).toMatchObject({
    p_attribution: { utm_source: 'q3website', utm_campaign: 'home' },
  })
  expect(visitBodies.some((v) => v.p_route === 'phone')).toBe(true)
  expect(sent?.p_session_id).toBe(visitBodies[0]?.p_session_id)
})

test('a visit from a project page shows the project, suggests the type, and saves the slug', async ({
  page,
}) => {
  const { submitBodies } = await installFakeBackend(page)
  await page.goto(
    '/?appointment=visit&inspiration=fairview&project_type=Kitchen&utm_source=q3website',
  )
  await expect(project(page)).toBeVisible()
  await expect(page.getByText(/^Site visit · 60 minutes, free\./)).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Kitchen' })).toBeChecked()
  await expect(context(page)).toContainText('You were looking at')
  await expect(context(page)).toContainText('Kitchen fit-out, Fairview, Dublin 3')
  await expect(context(page).getByRole('link', { name: 'Back to the project' })).toHaveAttribute(
    'href',
    'https://q3interiors.ie/our-work/fairview/',
  )
  await expect(backToSite(page)).toBeVisible()
  await shot(page, 'project-inspiration-390')

  // The suggestion is editable, and the project stays when the type changes.
  await page.getByRole('radio', { name: 'Bathroom' }).check()
  await expect(context(page)).toContainText('Fairview')
  await page.getByLabel('Town or Eircode').fill('Dublin 3')
  // Reload and Back keep the customer's own choice (the suggestion is not applied again).
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Bathroom' })).toBeChecked()
  await page.getByRole('link', { name: 'Privacy' }).click()
  await page.goBack()
  await expect(page.getByRole('radio', { name: 'Bathroom' })).toBeChecked()
  await expect(context(page)).toContainText('Fairview')

  await sendDetails(page, 'visit')
  expect(submitBodies.at(-1)).toMatchObject({
    p_inspiration: 'fairview',
    p_answers: { appointment_preference: 'on_site', project_type: 'bathroom' },
    p_attribution: { utm_source: 'q3website' },
  })
})

const LABELS: [string, string][] = [
  ['Kitchen', 'Kitchen'],
  ['bathroom', 'Bathroom'],
  ['SEVERAL ROOMS', 'Several rooms'],
  ['Whole home renovation', 'Whole home renovation'],
  ['extension', 'Extension'],
  ['Attic conversion', 'Attic conversion'],
  ['Workplace fit-out', 'Workplace fit-out'],
  ['Something else', 'Something else'],
]

test('each project_type label pre-selects its card; an unknown one selects nothing', async ({
  context: browser,
}) => {
  for (const [given, card] of LABELS) {
    const page = await browser.newPage()
    await installFakeBackend(page)
    await page.goto(`/?appointment=visit&project_type=${encodeURIComponent(given)}`)
    await expect(page.getByRole('radio', { name: card, exact: true })).toBeChecked()
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
    await page.close()
  }
  const page = await browser.newPage()
  await installFakeBackend(page)
  await page.goto('/?appointment=call&project_type=Garden%20room')
  await expect(project(page)).toBeVisible()
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
})

const SLUGS: [string, string][] = [
  ['donabate', 'Victorian hallway, Donabate, Co. Dublin'],
  ['fairview', 'Kitchen fit-out, Fairview, Dublin 3'],
  ['fitzwilliam-office', 'Georgian office fit-out, Fitzwilliam Square, Dublin 2'],
  ['castleknock', 'Victorian bathroom, Castleknock, Dublin 15'],
  ['fitzwilliam-bathroom', 'Georgian bathroom, Fitzwilliam Square, Dublin 2'],
  ['adelaide', 'Apartment fit-out, Adelaide Road, Dublin 2'],
]

test('each known project shows as context; an unknown slug is ignored', async ({
  context: browser,
}) => {
  for (const [slug, line] of SLUGS) {
    const page = await browser.newPage()
    await installFakeBackend(page)
    // Inside the hash route works too.
    await page.goto(`/#/?appointment=visit&inspiration=${slug}`)
    await expect(context(page)).toContainText(line)
    await expect(context(page).getByRole('link')).toHaveAttribute(
      'href',
      `https://q3interiors.ie/our-work/${slug}/`,
    )
    await page.close()
  }
  const page = await browser.newPage()
  const { submitBodies } = await installFakeBackend(page)
  await page.goto('/?appointment=visit&inspiration=elsewhere')
  await expect(project(page)).toBeVisible()
  await expect(context(page)).toHaveCount(0)
  await expect(backToSite(page)).toBeVisible()
  await page.getByRole('radio', { name: 'Workplace fit-out' }).check()
  await page.getByLabel('Town or Eircode').fill('Dublin 2')
  await sendDetails(page, 'visit')
  expect(submitBodies.at(-1)).not.toHaveProperty('p_inspiration')
  expect(submitBodies.at(-1)?.p_answers).toMatchObject({ project_type: 'workplace' })
})

test('without a usable appointment the landing page offers both choices', async ({ page }) => {
  await installFakeBackend(page)
  await page.goto('/?appointment=video&inspiration=adelaide')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Let’s talk about your renovation.',
  )
  await expect(page.getByRole('link', { name: /^Phone call/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Site visit/ })).toBeVisible()
  await expect(backToSite(page)).toBeVisible()
  expect(new URL(page.url()).search).toBe('')
  // The project comes along once a route is chosen.
  await page.getByRole('link', { name: /^Site visit/ }).click()
  await expect(context(page)).toContainText('Apartment fit-out')
})

test('the old ?type= link and a plain Instagram landing are unchanged', async ({ page }) => {
  await installFakeBackend(page)
  await page.goto('/#/enquire?type=on_site')
  await expect(project(page)).toBeVisible()
  await expect(page.getByText(/^Site visit · 60 minutes, free\./)).toBeVisible()
  await expect(backToSite(page)).toHaveCount(0)
  await expect(context(page)).toHaveCount(0)

  const insta = await page.context().newPage()
  await installFakeBackend(insta)
  const link = '/?utm_source=instagram&utm_campaign=kitchens&fbclid=abc#/'
  await insta.goto(link)
  await expect(insta.getByRole('heading', { level: 1 })).toHaveText(
    'Let’s talk about your renovation.',
  )
  await expect(backToSite(insta)).toHaveCount(0)
  expect(insta.url()).toMatch(/\?utm_source=instagram&utm_campaign=kitchens&fbclid=abc#\/$/)
})
