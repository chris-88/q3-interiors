import { processCommunication, type Mailer, type OutgoingEmail } from './email.ts'
import { addressHash, bucketFor, clientAddress } from './limits.ts'
import { renderStaffAlert } from './messages.ts'
import { handlePublic, type PublicDeps } from './public-booking.ts'
import { FakeCalendar, FakeDb } from './testing/fakes.ts'

const headers = (h: Record<string, string>) => new Headers(h)

describe('client address', () => {
  it('prefers cf-connecting-ip, then the first x-forwarded-for hop, then one shared bucket', () => {
    expect(
      clientAddress(
        headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }),
      ),
    ).toBe('203.0.113.9')
    expect(clientAddress(headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }))).toBe(
      '198.51.100.1',
    )
    expect(clientAddress(headers({}))).toBe('shared')
    expect(clientAddress(headers({ 'cf-connecting-ip': '  ' }))).toBe('shared')
  })

  it('hashes with a key, never returning the address', async () => {
    const a = await addressHash('203.0.113.9', 'secret-one')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toContain('203')
    expect(await addressHash('203.0.113.9', 'secret-one')).toBe(a)
    expect(await addressHash('203.0.113.9', 'secret-two')).not.toBe(a)
    // Matches Postgres: encode(extensions.hmac('203.0.113.9', 'k', 'sha256'), 'hex'), as used
    // by private.address_hash, so one address is one bucket in SQL and in the functions.
    expect(await addressHash('203.0.113.9', 'k')).toBe(
      '317fe07e1ac9940e8317b616e8b528230172ed88a600c05e193dc71380c1e44c',
    )
  })

  it('maps actions to buckets with retry keys for writes', () => {
    expect(bucketFor('book', 'e', { idempotencyKey: 'k' })).toEqual({
      bucket: 'booking_write',
      idemKey: 'book:k',
    })
    expect(bucketFor('cancel', 'e', {})).toEqual({ bucket: 'booking_write', idemKey: 'cancel:e' })
    expect(bucketFor('request_contact', 'e', {})).toEqual({
      bucket: 'booking_write',
      idemKey: 'contact:e',
    })
    expect(bucketFor('availability', 'e', {}).bucket).toBe('booking_read')
    expect(bucketFor('status', 'e', {}).bucket).toBe('booking_read')
  })
})

describe('booking write limit', () => {
  let clock = Date.parse('2027-03-01T08:00:00Z')
  const setup = (writeLimit = 3) => {
    clock = Date.parse('2027-03-01T08:00:00Z')
    const db = new FakeDb(() => clock)
    const deps: PublicDeps = {
      db,
      calendar: new FakeCalendar(),
      accessToken: async () => 't',
      mailer: null,
      appUrl: 'https://q3.example',
      now: () => clock,
      limit: (bucket, key) =>
        db.rateLimitTake(
          bucket,
          'hash-of-address',
          key,
          bucket === 'booking_write' ? writeLimit : 300,
        ),
    }
    return { db, deps }
  }
  const TOKEN = 'token-limit-0123456789abcdef'

  it('refuses writes over the limit with a plain 429, and recovers after an hour', async () => {
    const { db, deps } = setup()
    db.addEnquiry({ name: 'A', email: 'a@example.com', phone: '0870000000' }, TOKEN)
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await handlePublic({ action: 'request_contact', token: TOKEN, reason: `r${i}` }, deps))
          .status,
      ).toBe(200)
      // request_contact has one retry key per enquiry, so these three count once.
    }
    expect(db.limiterHits.filter((h) => h.bucket === 'booking_write')).toHaveLength(1)
    await handlePublic(
      { action: 'site_details', token: TOKEN, answers: { site_address: '12 Example Road' } },
      deps,
    )
    await handlePublic(
      { action: 'site_details', token: TOKEN, answers: { site_address: '12 Example Road' } },
      deps,
    )
    const limited = await handlePublic(
      { action: 'site_details', token: TOKEN, answers: { site_address: '12 Example Road' } },
      deps,
    )
    expect(limited).toEqual({ status: 429, body: { error: 'rate_limited' } })
    // Reads have their own, looser bucket.
    expect((await handlePublic({ action: 'context', token: TOKEN }, deps)).status).toBe(200)
    clock += 3_600_001
    expect(
      (
        await handlePublic(
          { action: 'site_details', token: TOKEN, answers: { site_address: '12 Example Road' } },
          deps,
        )
      ).status,
    ).toBe(200)
  })

  it('a retried booking with the same idempotency key is not counted twice', async () => {
    const { db, deps } = setup(2)
    db.addEnquiry({ name: 'A', email: 'a@example.com', phone: '0870000000' }, TOKEN)
    const req = {
      action: 'book',
      token: TOKEN,
      typeId: 'phone_consultation',
      start: '2027-03-02T10:00:00.000Z',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    }
    for (let i = 0; i < 4; i += 1) expect((await handlePublic(req, deps)).status).toBe(200)
    expect(db.limiterHits.filter((h) => h.bucket === 'booking_write')).toHaveLength(1)
  })

  it('an unknown token is refused before the limiter, leaving no rows', async () => {
    const { db, deps } = setup()
    expect(
      (await handlePublic({ action: 'context', token: 'not-a-real-token-000000000' }, deps)).status,
    ).toBe(401)
    expect(db.limiterHits).toHaveLength(0)
  })
})

describe('staff alerts', () => {
  class Mail implements Mailer {
    sent: OutgoingEmail[] = []
    async send(m: OutgoingEmail) {
      this.sent.push(m)
      return 'id'
    }
  }

  it('name the reference and project, never the customer contact details, in the subject', () => {
    const m = renderStaffAlert('staff_new_enquiry', {
      summary: {
        id: 'e1',
        reference: 'Q3-ABC234',
        answers: {
          project_type: 'kitchen',
          location: 'D07 X2Y3',
          name: 'Mary Byrne',
          email: 'mary@example.com',
          phone: '087 123 4567',
        },
        contact_request_reason: null,
        schema: {
          steps: [
            { fields: [{ id: 'project_type', options: [{ value: 'kitchen', label: 'Kitchen' }] }] },
          ],
        },
      },
      staffUrl: 'https://q3.example/#/staff/enquiries/e1',
    })
    expect(m.subject).toBe('New enquiry Q3-ABC234: Kitchen')
    for (const secret of ['Mary', 'mary@example.com', '087', 'D07'])
      expect(m.subject).not.toContain(secret)
    expect(m.text).toContain('Area: D07 X2Y3')
    expect(m.text).toContain('https://q3.example/#/staff/enquiries/e1')
    expect(m.text).not.toContain('mary@example.com')
  })

  it('a call-back request queues one alert and it is sent once', async () => {
    const db = new FakeDb(() => Date.now())
    db.addEnquiry(
      { project_type: 'kitchen', location: 'D07', email: 'a@example.com' },
      'tok-alert-0123456789abcdef',
    )
    const deps: PublicDeps = {
      db,
      calendar: null,
      accessToken: async () => 't',
      mailer: null,
      appUrl: 'https://q3.example',
      now: Date.now,
    }
    await handlePublic({ action: 'request_contact', token: 'tok-alert-0123456789abcdef' }, deps)
    await handlePublic({ action: 'request_contact', token: 'tok-alert-0123456789abcdef' }, deps)
    const alerts = db.comms.filter((c) => c.template === 'staff_callback_request')
    expect(alerts).toHaveLength(1)
    const mailer = new Mail()
    for (const c of await db.claimCommunications(10))
      await processCommunication(c, { db, mailer, appUrl: 'https://q3.example' })
    for (const c of await db.claimCommunications(10))
      await processCommunication(c, { db, mailer, appUrl: 'https://q3.example' })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.subject).toBe('Call-back requested Q3-TEST01: Kitchen')
  })
})
