import { expect, test } from '@playwright/test'
import { installFakeBackend } from './fake-backend'

test('a homeowner describes a project, corrects an answer, survives a failed save and sends it', async ({
  page,
}) => {
  const urls: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url())
  })

  // First attempt fails at the network; the retry succeeds.
  const { submitBodies: bodies } = await installFakeBackend(page, { failFirstSubmit: true })

  await page.goto('/?utm_source=instagram&utm_medium=paid_social&fbclid=abc#/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('renovation')
  await page.getByRole('link', { name: 'Tell us about your project' }).first().click()

  // Step 1: validation is visible and the conditional "Other" question appears on demand.
  await expect(page.getByText('Step 1 of 6')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toHaveText('Choose an option.')
  await page.getByRole('radio', { name: 'Whole home renovation' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 2: description and the conditional rooms question.
  await expect(page.getByRole('heading', { name: 'Tell us a little more' })).toBeFocused()
  await page
    .getByLabel('What would you like done?')
    .fill('Full refit of the ground floor and new bathroom upstairs.')
  await page.getByRole('checkbox', { name: 'Kitchen' }).click()
  await page.getByRole('checkbox', { name: 'Bedrooms' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 3.
  await page.getByLabel('Eircode or area').fill('Phibsborough')
  await page.getByRole('radio', { name: 'I am flexible' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 4: budget is optional.
  await expect(page.getByText('Step 4 of 6')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 5: contact details with the right input types.
  await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email')
  await expect(page.getByLabel('Phone')).toHaveAttribute('type', 'tel')
  await expect(page.getByLabel('Your name')).toHaveAttribute('autocomplete', 'name')
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Phone').fill('087 123 4567')
  await page.getByRole('checkbox', { name: /news and offers/ }).click()
  await page.getByRole('button', { name: 'Review your enquiry' }).click()

  // Review: correct an answer and come straight back.
  await expect(page.getByRole('heading', { name: 'Review your enquiry', level: 1 })).toBeVisible()
  await expect(page.getByText('Kitchen, Bedrooms')).toBeVisible()
  await page.getByRole('button', { name: 'Change: Where and when' }).click()
  await page.getByLabel('Eircode or area').fill('D07 X2Y3')
  await page.getByRole('button', { name: 'Save and review' }).click()
  await expect(page.getByText('D07 X2Y3')).toBeVisible()

  // Answers survive a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Review your enquiry', level: 1 })).toBeVisible()
  await expect(page.getByText('D07 X2Y3')).toBeVisible()
  await expect(page.getByText('Yes, please')).toBeVisible()

  // A failed save says so truthfully and keeps the answers.
  await page.getByRole('button', { name: 'Send enquiry' }).click()
  await expect(page.getByText('Your enquiry has not gone through')).toBeVisible()
  await expect(page.getByText('D07 X2Y3')).toBeVisible()

  // The retry reuses the idempotency key; only after the save does scheduling open.
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText(/Enquiry received. Your reference is Q3-/)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'How would you like to talk it through?' }),
  ).toBeVisible()
  expect(page.url()).toMatch(/#\/book\/tok-/)

  expect(bodies).toHaveLength(2)
  const [first, second] = bodies
  expect(second?.p_idempotency_key).toBe(first?.p_idempotency_key)
  expect(second).toMatchObject({
    p_form_id: 'enquiry',
    p_form_version: 1,
    p_marketing_opt_in: true,
    p_answers: {
      project_type: 'whole_home',
      rooms: ['kitchen', 'bedrooms'],
      location: 'D07 X2Y3',
      timing: 'flexible',
      name: 'Test Person',
      email: 'test@example.com',
      phone: '087 123 4567',
    },
    p_attribution: {
      utm_source: 'instagram',
      utm_medium: 'paid_social',
      click_id_present: true,
      landing_path: '/',
    },
  })
  expect(second?.p_answers).not.toHaveProperty('budget')

  // Nothing personal ever reached a URL.
  for (const url of urls) {
    expect(url).not.toContain('example.com')
    expect(url).not.toContain('Test')
    expect(url).not.toContain('D07')
  }
})
