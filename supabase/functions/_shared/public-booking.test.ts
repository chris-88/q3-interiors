import { accessTokenProvider, eventFor, processCalendarJob } from './calendar-job.ts'
import {
  createResendMailer,
  isSuppressed,
  processCommunication,
  type Mailer,
  type OutgoingEmail,
} from './email.ts'
import { GoogleError } from './google.ts'
import { handlePublic, type PublicDeps } from './public-booking.ts'
import { encryptSecret, decryptSecret } from './crypto.ts'
import { FakeCalendar, FakeDb } from './testing/fakes.ts'
import { fromLocal } from './time.ts'

// Monday 1 March 2027, 08:00 Dublin. With 24h notice the first slot is Tuesday 09:00.
let clock = Date.parse('2027-03-01T08:00:00Z')
const now = () => clock
const TUESDAY_10 = new Date(fromLocal('2027-03-02', 600)!).toISOString()

const answers = (email = 'customer@example.com') => ({
  project_type: 'kitchen',
  description: 'New kitchen units.',
  location: 'D07',
  timing: 'flexible',
  name: 'Mary Byrne',
  email,
  phone: '087 123 4567',
})

class RecordingMailer implements Mailer {
  sent: OutgoingEmail[] = []
  fail: Error | null = null
  async send(email: OutgoingEmail) {
    if (this.fail) throw this.fail
    this.sent.push(email)
    return `msg_${this.sent.length}`
  }
}

function setup() {
  clock = Date.parse('2027-03-01T08:00:00Z')
  const db = new FakeDb(now)
  const calendar = new FakeCalendar()
  const mailer = new RecordingMailer()
  const deps: PublicDeps = {
    db,
    calendar,
    accessToken: accessTokenProvider(db, calendar, ''),
    mailer,
    appUrl: 'https://q3.example',
    now,
  }
  // The fake ciphertext is not real; bypass decryption for unit tests.
  deps.accessToken = async () => calendar.refreshAccessToken()
  return { db, calendar, mailer, deps }
}

const TOKEN_A = 'token-a-0123456789abcdefghij'
const TOKEN_B = 'token-b-0123456789abcdefghij'
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
type Body = Record<string, unknown> & {
  status?: string
  booking?: { state: string; id: string } | null
}
const call = async (deps: PublicDeps, req: Record<string, unknown>) => {
  const res = await handlePublic(req, deps)
  return { status: res.status, body: res.body as Body }
}

describe('public booking: access', () => {
  it('refuses unknown and expired tokens', async () => {
    const { db, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A, { expiresAt: clock - 1 })
    expect(
      (await call(deps, { action: 'context', token: 'nope-nope-nope-nope-nope' })).status,
    ).toBe(401)
    expect((await call(deps, { action: 'context', token: TOKEN_A })).status).toBe(401)
  })

  it('rejects malformed requests', async () => {
    const { deps } = setup()
    expect((await call(deps, { action: 'book', token: TOKEN_A })).status).toBe(400)
    expect((await call(deps, { action: 'drop_tables', token: TOKEN_A })).status).toBe(400)
  })

  it('never lets one enquiry act on another enquiry’s booking', async () => {
    const { db, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    db.addEnquiry(answers(), TOKEN_B)
    const a = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(1),
    })
    expect(a.body.status).toBe('booked')
    // B replays A's idempotency key: refused, and B sees no booking of its own.
    const b = await call(deps, {
      action: 'book',
      token: TOKEN_B,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(1),
    })
    expect(b.status).toBe(403)
    expect((await call(deps, { action: 'status', token: TOKEN_B })).body.booking).toBeNull()
  })
})

describe('public booking: availability', () => {
  it('offers slots when the calendar is connected', async () => {
    const { db, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    const res = await call(deps, {
      action: 'availability',
      token: TOKEN_A,
      typeId: 'phone_consultation',
    })
    expect(res.body.status).toBe('ok')
    expect((res.body.slots as { start: string }[])[0]?.start).toBe('2027-03-02T09:00:00.000Z')
  })

  it('treats a failed free/busy query as unavailable, never free', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    calendar.script.freeBusyError = new GoogleError('transient', 'backend error', 503)
    const res = await call(deps, {
      action: 'availability',
      token: TOKEN_A,
      typeId: 'phone_consultation',
    })
    expect(res.body).toEqual({ status: 'unavailable', reason: 'calendar_error' })
    expect(db.calendarErrors).toHaveLength(1)
    const book = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(2),
    })
    expect(book.body.status).toBe('unavailable')
    expect(db.bookings).toHaveLength(0)
  })

  it('reports a disconnected calendar truthfully and marks it for staff', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    calendar.script.refreshError = new GoogleError('auth', 'invalid_grant')
    deps.accessToken = accessTokenProvider(db, calendar, '')
    db.tokenCiphertext = await encryptSecret('refresh', btoa('k'.repeat(32)))
    deps.accessToken = accessTokenProvider(db, calendar, btoa('k'.repeat(32)))
    const res = await call(deps, {
      action: 'availability',
      token: TOKEN_A,
      typeId: 'phone_consultation',
    })
    expect(res.body).toEqual({ status: 'unavailable', reason: 'calendar_unavailable' })
    expect(db.connection?.status).toBe('disconnected')
    const ctx = await call(deps, { action: 'context', token: TOKEN_A })
    expect(ctx.body.calendarAvailable).toBe(false)
  })

  it('lets the customer ask to be contacted instead', async () => {
    const { db, deps } = setup()
    const id = db.addEnquiry(answers(), TOKEN_A)
    await call(deps, { action: 'request_contact', token: TOKEN_A, reason: 'No suitable time' })
    expect(db.enquiries.get(id)?.contact_requested_at).not.toBeNull()
    expect(db.events.some((e) => e.kind === 'contact_requested')).toBe(true)
  })
})

describe('public booking: booking', () => {
  it('books, creates one calendar event, confirms and emails once', async () => {
    const { db, calendar, mailer, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    const res = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(3),
    })
    expect(res.body.status).toBe('booked')
    expect(res.body.booking).toMatchObject({
      state: 'confirmed',
      staffFirstName: 'Pat',
      phone: '087 123 4567',
      timezone: 'Europe/Dublin',
    })
    expect(calendar.events.size).toBe(1)
    // customer@example.com is a reserved test domain: recorded, never sent.
    expect(mailer.sent).toHaveLength(0)
    expect(db.comms[0]?.state).toBe('skipped')
  })

  it('a double tap or retry with the same key returns the same booking', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers('mary@q3-test-customer.ie'), TOKEN_A)
    const req = {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(4),
    }
    const [first, second] = await Promise.all([call(deps, req), call(deps, req)])
    const third = await call(deps, req)
    expect(
      new Set([first.body.booking?.id, second.body.booking?.id, third.body.booking?.id]).size,
    ).toBe(1)
    expect(db.bookings).toHaveLength(1)
    expect(calendar.events.size).toBe(1)
    expect(db.comms.filter((c) => c.template === 'booking_confirmation')).toHaveLength(1)
  })

  it('two customers racing for one slot: one wins, the other gets fresh alternatives', async () => {
    const { db, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    db.addEnquiry(answers(), TOKEN_B)
    const [a, b] = await Promise.all([
      call(deps, {
        action: 'book',
        token: TOKEN_A,
        typeId: 'phone_consultation',
        start: TUESDAY_10,
        idempotencyKey: key(5),
      }),
      call(deps, {
        action: 'book',
        token: TOKEN_B,
        typeId: 'phone_consultation',
        start: TUESDAY_10,
        idempotencyKey: key(6),
      }),
    ])
    const statuses = [a.body.status, b.body.status].sort()
    expect(statuses).toEqual(['booked', 'slot_unavailable'])
    const loser = a.body.status === 'booked' ? b : a
    const alternatives = loser.body.alternatives as { start: string }[]
    expect(alternatives.length).toBeGreaterThan(0)
    expect(alternatives.map((s) => s.start)).not.toContain(TUESDAY_10)
    // The phone call plus its 10-minute buffer blocks 10:00-10:30, so 10:30 is the next offer.
    expect(alternatives[0]?.start).toBe(new Date(fromLocal('2027-03-02', 630)!).toISOString())
  })

  it('refuses a slot that is no longer free in Google and offers alternatives', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    calendar.busy = [{ start: Date.parse(TUESDAY_10), end: Date.parse(TUESDAY_10) + 3_600_000 }]
    const res = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(7),
    })
    expect(res.body.status).toBe('slot_unavailable')
    expect(db.bookings).toHaveLength(0)
  })

  it('requires the site address before an on-site visit', async () => {
    const { db, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    const before = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'site_visit',
      start: TUESDAY_10,
      idempotencyKey: key(8),
    })
    expect(before.body).toEqual({ status: 'ineligible', reason: 'site_address_required' })
    expect(
      (await call(deps, { action: 'site_details', token: TOKEN_A, answers: { site_address: 'x' } }))
        .status,
    ).toBe(400)
    await call(deps, {
      action: 'site_details',
      token: TOKEN_A,
      answers: { site_address: '12 Example Road, Dublin 7' },
    })
    const after = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'site_visit',
      start: TUESDAY_10,
      idempotencyKey: key(9),
    })
    expect(after.body.booking).toMatchObject({
      state: 'confirmed',
      address: '12 Example Road, Dublin 7',
      phone: null,
    })
  })
})

describe('public booking: form v2 details', () => {
  const v2 = {
    appointment_preference: 'phone',
    project_type: 'kitchen',
    location: 'Dublin 8',
    name: 'Mary Byrne',
    email: 'customer@example.com',
    phone: '087 123 4567',
  }

  it('gives the time screen the preference, number and town', async () => {
    const { db, deps } = setup()
    db.addEnquiry(v2, TOKEN_A)
    const ctx = await call(deps, { action: 'context', token: TOKEN_A })
    expect(ctx.body).toMatchObject({
      preference: 'phone',
      phone: '087 123 4567',
      location: 'Dublin 8',
      siteAddress: null,
    })
    db.addEnquiry(answers(), TOKEN_B)
    expect((await call(deps, { action: 'context', token: TOKEN_B })).body.preference).toBeNull()
  })

  it('switches a call to a visit with the street and carries the town forward', async () => {
    const { db, deps } = setup()
    db.addEnquiry(v2, TOKEN_A)
    const missing = await call(deps, {
      action: 'update_details',
      token: TOKEN_A,
      details: { appointment_preference: 'on_site' },
    })
    expect(missing.status).toBe(400)
    const saved = await call(deps, {
      action: 'update_details',
      token: TOKEN_A,
      details: {
        appointment_preference: 'on_site',
        site_street: '4 Sample Street',
        phone: '01 234 5678',
      },
    })
    expect(saved.body).toEqual({ status: 'saved' })
    const ctx = await call(deps, { action: 'context', token: TOKEN_A })
    expect(ctx.body).toMatchObject({
      preference: 'on_site',
      phone: '01 234 5678',
      siteAddress: '4 Sample Street, Dublin 8',
    })
    const booked = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'site_visit',
      start: TUESDAY_10,
      idempotencyKey: key(30),
    })
    expect(booked.body.booking).toMatchObject({ address: '4 Sample Street, Dublin 8' })
    // Once booked, the details are fixed here (the calendar event carries them).
    const late = await call(deps, {
      action: 'update_details',
      token: TOKEN_A,
      details: { phone: '087 000 0000' },
    })
    expect(late.status).toBe(409)
  })

  it('refuses unknown or empty details', async () => {
    const { db, deps } = setup()
    db.addEnquiry(v2, TOKEN_A)
    for (const details of [{}, { email: 'x@example.com' }, { appointment_preference: 'video' }]) {
      expect((await call(deps, { action: 'update_details', token: TOKEN_A, details })).status).toBe(
        400,
      )
    }
  })
})

describe('calendar event creation', () => {
  it('a timeout after Google created the event is reconciled, not duplicated', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    calendar.script.insertError = {
      error: new GoogleError('timeout', 'no answer'),
      createAnyway: true,
    }
    const res = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(10),
    })
    expect(res.body.booking?.state).toBe('calendar_pending')
    expect(db.jobs[0]).toMatchObject({ state: 'queued', outcome_unknown: true })

    // Status polling before the retry is due changes nothing.
    expect((await call(deps, { action: 'status', token: TOKEN_A })).body.booking?.state).toBe(
      'calendar_pending',
    )

    clock += 31_000
    const after = await call(deps, { action: 'status', token: TOKEN_A })
    expect(after.body.booking?.state).toBe('confirmed')
    expect(calendar.events.size).toBe(1)
    expect(calendar.insertCalls).toBe(1)
  })

  it('a duplicate-id conflict confirms against the existing event', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    await db.reserve([...db.enquiries.keys()][0]!, 'phone_consultation', TUESDAY_10, key(11))
    const booking = db.bookings[0]!
    // Simulate an event that exists but whose read raced: pre-create it, and make the first read miss.
    calendar.events.set(booking.calendar_event_id, {
      id: booking.calendar_event_id,
      summary: '',
      description: '',
      start: booking.starts_at,
      end: booking.ends_at,
      timeZone: 'Europe/Dublin',
      status: 'confirmed',
    })
    const realGet = calendar.getEvent.bind(calendar)
    let reads = 0
    calendar.getEvent = async (...args) => (++reads === 1 ? null : realGet(...args))
    const [job] = await db.claimCalendarJobs(1)
    const outcome = await processCalendarJob(job!, {
      db,
      calendar,
      accessToken: deps.accessToken,
      appUrl: deps.appUrl,
    })
    expect(outcome).toBe('confirmed')
    expect(calendar.events.size).toBe(1)
  })

  it('a definitive failure releases the slot and is visible, with the outcome known', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    db.addEnquiry(answers(), TOKEN_B)
    calendar.script.insertError = {
      error: new GoogleError('permanent', 'HTTP 400 bad request', 400),
      createAnyway: false,
    }
    const res = await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(12),
    })
    expect(res.body.booking?.state).toBe('failed')
    expect(db.jobs[0]).toMatchObject({ state: 'failed', outcome_unknown: false })
    expect(db.events.some((e) => e.kind === 'booking_failed')).toBe(true)
    // The slot is free again, for another customer or for this one.
    const again = await call(deps, {
      action: 'book',
      token: TOKEN_B,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(13),
    })
    expect(again.body.booking?.state).toBe('confirmed')
  })

  it('gives up after the last attempt and records that the event may exist', async () => {
    const { db, calendar, deps } = setup()
    db.addEnquiry(answers(), TOKEN_A)
    calendar.script.insertError = {
      error: new GoogleError('transient', '503'),
      createAnyway: false,
      times: 100,
    }
    await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(14),
    })
    for (let i = 0; i < 10; i += 1) {
      clock += 3_600_000
      await call(deps, { action: 'status', token: TOKEN_A })
    }
    expect(db.jobs[0]).toMatchObject({ state: 'failed', outcome_unknown: true, attempts: 8 })
    expect(db.bookings[0]?.state).toBe('failed')
  })

  it('puts what the visit needs in the event and nothing more', () => {
    const { db } = setup()
    const id = db.addEnquiry(answers(), TOKEN_A, {
      siteDetails: { site_address: '12 Example Road', access_notes: 'Side gate' },
    })
    const event = eventFor(
      {
        booking: {
          id: 'b',
          enquiry_id: id,
          staff_user_id: 's',
          appointment_type_id: 'site_visit',
          starts_at: TUESDAY_10,
          ends_at: TUESDAY_10,
          state: 'reserved',
          calendar_event_id: 'q3abc',
          idempotency_key: 'k',
          created_at: '',
        },
        type: db.types[1]!,
        enquiry: {
          id,
          reference: 'Q3-ABCDEF',
          answers: answers(),
          site_details: { site_address: '12 Example Road', access_notes: 'Side gate' },
        },
        staff: { user_id: 's', display_name: 'Pat' },
        connection: null,
      },
      'https://q3.example',
    )
    expect(event.id).toBe('q3abc')
    expect(event.summary).toContain('Q3-ABCDEF')
    expect(event.location).toBe('12 Example Road')
    expect(event.description).toContain('087 123 4567')
    expect(event.description).toContain('Side gate')
    expect(event.description).toContain(`https://staff.q3interiors.ie/#/enquiries/${id}`)
    expect(event.description).not.toContain('customer@example.com')
    expect(event.description).not.toContain('New kitchen units')
  })
})

describe('email', () => {
  it('sends once per dedupe key, with the key as the provider idempotency key', async () => {
    const { db, deps } = setup()
    db.addEnquiry(answers('mary@q3-test-customer.ie'), TOKEN_A)
    await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(20),
    })
    const mailer = deps.mailer as RecordingMailer
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.idempotencyKey).toMatch(/^booking_confirmation:/)
    expect(mailer.sent[0]?.text).toContain('(Irish time)')
    expect(mailer.sent[0]?.text).toContain('Pat will ring you on 087 123 4567')
    // Completing the job again does not queue a second email.
    await db.completeCalendarJob(1, null)
    expect(db.comms.filter((c) => c.template === 'booking_confirmation')).toHaveLength(1)
  })

  it('retries a failed send and records a final failure', async () => {
    const { db, deps } = setup()
    const mailer = deps.mailer as RecordingMailer
    mailer.fail = new Error('provider down')
    db.addEnquiry(answers('mary@q3-test-customer.ie'), TOKEN_A)
    await call(deps, {
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: TUESDAY_10,
      idempotencyKey: key(21),
    })
    expect(db.comms[0]?.state).toBe('queued')
    for (let i = 0; i < 6; i += 1) {
      clock += 3_600_000
      const [c] = await db.claimCommunications(1)
      if (c) await processCommunication(c, { db, mailer, appUrl: 'https://q3.example' })
    }
    expect(db.comms[0]?.state).toBe('failed')
    expect(db.events.some((e) => e.kind === 'email_failed')).toBe(true)
  })

  it('suppresses reserved test domains', () => {
    expect(isSuppressed('a@example.com')).toBe(true)
    expect(isSuppressed('a@foo.invalid')).toBe(true)
    expect(isSuppressed('someone@gmail.com')).toBe(false)
  })

  it('posts to Resend with an Idempotency-Key header', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const mailer = createResendMailer({
      apiKey: 'k',
      from: 'Q3 <q3@x.test>',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response('{"id":"msg_1"}', { status: 200 })
      }) as typeof fetch,
    })
    expect(
      await mailer.send({
        to: 'a@b.ie',
        subject: 's',
        text: 't',
        idempotencyKey: 'booking_confirmation:1',
      }),
    ).toBe('msg_1')
    expect(new Headers(calls[0]?.init.headers).get('Idempotency-Key')).toBe(
      'booking_confirmation:1',
    )
  })
})

describe('token encryption', () => {
  it('round-trips and does not leak the plaintext', async () => {
    const k = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    const ct = await encryptSecret('1//refresh-token', k)
    expect(ct).not.toContain('refresh')
    expect(await decryptSecret(ct, k)).toBe('1//refresh-token')
  })
})
