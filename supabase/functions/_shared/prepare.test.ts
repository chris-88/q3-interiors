import { describe, expect, it } from 'vitest'
import { bucketFor } from './limits.ts'
import { hasExif } from './jpeg.ts'
import { processPhotoDeletions } from './photo-deletions.ts'
import { handlePublic, type PublicDeps } from './public-booking.ts'
import { FakeCalendar, FakeDb, FakePhotoStore } from './testing/fakes.ts'
import { jpeg, PNG, toBase64 } from './testing/jpeg-fixtures.ts'
import { fromLocal } from './time.ts'

let clock = Date.parse('2027-03-01T08:00:00Z')
const now = () => clock
const TOKEN = 'token-prep-0123456789abcdefghij'
const OTHER = 'token-other-0123456789abcdefghi'
const TUESDAY_10 = new Date(fromLocal('2027-03-02', 600)!).toISOString()
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function setup(type: 'site_visit' | 'phone_consultation' = 'site_visit') {
  clock = Date.parse('2027-03-01T08:00:00Z')
  const db = new FakeDb(now)
  const photos = new FakePhotoStore()
  const deps: PublicDeps = {
    db,
    calendar: new FakeCalendar(),
    accessToken: async () => 'access',
    mailer: null,
    appUrl: 'https://q3.example',
    now,
    photos,
  }
  const enquiryId = db.addEnquiry(
    {
      appointment_preference: 'on_site',
      project_type: 'kitchen',
      location: 'Dublin 8',
      name: 'Test Person',
      email: 'test@example.com',
      phone: '087 123 4567',
    },
    TOKEN,
    { siteDetails: { site_address: '12 Example Road, Dublin 8' } },
  )
  db.addEnquiry({ name: 'Other', email: 'o@example.com', phone: '0870000000' }, OTHER)
  const call = async (req: Record<string, unknown>) => {
    const res = await handlePublic(req, deps)
    return { status: res.status, body: res.body as Record<string, unknown> }
  }
  const booked = await call({
    action: 'book',
    token: TOKEN,
    typeId: type,
    start: TUESDAY_10,
    idempotencyKey: key(1),
  })
  expect(booked.body.status).toBe('booked')
  return { db, photos, deps, call, enquiryId }
}

const addPhoto = (n: number, photo = jpeg()) => ({
  action: 'add_photo',
  token: TOKEN,
  key: key(100 + n),
  photo: toBase64(photo),
  thumb: toBase64(jpeg({ width: 320, height: 240 })),
})

describe('help us prepare', () => {
  it('saves each answer on its own, with v1 values, and refuses others', async () => {
    const { call, db, enquiryId } = await setup()
    expect(
      (await call({ action: 'save_prepare', token: TOKEN, details: { budget: '25k_50k' } })).body,
    ).toEqual({ status: 'saved' })
    await call({ action: 'save_prepare', token: TOKEN, details: { timing: 'flexible' } })
    await call({
      action: 'save_prepare',
      token: TOKEN,
      details: { access_notes: 'Side gate', marketing_opt_in: true },
    })
    const state = (await call({ action: 'prepare', token: TOKEN })).body
    expect(state).toMatchObject({
      window: { open: true, mode: 'on_site' },
      answers: { budget: '25k_50k', timing: 'flexible' },
      access_notes: 'Side gate',
      marketing_opt_in: true,
      photos: [],
    })
    expect(db.enquiries.get(enquiryId)?.site_details).toEqual({
      site_address: '12 Example Road, Dublin 8',
      access_notes: 'Side gate',
    })
    for (const details of [{ budget: 'lots' }, { colour: 'red' }, {}]) {
      expect((await call({ action: 'save_prepare', token: TOKEN, details })).status).toBe(400)
    }
  })

  it('keeps access notes for site visits only', async () => {
    const { call } = await setup('phone_consultation')
    expect(
      (await call({ action: 'save_prepare', token: TOKEN, details: { access_notes: 'x' } })).status,
    ).toBe(400)
  })

  it('closes when there is no live booking or the appointment has started', async () => {
    const { call, db } = await setup()
    expect(
      (await call({ action: 'save_prepare', token: OTHER, details: { timing: 'asap' } })).body,
    ).toEqual({ error: 'closed', reason: 'no_booking' })
    clock = Date.parse(TUESDAY_10) + 60_000
    expect((await call(addPhoto(1))).body).toEqual({ error: 'closed', reason: 'started' })
    clock = Date.parse('2027-03-01T09:00:00Z')
    await call({ action: 'cancel', token: TOKEN })
    expect(db.window([...db.enquiries.keys()][0] ?? '').reason).toBe('no_booking')
    expect((await call(addPhoto(2))).status).toBe(409)
  })
})

describe('photos', () => {
  it('stores a cleaned JPEG under the enquiry and shows its thumbnail', async () => {
    const { call, photos, enquiryId } = await setup()
    const res = await call(addPhoto(1, jpeg({ exif: true })))
    expect(res.body).toMatchObject({ status: 'added' })
    const [path, stored] = [...photos.files.entries()][0] ?? []
    expect(path).toMatch(new RegExp(`^enquiries/${enquiryId}/[0-9a-f-]{36}\\.jpg$`))
    // The GPS-carrying Exif never reaches the bucket.
    expect(stored && hasExif(stored)).toBe(false)
    const state = (await call({ action: 'prepare', token: TOKEN })).body
    expect(state.photos).toHaveLength(1)
  })

  it('refuses what is not a JPEG, too big, or not base64', async () => {
    const { call, photos } = await setup()
    expect((await call({ ...addPhoto(1), photo: toBase64(PNG) })).body).toMatchObject({
      error: 'invalid_photo',
      reason: 'not_jpeg',
    })
    expect((await call({ ...addPhoto(2), photo: 'not base64!' })).status).toBe(400)
    expect(
      (await call({ ...addPhoto(3), photo: toBase64(jpeg({ width: 6000, height: 10 })) })).body,
    ).toMatchObject({ reason: 'dimensions' })
    expect(photos.files.size).toBe(0)
  })

  it('an interrupted upload is retried with the same key and never touches the booking', async () => {
    const { call, photos, db } = await setup()
    photos.failPuts = 1
    expect((await call(addPhoto(1))).status).toBe(502)
    expect((await call({ action: 'prepare', token: TOKEN })).body.photos).toEqual([])
    const again = await call(addPhoto(1))
    expect(again.body).toMatchObject({ status: 'added' })
    // A retry after success is the same photo, stored once.
    expect((await call(addPhoto(1))).body).toEqual(again.body)
    expect(photos.files.size).toBe(1)
    expect(db.photos).toHaveLength(1)
    expect(db.bookings[0]?.state).toBe('confirmed')
    // The retry is not counted twice by the limiter.
    expect(bucketFor('add_photo', 'e', { key: key(101) }).idemKey).toBe(`photo:${key(101)}`)
  })

  it('allows eight photos per enquiry; another enquiry cannot reuse a key', async () => {
    const { call } = await setup()
    for (let n = 1; n <= 8; n += 1) expect((await call(addPhoto(n))).body.status).toBe('added')
    expect((await call(addPhoto(9))).body).toEqual({ error: 'photo_limit' })
    expect((await call({ ...addPhoto(1), token: OTHER })).status).toBe(403)
  })

  it('a removed photo loses its row and its file; failures wait for the worker', async () => {
    const { call, photos, db, enquiryId } = await setup()
    const a = (await call(addPhoto(1))).body.id as string
    const b = (await call(addPhoto(2))).body.id as string
    expect((await call({ action: 'remove_photo', token: TOKEN, photoId: a })).body).toEqual({
      status: 'removed',
    })
    expect(photos.files.size).toBe(1)
    expect(db.pendingPhotoDeletions).toEqual([])
    photos.failRemoves = 1
    await call({ action: 'remove_photo', token: TOKEN, photoId: b })
    expect(photos.files.size).toBe(1)
    expect(db.pendingPhotoDeletions).toHaveLength(1)
    expect(await processPhotoDeletions(db, photos)).toEqual({ removed: 1, failed: 0 })
    expect(photos.files.size).toBe(0)
    // Deleting the enquiry (data request or retention) removes every file through the worker.
    await call(addPhoto(3))
    await call(addPhoto(4))
    expect(photos.files.size).toBe(2)
    db.deleteEnquiry(enquiryId)
    expect(await processPhotoDeletions(db, photos)).toEqual({ removed: 2, failed: 0 })
    expect(photos.files.size).toBe(0)
  })

  it('without a photo store, photos are refused and nothing is reserved', async () => {
    const { call, deps, db } = await setup()
    deps.photos = null
    expect((await call(addPhoto(1))).status).toBe(503)
    expect(db.photos).toEqual([])
  })
})
