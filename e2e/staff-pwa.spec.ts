import { expect, test } from '@playwright/test'
import { installFakeStaff, PUBLIC_URL } from './fake-staff'

test.use({ serviceWorkers: 'allow' })

test('the staff build is installable: manifest, icons and a shell-only service worker', async ({
  page,
  request,
}) => {
  await installFakeStaff(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe('/')

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe('/manifest.webmanifest')
  const res = await request.get(href ?? '')
  expect(res.ok()).toBe(true)
  const manifest = (await res.json()) as {
    name: string
    short_name: string
    display: string
    start_url: string
    scope: string
    icons: { src: string; sizes: string; purpose: string }[]
  }
  expect(manifest).toMatchObject({
    name: 'Q3 Interiors Staff',
    short_name: 'Q3 Staff',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  })
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
  expect(manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true)

  // The worker never caches another origin: nothing from the API ends up in a cache.
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url)
    }
    return urls
  })
  expect(cached.length).toBeGreaterThan(5)
  expect(cached.every((u) => new URL(u).origin === new URL(page.url()).origin)).toBe(true)
  expect(cached.some((u) => /\/(rest|auth|functions|storage)\/v1\//.test(u))).toBe(false)
})

test('offline, the console says so instead of showing anything stale', async ({
  page,
  context,
}) => {
  await installFakeStaff(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
})

test('the customer build has no manifest and no service worker', async ({ page, request }) => {
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, (route) => route.abort())
  await page.goto(`${PUBLIC_URL}/#/`)
  await expect(
    page.getByRole('heading', { name: 'Let’s talk about your renovation.' }),
  ).toBeVisible()
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0)
  // (vite preview answers unknown paths with the page itself; there is no worker script.)
  expect(await (await request.get(`${PUBLIC_URL}/sw.js`)).text()).not.toContain('q3-staff-shell')
})
