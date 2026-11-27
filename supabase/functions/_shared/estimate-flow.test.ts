import { describe, expect, it } from 'vitest'
import { processCommunication, quoteUrl, type Mailer, type OutgoingEmail } from './email.ts'
import { ESTIMATE_SUBJECT, renderEstimate, renderStaffAlert, WORDING } from './messages.ts'
import { handlePublic, type PublicDeps } from './public-booking.ts'
import { FakeCalendar, FakeDb } from './testing/fakes.ts'
import type { Communication, EstimateRow } from './types.ts'

const clock = Date.parse('2027-03-05T16:00:00Z')
const now = () => clock
const TOKEN = 'token-e-0123456789abcdefghij'
const OTHER = 'token-f-0123456789abcdefghij'
const ESTIMATE_ID = '00000000-0000-4000-8000-0000000e0001'

class RecordingMailer implements Mailer {
  sent: OutgoingEmail[] = []
  async send(email: OutgoingEmail) {
    this.sent.push(email)
    return `msg_${this.sent.length}`
  }
}

function setup() {
  const db = new FakeDb(now)
  const enquiryId = db.addEnquiry(
    { name: 'Mary Byrne', email: 'mary@example.org', phone: '087 123 4567' },
    TOKEN,
  )
  db.addEnquiry({ name: 'Someone Else', email: 'else@example.org' }, OTHER)
  const estimate: EstimateRow = {
    id: ESTIMATE_ID,
    enquiry_id: enquiryId,
    low_eur: 9500,
    high_eur: 10500,
    work_looked_at: 'Kitchen: strip out, new units, tiled floor.',
    caveats: WORDING.estimate_caveats.default,
    sent_at: new Date(clock).toISOString(),
    valid_until: new Date(clock + 10 * 86_400_000).toISOString(),
    quote_requested_at: null,
  }
  db.estimates.set(estimate.id, estimate)
  const deps: PublicDeps = {
    db,
    calendar: new FakeCalendar(),
    accessToken: async () => 'x',
    mailer: null,
    appUrl: 'https://book.q3.example',
    now,
  }
  return { db, deps, enquiryId, estimate }
}

const input = {
  customerName: 'Mary Byrne',
  workLookedAt: 'Kitchen: strip out, new units, tiled floor.',
  low: 9500,
  high: 10500,
  caveats: WORDING.estimate_caveats.default,
  quoteUrl: 'https://book.q3.example/#/estimate/t/e',
  businessPhone: '01 234 5678',
  privacyUrl: 'https://book.q3.example/#/privacy',
  siteUrl: 'https://book.q3.example',
}

describe('estimate email', () => {
  it('reads in the agreed order, with the range large and one button', () => {
    const m = renderEstimate(input)
    expect(m.subject).toBe(ESTIMATE_SUBJECT)
    expect(m.subject).toBe('Your estimate from Q3 Interiors')
    const order = [
      'Hello Mary,',
      'Thanks for having us out to look at the work.',
      'The work we looked at:',
      '€9,500 to €10,500, VAT included',
      'This is an estimate, not a quote.',
      'Get my quote',
      'Chris Quinn, Q3 Interiors',
      '01 234 5678',
    ]
    for (const part of [m.text, m.html]) {
      const at = order.map((p) => part.indexOf(p))
      expect(at.every((i) => i >= 0)).toBe(true)
      expect([...at].sort((a, b) => a - b)).toEqual(at)
    }
    expect(m.html).toContain('font:700 28px')
    expect(m.html).toContain('href="https://book.q3.example/#/estimate/t/e"')
    for (const word of [/formal quote/i, /quotation/i, /estimated range/i, /!/])
      expect(`${m.subject} ${m.text}`).not.toMatch(word)
  })

  it('escapes what staff typed and leaves the phone out when there is none', () => {
    const m = renderEstimate({ ...input, workLookedAt: '<b>Bathroom</b>', businessPhone: null })
    expect(m.html).toContain('&lt;b&gt;Bathroom&lt;/b&gt;')
    expect(m.text).toContain('Chris Quinn, Q3 Interiors')
    expect(m.text).not.toContain('01 234')
  })

  it('is sent by the worker with a fresh link to the quote page', async () => {
    const { db } = setup()
    const mailer = new RecordingMailer()
    const comm: Communication = {
      id: 'c1',
      enquiry_id: [...db.enquiries.keys()][0] ?? null,
      booking_id: null,
      estimate_id: ESTIMATE_ID,
      template: 'estimate',
      recipient: 'mary@customer.ie',
      dedupe_key: `estimate:${ESTIMATE_ID}`,
      attempts: 1,
      max_attempts: 6,
    } as Communication
    db.comms.push({
      ...comm,
      state: 'sending',
      next_attempt_at: clock,
      provider_message_id: null,
      last_error: null,
    })
    const outcome = await processCommunication(comm, {
      db,
      mailer,
      appUrl: 'https://book.q3.example',
    })
    // A non-test domain goes to the (recording) mailer; nothing leaves the test.
    expect(outcome).toBe('sent')
    const email = mailer.sent[0]
    expect(email?.subject).toBe('Your estimate from Q3 Interiors')
    expect(email?.idempotencyKey).toBe(`estimate:${ESTIMATE_ID}`)
    expect(email?.text).toMatch(
      new RegExp(`Get my quote: https://book\\.q3\\.example/#/estimate/[^/\\s]+/${ESTIMATE_ID}`),
    )
    expect(db.mintedTokens).toBe(1)
  })

  it('alerts staff with the estimate when a quote is asked for', () => {
    const m = renderStaffAlert('staff_quote_request', {
      summary: {
        id: 'e1',
        reference: 'Q3-ABC123',
        answers: { project_type: 'kitchen', location: 'Dublin 8', name: 'Mary Byrne' },
        contact_request_reason: null,
        schema: null,
      },
      staffUrl: 'https://staff.q3.example/#/enquiries/e1',
      estimate: { low: 9500, high: 10500, sentAt: '2027-03-05T16:00:00Z' },
    })
    expect(m.subject).toBe('Quote requested Q3-ABC123: kitchen')
    expect(m.text).toContain('Estimate: €9,500 to €10,500, sent 5 March 2027')
    // No customer name, email or phone in a staff alert.
    expect(m.text).not.toContain('Mary')
  })

  it('builds the quote link from the token and the estimate', () => {
    expect(quoteUrl('https://a.example', 'tok', 'est')).toBe('https://a.example/#/estimate/tok/est')
  })
})

describe('Get my quote', () => {
  it('reads the estimate for its own enquiry only', async () => {
    const { deps } = setup()
    const own = await handlePublic(
      { action: 'estimate', token: TOKEN, estimateId: ESTIMATE_ID },
      deps,
    )
    expect(own.status).toBe(200)
    expect(own.body).toMatchObject({ low: 9500, high: 10500, quoteRequested: false })
    const other = await handlePublic(
      { action: 'estimate', token: OTHER, estimateId: ESTIMATE_ID },
      deps,
    )
    expect(other.status).toBe(404)
  })

  it('records the yes once, and a repeat changes nothing', async () => {
    const { db, deps, estimate } = setup()
    // Reading the page records nothing (a mail scanner opening the link).
    await handlePublic({ action: 'estimate', token: TOKEN, estimateId: ESTIMATE_ID }, deps)
    expect(estimate.quote_requested_at).toBeNull()
    const first = await handlePublic(
      { action: 'request_quote', token: TOKEN, estimateId: ESTIMATE_ID },
      deps,
    )
    expect(first).toEqual({ status: 200, body: { status: 'requested' } })
    const at = estimate.quote_requested_at
    expect(at).not.toBeNull()
    const again = await handlePublic(
      { action: 'request_quote', token: TOKEN, estimateId: ESTIMATE_ID },
      deps,
    )
    expect(again).toEqual({ status: 200, body: { status: 'requested' } })
    expect(estimate.quote_requested_at).toBe(at)
    expect(db.quoteAlerts).toEqual([ESTIMATE_ID])
    expect(
      (await handlePublic({ action: 'request_quote', token: OTHER, estimateId: ESTIMATE_ID }, deps))
        .status,
    ).toBe(404)
  })
})
