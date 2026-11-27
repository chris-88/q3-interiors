import { describe, expect, it } from 'vitest'
import { processCommunication, type Mailer, type OutgoingEmail } from './email.ts'
import { renderQuoteEmail, renderStaffAlert, WORDING } from './messages.ts'
import { handlePublic, type PublicDeps } from './public-booking.ts'
import { depositLine, longDate, renderQuoteDocument } from './quote-document.ts'
import type { QuoteFiles } from './storage.ts'
import { FakeCalendar, FakeDb } from './testing/fakes.ts'

const clock = Date.parse('2026-11-27T10:00:00Z')
const now = () => clock
const TOKEN = 'quote-token-0123456789abcdefghij'
const QUOTE = '00000000-0000-4000-8000-0000000a0001'

class RecordingMailer implements Mailer {
  sent: OutgoingEmail[] = []
  async send(email: OutgoingEmail) {
    this.sent.push(email)
    return `msg_${this.sent.length}`
  }
}

class MemoryFiles implements QuoteFiles {
  files = new Map<string, Uint8Array>()
  async put(path: string, bytes: Uint8Array) {
    this.files.set(path, bytes)
  }
  async get(path: string) {
    return this.files.get(path) ?? null
  }
}

function setup() {
  const db = new FakeDb(now)
  const enquiryId = db.addEnquiry(
    {
      project_type: 'kitchen',
      location: 'Dublin 8',
      name: 'Mary Byrne',
      email: 'mary@customer.ie',
      phone: '087 123 4567',
    },
    TOKEN,
    { siteDetails: { site_address: '12 Example Road, Dublin 8' } },
  )
  db.quotes.set(QUOTE, {
    id: QUOTE,
    enquiry_id: enquiryId,
    number: 'Q3-Q-0001',
    version: 1,
    price_eur: 10200,
    included: ['New units and worktop', 'Tiled floor'],
    excluded: ['Appliances'],
    note: 'The window stays.',
    deposit_percent: 10,
    deposit_eur: 1020,
    valid_until: '2026-12-18',
    terms: 'This quote is one price for the work listed. It’s good until Fri 18 Dec 2026.',
    sent_at: new Date(clock).toISOString(),
    pdf_path: null,
    change_requested_at: null,
  })
  return { db, enquiryId }
}

const comm = (db: FakeDb, over: Record<string, unknown> = {}) => {
  const row = {
    id: `c-quote-${db.comms.length + 1}`,
    enquiry_id: null as string | null,
    booking_id: null,
    quote_id: QUOTE,
    template: 'quote' as const,
    recipient: 'mary@customer.ie',
    dedupe_key: `quote:${QUOTE}`,
    attempts: 1,
    max_attempts: 6,
    state: 'sending',
    next_attempt_at: 0,
    provider_message_id: null,
    last_error: null,
    ...over,
  }
  db.comms.push(row)
  return row
}

describe('the quote document', () => {
  const doc = {
    number: 'Q3-Q-0001',
    version: 1,
    sentOn: '2026-11-27',
    validUntil: '2026-12-18',
    customerName: 'Mary <Byrne>',
    jobAddress: '12 Example Road, Dublin 8',
    jobLine: 'Kitchen, Dublin 8',
    business: { legalName: 'Q3 Interiors Limited', phone: '01 555 0100', email: null },
    included: ['New units and worktop'],
    excluded: [],
    note: null,
    price: 10200,
    depositPercent: 10,
    depositEur: 1020,
    terms: WORDING.quote_terms.default.replace('{date}', 'Fri 18 Dec 2026'),
    fontBase: '',
  }

  it('dates read like the SQL long_date', () => {
    expect(longDate('2026-12-18')).toBe('Fri 18 Dec 2026')
    expect(longDate('2027-01-04')).toBe('Mon 4 Jan 2027')
  })

  it('has every part, in order, escaped, A4', () => {
    const html = renderQuoteDocument(doc)
    const order = [
      'aria-label="Q3 Interiors"',
      '<h1>Quote</h1>',
      'Q3-Q-0001',
      'Date: Fri 27 Nov 2026',
      'Good until: Fri 18 Dec 2026',
      'Mary &lt;Byrne&gt;',
      '12 Example Road, Dublin 8',
      'Q3 Interiors Limited',
      'What’s included',
      '€10,200',
      'VAT included',
      depositLine(10, 1020),
      'we ring you first',
      'It’s good until Fri 18 Dec 2026.',
      'Chris Quinn, Q3 Interiors',
    ]
    let at = -1
    for (const part of order) {
      const next = html.indexOf(part, at + 1)
      expect(next, part).toBeGreaterThan(at)
      at = next
    }
    expect(html).toContain('@page{size:A4')
    expect(html).not.toContain('What’s not included')
    expect(html).not.toContain('<script')
    expect(depositLine(10, 1020)).toBe(
      'A 10% deposit of €1,020 books your start date. We confirm the date once the deposit is in.',
    )
  })
})

describe('the quote email', () => {
  const input = {
    customerName: 'Mary Byrne',
    workAt: '12 Example Road, Dublin 8',
    price: 10200,
    goodUntil: 'Fri 18 Dec 2026',
    version: 1,
    viewUrl: 'https://q3.example/#/quote/t/q',
    depositUrl: 'https://q3.example/#/quote/t/q/deposit',
    changeUrl: 'https://q3.example/#/quote/t/q/change',
    businessPhone: '01 555 0100',
  }

  it('reads as asked, three buttons in order, in both parts', () => {
    const m = renderQuoteEmail(input)
    expect(m.subject).toBe('Your quote from Q3 Interiors')
    expect(m.text).toBe(
      [
        'Hello Mary,',
        'Here is your quote for the work at 12 Example Road, Dublin 8.',
        '€10,200, VAT included',
        'The full quote is attached as a PDF.',
        'It’s good until Fri 18 Dec 2026.',
        'View my quote: https://q3.example/#/quote/t/q',
        'Pay my deposit: https://q3.example/#/quote/t/q/deposit',
        'Ask for a change: https://q3.example/#/quote/t/q/change',
        'Chris Quinn, Q3 Interiors\n01 555 0100',
      ].join('\n\n'),
    )
    const html = m.html
    expect(html.indexOf('>View my quote<')).toBeLessThan(html.indexOf('>Pay my deposit<'))
    expect(html.indexOf('>Pay my deposit<')).toBeLessThan(html.indexOf('>Ask for a change<'))
  })

  it('an updated version says so', () => {
    const m = renderQuoteEmail({ ...input, version: 2 })
    expect(m.subject).toBe('Your updated quote from Q3 Interiors')
    expect(m.text).toContain('Here is your updated quote')
  })

  it('the change alert names the quote, not the customer', () => {
    const m = renderStaffAlert('staff_quote_change', {
      summary: {
        id: 'e1',
        reference: 'Q3-ABC123',
        answers: { name: 'Mary Byrne', location: 'Dublin 8', project_type: 'kitchen' },
        contact_request_reason: null,
        schema: null,
      },
      staffUrl: 'https://staff.example/#/enquiries/e1',
      wording: {},
      quote: { number: 'Q3-Q-0001' },
    })
    expect(m.subject).toBe('Change asked for on Q3-Q-0001: Q3-ABC123')
    expect(m.text).not.toContain('Mary')
  })
})

describe('the worker sends a quote with its PDF', () => {
  it('makes, stores and attaches the PDF, with token links', async () => {
    const { db, enquiryId } = setup()
    const mailer = new RecordingMailer()
    const files = new MemoryFiles()
    const made: string[] = []
    const result = await processCommunication(comm(db, { enquiry_id: enquiryId }), {
      db,
      mailer,
      appUrl: 'https://q3.example',
      now,
      quotes: {
        pdf: async (html) => {
          made.push(html)
          return new TextEncoder().encode('%PDF-fake')
        },
        files,
      },
    })
    expect(result).toBe('sent')
    expect(made[0]).toContain('Q3-Q-0001')
    expect(made[0]).toContain("url('roboto-400.woff2')")
    const path = `${enquiryId}/${QUOTE}.pdf`
    expect(files.files.has(path)).toBe(true)
    expect((await db.quoteById(QUOTE))?.pdf_path).toBe(path)
    const mail = mailer.sent[0]!
    expect(mail.subject).toBe('Your quote from Q3 Interiors')
    expect(mail.attachments?.[0]?.filename).toBe('Q3-Q-0001.pdf')
    expect(mail.text).toContain('Here is your quote for the work at 12 Example Road, Dublin 8.')
    expect(mail.text).toContain(
      `View my quote: https://q3.example/#/quote/minted-1-0123456789abcdefghij/${QUOTE}\n`,
    )
    expect(mail.text).toContain('/deposit')
    expect(mail.text).toContain('/change')
  })

  it('waits (retries) without the PDF service, and never sends without the PDF', async () => {
    const { db, enquiryId } = setup()
    const mailer = new RecordingMailer()
    const result = await processCommunication(comm(db, { enquiry_id: enquiryId }), {
      db,
      mailer,
      appUrl: 'https://q3.example',
      now,
    })
    expect(result).toBe('retrying')
    expect(mailer.sent).toHaveLength(0)
  })

  it('skips a version that a newer one replaced', async () => {
    const { db, enquiryId } = setup()
    const first = db.quotes.get(QUOTE)!
    db.quotes.set('q2', { ...first, id: 'q2', version: 2 })
    const mailer = new RecordingMailer()
    const result = await processCommunication(comm(db, { enquiry_id: enquiryId }), {
      db,
      mailer,
      appUrl: 'https://q3.example',
      now,
      quotes: { pdf: async () => new Uint8Array([1]), files: new MemoryFiles() },
    })
    expect(result).toBe('skipped')
  })
})

describe('the customer quote pages (public-booking)', () => {
  const deps = (db: FakeDb, files: QuoteFiles | null = null): PublicDeps => ({
    db,
    calendar: new FakeCalendar(),
    accessToken: async () => 'token',
    mailer: null,
    appUrl: 'https://q3.example',
    now,
    quoteFiles: files,
  })

  it('reads the quote and the PDF without recording anything', async () => {
    const { db, enquiryId } = setup()
    const files = new MemoryFiles()
    files.files.set(`${enquiryId}/${QUOTE}.pdf`, new TextEncoder().encode('%PDF'))
    db.quotes.get(QUOTE)!.pdf_path = `${enquiryId}/${QUOTE}.pdf`
    const read = await handlePublic(
      { action: 'quote', token: TOKEN, quoteId: QUOTE },
      deps(db, files),
    )
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({
      number: 'Q3-Q-0001',
      current: true,
      price: 10200,
      depositEur: 1020,
      hasPdf: true,
      changeRequested: false,
    })
    expect((read.body as { document: { fontBase: string } }).document.fontBase).toBe(
      'https://q3.example/quote/',
    )
    const pdf = await handlePublic(
      { action: 'quote_pdf', token: TOKEN, quoteId: QUOTE },
      deps(db, files),
    )
    expect(pdf.body).toEqual({ filename: 'Q3-Q-0001.pdf', pdf: btoa('%PDF') })
    expect(db.quoteChanges).toHaveLength(0)
    expect(db.quotes.get(QUOTE)?.change_requested_at).toBeNull()
  })

  it('"Ask for a change" records the words; another enquiry’s quote is not found', async () => {
    const { db } = setup()
    const asked = await handlePublic(
      { action: 'quote_change', token: TOKEN, quoteId: QUOTE, text: ' Add the utility room. ' },
      deps(db),
    )
    expect(asked.body).toEqual({ status: 'requested' })
    expect(db.quoteChanges).toEqual([{ quoteId: QUOTE, text: 'Add the utility room.' }])
    const empty = await handlePublic(
      { action: 'quote_change', token: TOKEN, quoteId: QUOTE, text: '   ' },
      deps(db),
    )
    expect(empty.status).toBe(400)
    db.addEnquiry({ name: 'Other', email: 'o@customer.ie' }, 'other-token-0123456789abcdefgh')
    const other = await handlePublic(
      { action: 'quote', token: 'other-token-0123456789abcdefgh', quoteId: QUOTE },
      deps(db),
    )
    expect(other.status).toBe(404)
  })
})
