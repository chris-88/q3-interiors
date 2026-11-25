import type { Page, Request } from '@playwright/test'
import { handlePublic, type PublicDeps } from '../supabase/functions/_shared/public-booking.ts'
import {
  FakeCalendar,
  FakeDb,
  FakePhotoStore,
} from '../supabase/functions/_shared/testing/fakes.ts'
import { composeSiteAddress } from '../src/forms/enquiry/v2.ts'

export type SubmitBody = {
  p_idempotency_key: string
  p_form_id: string
  p_form_version: number
  p_answers: Record<string, string | string[]>
  p_marketing_opt_in: boolean
  p_attribution: Record<string, unknown> | null
  p_trap?: string | null
}

/**
 * Stands in for the backend in the browser tests: the submission RPC and the real
 * `public-booking` logic running in Node over an in-memory database and a fake Google Calendar.
 * Nothing reaches the real stack or Google.
 */
export async function installFakeBackend(
  page: Page,
  opts: { failFirstSubmit?: boolean; limitSubmit?: boolean } = {},
) {
  const clock = { offset: 0 }
  const now = () => Date.now() + clock.offset
  const db = new FakeDb(now)
  const calendar = new FakeCalendar()
  const photos = new FakePhotoStore()
  const deps: PublicDeps = {
    db,
    calendar,
    accessToken: async () => 'access-token',
    mailer: { send: async () => 'msg_fake' },
    appUrl: 'https://q3.example',
    now,
    photos,
  }
  /** Every public-booking request body, in order (to check what left the browser). */
  const bookingBodies: Record<string, unknown>[] = []
  // Safety net: anything else bound for a real Supabase backend fails instead of writing to it.
  // (Playwright matches the most recently registered route first, so the routes below win.)
  await page.route(/\/(rest|auth|functions|storage)\/v1\//, (route) =>
    route.abort('blockedbyclient'),
  )

  const submitBodies: SubmitBody[] = []
  const byKey = new Map<string, { reference: string; token: string }>()
  let submits = 0

  await page.route('**/rest/v1/rpc/submit_enquiry_with_access', async (route) => {
    const body = (route.request() as Request).postDataJSON() as SubmitBody
    submitBodies.push(body)
    submits += 1
    if (opts.failFirstSubmit && submits === 1) {
      await route.abort('internetdisconnected')
      return
    }
    if (opts.limitSubmit) {
      // What PostgREST returns for `raise sqlstate 'PT429'`.
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PT429', message: 'rate_limited', details: null, hint: null }),
      })
      return
    }
    if (body.p_trap) {
      // Honeypot: a normal-looking reply, nothing stored.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reference: 'Q3-BOT234', access_token: null, expires_at: null }),
      })
      return
    }
    let saved = byKey.get(body.p_idempotency_key)
    if (!saved) {
      const token = `tok-${body.p_idempotency_key}`
      // As submit_enquiry_with_access does: a v2 visit's address lines become its site details.
      const a = body.p_answers as Record<string, string | undefined>
      db.addEnquiry(
        body.p_answers,
        token,
        a.site_street
          ? {
              siteDetails: {
                site_address: composeSiteAddress(a.site_street, a.site_unit, a.location),
              },
            }
          : {},
      )
      const id = [...db.enquiries.keys()].at(-1) ?? ''
      saved = { reference: db.enquiries.get(id)?.reference ?? 'Q3-TEST00', token }
      byKey.set(body.p_idempotency_key, saved)
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reference: saved.reference,
        access_token: saved.token,
        expires_at: '2099-01-01T00:00:00Z',
      }),
    })
  })

  // The landing page's live durations, from the fake database's active types.
  await page.route('**/rest/v1/rpc/public_appointment_types', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        db.types
          .filter((t) => t.active)
          .map((t) => ({ id: t.id, mode: t.mode, duration_minutes: t.duration_minutes })),
      ),
    })
  })

  await page.route('**/functions/v1/public-booking', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      })
      return
    }
    const body = route.request().postDataJSON() as Record<string, unknown>
    bookingBodies.push(body)
    const result = await handlePublic(body, deps)
    await route.fulfill({
      status: result.status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(result.body),
    })
  })

  return { db, calendar, clock, submitBodies, photos, bookingBodies }
}

export type Route = 'phone' | 'on_site'

/** Forward action 1: tap a choice on the landing page. */
export async function startRoute(page: Page, route: Route = 'phone') {
  await page.goto('/#/')
  await page.getByRole('link', { name: route === 'phone' ? /^Phone call/ : /^Site visit/ }).click()
  await page.getByRole('heading', { name: 'What work are you planning?' }).waitFor()
}

/** The Project screen: a whole-home project and a town; forward action 2. */
export async function fillProject(page: Page, location = 'D07 X2Y3') {
  await page.getByRole('radio', { name: 'Whole home renovation' }).check()
  await page.getByLabel('Town or Eircode').fill(location)
  await page.getByRole('button', { name: 'Continue to your details' }).click()
  await page.getByRole('heading', { name: 'How can we reach you?' }).waitFor()
}

/** The Details screen, without sending. */
export async function fillDetails(page: Page, route: Route = 'phone') {
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page
    .getByLabel(route === 'phone' ? 'Number we should ring' : 'Number we can ring on arrival')
    .fill('087 123 4567')
  if (route === 'on_site') {
    await page.getByLabel('House name or number and street').fill('12 Example Road')
  }
}

/** Landing to "Send enquiry & see times" (forward actions 1 to 3). */
export async function submitEnquiry(page: Page, route: Route = 'phone') {
  await startRoute(page, route)
  await fillProject(page)
  await fillDetails(page, route)
  await page.getByRole('button', { name: 'Send enquiry & see times' }).click()
}
