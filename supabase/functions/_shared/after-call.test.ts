import { describe, expect, it } from 'vitest'
import { processCommunication, visitLinkUrl, type Mailer, type OutgoingEmail } from './email.ts'
import { renderEstimate, renderVisitLink, WORDING } from './messages.ts'
import { handleStaff } from './staff-booking.ts'
import type { ChangeDeps } from './changes.ts'
import { FakeCalendar, FakeDb } from './testing/fakes.ts'
import { fromLocal } from './time.ts'

// Monday 1 March 2027, 08:00 Dublin; the first site visit slot is after the notice period.
let clock = Date.parse('2027-03-01T08:00:00Z')
const now = () => clock
const STAFF = '00000000-0000-4000-8000-000000000001'

class RecordingMailer implements Mailer {
  sent: OutgoingEmail[] = []
  async send(email: OutgoingEmail) {
    this.sent.push(email)
    return `msg_${this.sent.length}`
  }
}

const answers = (over: Record<string, string> = {}) => ({
  appointment_preference: 'phone',
  project_type: 'kitchen',
  location: 'Dublin 8',
  name: 'Mary Byrne',
  email: 'mary@customer.ie',
  phone: '087 123 4567',
  ...over,
})

function setup() {
  clock = Date.parse('2027-03-01T08:00:00Z')
  const db = new FakeDb(now)
  const calendar = new FakeCalendar()
  const mailer = new RecordingMailer()
  const deps: ChangeDeps = {
    db,
    calendar,
    accessToken: async () => calendar.refreshAccessToken(),
    mailer,
    appUrl: 'https://q3.example',
    now,
  }
  return { db, mailer, deps }
}

type Body = Record<string, unknown> & { status?: string; slots?: { start: string }[] }
const staff = async (deps: ChangeDeps, req: Record<string, unknown>) => {
  const res = await handleStaff(req, STAFF, deps)
  return { status: res.status, body: res.body as Body }
}
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('staff book the site visit after a call', () => {
  it('offers the free site visit times, and says when the address is missing', async () => {
    const { db, deps } = setup()
    const id = db.addEnquiry(answers(), 'token-a-0123456789abcdefghij')
    const options = await staff(deps, { action: 'visit_options', enquiryId: id })
    expect(options.body.status).toBe('ok')
    expect(options.body.slots?.length).toBeGreaterThan(0)
    expect(options.body.eligibility).toBe('site_address_required')
    expect(options.body.siteAddress).toBeNull()
  })

  it('books it with the address staff typed; the customer gets the normal confirmation', async () => {
    const { db, mailer, deps } = setup()
    const id = db.addEnquiry(answers(), 'token-a-0123456789abcdefghij')
    // The call happened and was marked attended: it no longer blocks a new booking.
    const callStart = new Date(fromLocal('2027-03-02', 600)!).toISOString()
    const reserved = await db.reserve(id, 'phone_consultation', callStart, key(1))
    if (reserved.status !== 'reserved') throw new Error(reserved.status)
    const call = db.bookings.find((b) => b.id === reserved.booking_id)!
    call.state = 'confirmed'
    clock = Date.parse('2027-03-03T08:00:00Z')
    call.attendance = 'attended'

    const options = await staff(deps, { action: 'visit_options', enquiryId: id })
    const slot = options.body.slots?.[0]?.start
    if (!slot) throw new Error('no slot')
    const noAddress = await staff(deps, {
      action: 'book_visit',
      enquiryId: id,
      start: slot,
      idempotencyKey: key(2),
    })
    expect(noAddress.body).toEqual({ status: 'ineligible', reason: 'site_address_required' })

    const booked = await staff(deps, {
      action: 'book_visit',
      enquiryId: id,
      start: slot,
      idempotencyKey: key(3),
      siteStreet: '12 Example Road',
    })
    expect(booked.body.status).toBe('booked')
    const visit = db.bookings.find((b) => b.id === booked.body.bookingId)!
    expect(visit.appointment_type_id).toBe('site_visit')
    expect(visit.state).toBe('confirmed')
    expect(db.enquiries.get(id)?.site_details?.site_address).toBe('12 Example Road, Dublin 8')
    expect(db.events.filter((e) => e.kind === 'visit_booked_by_staff')).toHaveLength(1)
    const confirmation = mailer.sent.find((m) => m.to === 'mary@customer.ie')
    expect(confirmation?.text).toContain('/#/book/minted-')

    // A repeat with the same key is the same booking.
    const again = await staff(deps, {
      action: 'book_visit',
      enquiryId: id,
      start: slot,
      idempotencyKey: key(3),
    })
    expect(again.body).toEqual({ status: 'booked', bookingId: visit.id })
  })

  it('refuses a time that is not free', async () => {
    const { db, deps } = setup()
    const id = db.addEnquiry(answers(), 'token-a-0123456789abcdefghij', {
      siteDetails: { site_address: '1 Test Street, Dublin 8' },
    })
    const res = await staff(deps, {
      action: 'book_visit',
      enquiryId: id,
      start: '2027-03-01T03:00:00Z',
      idempotencyKey: key(4),
    })
    expect(res.body.status).toBe('slot_unavailable')
  })
})

describe('staff book a call for the customer', () => {
  it('offers the free call times and books one through the reserve path', async () => {
    const { db, mailer, deps } = setup()
    const id = db.addEnquiry(answers(), 'token-a-0123456789abcdefghij')
    const options = await staff(deps, { action: 'call_options', enquiryId: id })
    expect(options.body.status).toBe('ok')
    expect(options.body.eligibility).toBe('eligible')
    const slot = options.body.slots?.[0]?.start
    if (!slot) throw new Error('no slot')

    const booked = await staff(deps, {
      action: 'book_call',
      enquiryId: id,
      start: slot,
      idempotencyKey: key(20),
    })
    expect(booked.body.status).toBe('booked')
    const call = db.bookings.find((b) => b.id === booked.body.bookingId)!
    expect(call.appointment_type_id).toBe('phone_consultation')
    expect(call.state).toBe('confirmed')
    expect(db.events.filter((e) => e.kind === 'call_booked_by_staff')).toHaveLength(1)
    // The normal confirmation email with its manage link.
    const confirmation = mailer.sent.find((m) => m.to === 'mary@customer.ie')
    expect(confirmation?.subject).toMatch(/^Booked: your call on /)
    expect(confirmation?.text).toContain('/#/book/minted-')

    // The same key is the same booking; another call while this one is to come is refused.
    const again = await staff(deps, {
      action: 'book_call',
      enquiryId: id,
      start: slot,
      idempotencyKey: key(20),
    })
    expect(again.body).toEqual({ status: 'booked', bookingId: call.id })
    const second = await staff(deps, {
      action: 'book_call',
      enquiryId: id,
      start: options.body.slots?.[1]?.start ?? slot,
      idempotencyKey: key(21),
    })
    expect(second.body).toEqual({ status: 'already_booked' })
    expect((await staff(deps, { action: 'call_options', enquiryId: id })).body).toEqual({
      status: 'already_booked',
    })
  })

  it('refuses a time that is not free, and an enquiry without a phone number', async () => {
    const { db, deps } = setup()
    const id = db.addEnquiry(answers(), 'token-a-0123456789abcdefghij')
    const taken = await staff(deps, {
      action: 'book_call',
      enquiryId: id,
      start: '2027-03-01T03:00:00Z',
      idempotencyKey: key(22),
    })
    expect(taken.body.status).toBe('slot_unavailable')
    const noPhone = db.addEnquiry(answers({ phone: '' }), 'token-b-0123456789abcdefghij')
    const options = await staff(deps, { action: 'call_options', enquiryId: noPhone })
    expect(options.body.eligibility).toBe('phone_required')
    const slot = options.body.slots?.[0]?.start ?? '2027-03-02T10:00:00Z'
    const refused = await staff(deps, {
      action: 'book_call',
      enquiryId: noPhone,
      start: slot,
      idempotencyKey: key(23),
    })
    expect(refused.body).toEqual({ status: 'ineligible', reason: 'phone_required' })
  })

  it('needs an enquiry that exists and a well-formed request', async () => {
    const { deps } = setup()
    expect((await staff(deps, { action: 'call_options', enquiryId: key(99) })).status).toBe(404)
    expect((await staff(deps, { action: 'book_call', enquiryId: 'x' })).status).toBe(400)
  })
})

describe('the site visit link', () => {
  const queue = (db: FakeDb, enquiryId: string) => {
    const comm = {
      id: `c${db.comms.length + 1}`,
      enquiry_id: enquiryId,
      booking_id: null,
      template: 'visit_link' as const,
      recipient: 'mary@customer.ie',
      dedupe_key: `visit_link:${enquiryId}:1`,
      attempts: 1,
      max_attempts: 6,
      state: 'sending',
      next_attempt_at: 0,
      provider_message_id: null,
      last_error: null,
    }
    db.comms.push(comm)
    return comm
  }

  it('emails a fresh token link that opens on the site visit time step', async () => {
    const { db, mailer, deps } = setup()
    const id = db.addEnquiry(answers(), 'token-a-0123456789abcdefghij')
    const result = await processCommunication(queue(db, id), {
      db,
      mailer: deps.mailer!,
      appUrl: deps.appUrl,
      now,
    })
    expect(result).toBe('sent')
    const mail = mailer.sent[0]!
    expect(mail.subject).toBe('Book your site visit with Q3 Interiors')
    expect(mail.text).toContain('https://q3.example/#/book/minted-1-0123456789abcdefghij?visit=1')
    expect(mail.text).toContain('Hello Mary,')
  })

  it('is not sent once a visit is booked', async () => {
    const { db, mailer, deps } = setup()
    const id = db.addEnquiry(answers(), 'token-a-0123456789abcdefghij', {
      siteDetails: { site_address: '1 Test Street, Dublin 8' },
    })
    const start = new Date(fromLocal('2027-03-03', 600)!).toISOString()
    await db.reserve(id, 'site_visit', start, key(5))
    const result = await processCommunication(queue(db, id), {
      db,
      mailer: deps.mailer!,
      appUrl: deps.appUrl,
      now,
    })
    expect(result).toBe('skipped')
    expect(mailer.sent).toHaveLength(0)
  })

  it('reads as Chris asked, in both parts', () => {
    const m = renderVisitLink({
      customerName: 'Mary Byrne',
      bookUrl: visitLinkUrl('https://q3.example', 'tok'),
      businessPhone: '01 555 0100',
    })
    expect(m.text).toBe(
      [
        'Hello Mary,',
        'Thanks for the call. The next step is a site visit so we can look at the space and price the work. Pick a time that suits you.',
        'Book my site visit: https://q3.example/#/book/tok?visit=1',
        'Chris Quinn, Q3 Interiors\n01 555 0100',
      ].join('\n\n'),
    )
    expect(m.html).toContain('>Book my site visit</a>')
  })
})

describe('the estimate after a call', () => {
  const input = {
    customerName: 'Mary Byrne',
    workItems: ['New units and worktop'],
    note: null,
    low: 9500,
    high: 10500,
    caveats: WORDING.estimate_call_caveats.default,
    quoteUrl: 'https://q3.example/#/estimate/t/e',
    businessPhone: null,
  }

  it('thanks them for the call and lists the work talked about', () => {
    const m = renderEstimate({ ...input, after: 'call' })
    expect(m.text).toContain('Thanks for talking the work through with us.')
    expect(m.text).toContain('The work we talked about:\n\n- New units and worktop')
    expect(m.text).toContain('based on what you told us on the call')
    expect(m.text).not.toContain('Thanks for having us out')
    expect(renderEstimate(input).text).toContain('The work we looked at:')
  })
})
