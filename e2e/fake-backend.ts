import type { Page, Request } from '@playwright/test'
import { handlePublic, type PublicDeps } from '../supabase/functions/_shared/public-booking.ts'
import { FakeCalendar, FakeDb } from '../supabase/functions/_shared/testing/fakes.ts'

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
  const deps: PublicDeps = {
    db,
    calendar,
    accessToken: async () => 'access-token',
    mailer: { send: async () => 'msg_fake' },
    appUrl: 'https://q3.example',
    now,
  }
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
      db.addEnquiry(body.p_answers, token)
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

  await page.route('**/functions/v1/public-booking', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      })
      return
    }
    const result = await handlePublic(route.request().postDataJSON(), deps)
    await route.fulfill({
      status: result.status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(result.body),
    })
  })

  return { db, calendar, clock, submitBodies }
}

/** Fill the enquiry form with a whole-home project and send it. */
export async function submitEnquiry(page: Page) {
  await page.getByRole('radio', { name: 'Whole home renovation' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('What would you like done?').fill('New kitchen and two bedrooms redone.')
  await page.getByRole('checkbox', { name: 'Kitchen' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Eircode or area').fill('D07 X2Y3')
  await page.getByRole('radio', { name: 'I am flexible' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Your name').fill('Test Person')
  await page.getByLabel('Email').fill('test@example.com')
  await page.getByLabel('Phone').fill('087 123 4567')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Send enquiry' }).click()
}
