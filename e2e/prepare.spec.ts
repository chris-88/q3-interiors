import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { hasExif } from '../supabase/functions/_shared/jpeg.ts'
import { renderMessage } from '../supabase/functions/_shared/messages.ts'
import { EXIF_GPS } from '../supabase/functions/_shared/testing/jpeg-fixtures.ts'
import { installFakeBackend, submitEnquiry } from './fake-backend'

/*
 * Part B: "Help us prepare (optional)" after booking. Fake backend (the real public-booking logic
 * over in-memory stores); nothing reaches the stack. SCREENSHOTS_DIR keeps the screenshots.
 */

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const dir = process.env.SCREENSHOTS_DIR
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true })
}

/** A real camera-like JPEG drawn in the page, with an Exif GPS block inserted after SOI. */
async function cameraPhoto(page: Page, info: TestInfo, name: string, hue: number) {
  const base64 = await page.evaluate((h) => {
    const canvas = document.createElement('canvas')
    canvas.width = 3000
    canvas.height = 2250
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle = `hsl(${h} 30% 80%)`
    ctx.fillRect(0, 0, 3000, 2250)
    ctx.fillStyle = `hsl(${h} 25% 45%)`
    ctx.fillRect(400, 900, 2200, 1100)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(1200, 300, 600, 500)
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? ''
  }, hue)
  const plain = Buffer.from(base64, 'base64')
  const withGps = Buffer.concat([plain.subarray(0, 2), Buffer.from(EXIF_GPS), plain.subarray(2)])
  expect(hasExif(withGps)).toBe(true)
  const path = info.outputPath(name)
  await writeFile(path, withGps)
  return path
}

async function bookVisit(page: Page) {
  await submitEnquiry(page, 'on_site')
  await page.getByRole('group', { name: 'Suggested times' }).getByRole('button').first().click()
  await page.getByRole('button', { name: /^Book site visit · / }).click()
  await expect(page.getByRole('heading', { name: 'Your site visit is booked' })).toBeVisible()
}

test('after booking, the customer adds photos and answers; staff need no alert for each', async ({
  page,
}, info) => {
  const { db, photos, bookingBodies } = await installFakeBackend(page)
  await bookVisit(page)

  // The receipt offers it.
  const offer = page.getByRole('region', { name: 'Help us prepare (optional)' })
  await expect(offer).toBeVisible()
  await shot(page, '01-receipt-offer')
  await offer.getByRole('button', { name: 'Help us prepare' }).click()
  await expect(page.getByRole('heading', { name: 'Help us prepare (optional)' })).toBeFocused()
  await expect(
    page.getByText('A photo from the doorway helps us see the whole room.'),
  ).toBeVisible()
  await shot(page, '02-prepare-empty')

  // Two photos, the first one's upload interrupted.
  photos.failPuts = 1
  await page
    .getByLabel('Add photos')
    .setInputFiles([
      await cameraPhoto(page, info, 'kitchen.jpg', 30),
      await cameraPhoto(page, info, 'hall.jpg', 200),
    ])
  await expect(page.getByRole('alert')).toContainText(
    'The photo did not upload. Your booking is not affected.',
  )
  await expect(page.getByRole('img', { name: 'Your upload 1' })).toBeVisible()
  await shot(page, '04-upload-error')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('img', { name: 'Your upload 2' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  // What left the browser was resized and had no metadata; what was stored has none either.
  const sent = bookingBodies.filter((b) => b.action === 'add_photo')
  expect(sent).toHaveLength(3) // two photos, one retried with the same key
  // The queue moves on to the second photo; the retry reuses the first one's key.
  expect(sent[2]?.key).toBe(sent[0]?.key)
  for (const body of sent) {
    const bytes = Buffer.from(String(body.photo), 'base64')
    expect(hasExif(bytes)).toBe(false)
    expect(bytes.length).toBeLessThan(1_500_000)
  }
  expect(photos.files.size).toBe(2)
  for (const file of photos.files.values()) expect(hasExif(file)).toBe(false)
  expect(db.photos.every((p) => Math.max(p.width, p.height) === 2048)).toBe(true)

  // The budget question carries its hint, tied to the group for screen readers.
  const budget = page.getByRole('group', { name: /^Rough budget/ })
  await expect(budget).toHaveAccessibleDescription(
    'This helps us suggest what fits. It isn’t a commitment.',
  )
  // Answers save on their own.
  await page.getByRole('radio', { name: '€25,000 to €50,000' }).check()
  await expect(page.getByText('Saved').first()).toBeVisible()
  await page.getByRole('radio', { name: 'I’m flexible' }).check()
  await page.getByLabel(/Anything we should know to get in/).fill('Side gate, ring the bell')
  await page.getByRole('button', { name: 'Save notes' }).click()
  const news = page.getByRole('checkbox', { name: /news and offers/ })
  await expect(news).not.toBeChecked()
  await news.check()
  await expect(news).toBeChecked()
  await shot(page, '03-prepare-filled')

  // A reload shows what is saved.
  await page.reload()
  await page.getByRole('button', { name: 'Help us prepare' }).click()
  await expect(page.getByRole('img', { name: /^Your upload/ })).toHaveCount(2)
  await expect(page.getByRole('radio', { name: '€25,000 to €50,000' })).toBeChecked()
  await expect(page.getByLabel(/Anything we should know to get in/)).toHaveValue(
    'Side gate, ring the bell',
  )

  // Remove one: row and file go.
  await page.getByRole('button', { name: 'Remove upload 1' }).click()
  await expect(page.getByRole('img', { name: /^Your upload/ })).toHaveCount(1)
  expect(photos.files.size).toBe(1)

  const enquiryId = [...db.enquiries.keys()][0] ?? ''
  expect(db.prepare.get(enquiryId)).toMatchObject({
    answers: { budget: '25k_50k', timing: 'flexible' },
    marketing: true,
  })
  expect(db.enquiries.get(enquiryId)?.site_details?.access_notes).toBe('Side gate, ring the bell')
  expect(db.bookings[0]?.state).toBe('confirmed')
  // No staff email per addition (the history and the marker show it instead).
  expect(db.comms.filter((c) => c.template.startsWith('staff_'))).toEqual([])
  expect(db.events.filter((e) => e.kind === 'photo_added')).toHaveLength(2)
})

test('a photo the browser cannot read (HEIC elsewhere than Safari) is refused plainly', async ({
  page,
}) => {
  const { bookingBodies } = await installFakeBackend(page)
  await bookVisit(page)
  await page.getByRole('button', { name: 'Help us prepare' }).click()
  // An HEIF header; Chromium cannot decode it.
  await page.getByLabel('Add photos').setInputFiles({
    name: 'IMG_0001.heic',
    mimeType: 'image/heic',
    buffer: Buffer.from('000000186674797068656963000000006d696631686569630000', 'hex'),
  })
  await expect(page.getByRole('alert')).toContainText('We could not read this photo.')
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  expect(bookingBodies.filter((b) => b.action === 'add_photo')).toHaveLength(0)
})

test('the email link opens Help us prepare, and the confirmation email offers it', async ({
  page,
}) => {
  const { db } = await installFakeBackend(page)
  await bookVisit(page)
  await page.goto(`${page.url()}?do=prepare`)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Help us prepare (optional)' })).toBeVisible()

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
  expect(email.text).toContain(
    `Help us prepare (optional): ${origin}/#/book/example-token?do=prepare`,
  )
  await page.setContent(email.html)
  await expect(page.getByRole('link', { name: 'Help us prepare (optional)' })).toHaveAttribute(
    'href',
    `${origin}/#/book/example-token?do=prepare`,
  )
  await shot(page, '07-email')
})

test('the privacy notice says what photos are for and that they go with the enquiry', async ({
  page,
}) => {
  await installFakeBackend(page)
  await page.goto('/#/privacy')
  const line = page.getByText(/Photos you choose to add after booking/)
  await expect(line).toContainText('deleted with your enquiry')
  await line.scrollIntoViewIfNeeded()
  await shot(page, '06-privacy')
})
