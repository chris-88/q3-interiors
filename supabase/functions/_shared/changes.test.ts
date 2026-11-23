import { processSyncJob, reconcile, runDueFor } from './changes.ts'
import type { Mailer, OutgoingEmail } from './email.ts'
import { GoogleError } from './google.ts'
import { renderMessage } from './messages.ts'
import { handlePublic, type PublicDeps } from './public-booking.ts'
import { FakeCalendar, FakeDb } from './testing/fakes.ts'
import { fromLocal } from './time.ts'

// Monday 1 March 2027, 08:00 Dublin; with 24h notice the first slot is Tuesday 09:00.
let clock = Date.parse('2027-03-01T08:00:00Z')
const now = () => clock
const at = (date: string, minutes: number) => new Date(fromLocal(date, minutes)!).toISOString()
const THU_10 = at('2027-03-04', 600)
const THU_11 = at('2027-03-04', 660)
const FRI_10 = at('2027-03-05', 600)

class RecordingMailer implements Mailer {
  sent: OutgoingEmail[] = []
  async send(email: OutgoingEmail) {
    this.sent.push(email)
    return `msg_${this.sent.length}`
  }
}

const TOKEN_A = 'token-a-0123456789abcdefghij'
const TOKEN_B = 'token-b-0123456789abcdefghij'
const answers = (n: string) => ({
  name: `${n} Byrne`,
  email: `${n}@q3-test-customer.ie`,
  phone: '087 123 4567',
})
type Body = Record<string, unknown> & {
  status?: string
  booking?: { state: string; id: string; start: string; canChange: boolean } | null
  alternatives?: { start: string }[]
}

function setup() {
  clock = Date.parse('2027-03-01T08:00:00Z')
  const db = new FakeDb(now)
  const calendar = new FakeCalendar()
  const mailer = new RecordingMailer()
  const deps: PublicDeps = {
    db,
    calendar,
    accessToken: async () => 'access-token',
    mailer,
    appUrl: 'https://q3.example',
    now,
  }
  const call = async (req: Record<string, unknown>) => {
    const res = await handlePublic(req, deps)
    return { status: res.status, body: res.body as Body }
  }
  return { db, calendar, mailer, deps, call }
}

async function booked(s: ReturnType<typeof setup>, token = TOKEN_A, start = THU_10) {
  s.db.addEnquiry(answers(token === TOKEN_A ? 'ann' : 'bob'), token)
  const res = await s.call({
    action: 'book',
    token,
    typeId: 'phone_consultation',
    start,
    idempotencyKey: crypto.randomUUID(),
  })
  expect(res.body.booking?.state).toBe('confirmed')
  return res.body.booking!.id
}

describe('reschedule', () => {
  it('moves the booking and its Google event, keeping both ids, and emails the new time', async () => {
    const s = setup()
    const id = await booked(s)
    const eventId = s.db.bookings[0]!.calendar_event_id
    const res = await s.call({ action: 'reschedule', token: TOKEN_A, start: FRI_10 })
    expect(res.body).toMatchObject({ status: 'rescheduled', changed: true })
    expect(res.body.booking).toMatchObject({ id, start: FRI_10, state: 'confirmed' })
    expect(s.db.bookings).toHaveLength(1)
    expect(s.db.bookings[0]!.calendar_event_id).toBe(eventId)
    expect(s.calendar.events.size).toBe(1)
    expect(s.calendar.events.get(eventId)?.start).toBe(FRI_10)
    expect(s.calendar.insertCalls).toBe(1)
    expect(s.mailer.sent.map((m) => m.subject)).toEqual([
      expect.stringMatching(/^Booked:/),
      expect.stringMatching(/^New time:.*Friday 5 March 2027 at 10:00/),
    ])
  })

  it('a double tap is a no-op', async () => {
    const s = setup()
    await booked(s)
    await s.call({ action: 'reschedule', token: TOKEN_A, start: FRI_10 })
    const again = await s.call({ action: 'reschedule', token: TOKEN_A, start: FRI_10 })
    expect(again.body).toMatchObject({ status: 'rescheduled', changed: false })
    expect(s.calendar.moveCalls).toBe(1)
    expect(s.mailer.sent.filter((m) => m.subject.startsWith('New time'))).toHaveLength(1)
  })

  it('offers its own neighbouring times: the booking does not block its own move', async () => {
    const s = setup()
    await booked(s)
    const options = await s.call({ action: 'move_options', token: TOKEN_A })
    const starts = (options.body.slots as { start: string }[]).map((x) => x.start)
    expect(starts).not.toContain(THU_10)
    // 10:30 is inside its own after-buffer, which does not count against itself.
    expect(starts).toContain(at('2027-03-04', 630))
  })

  it('a lost race keeps the old time and offers fresh alternatives', async () => {
    const s = setup()
    await booked(s, TOKEN_A, THU_10)
    // Someone else holds Thursday 11:00 in the database (not yet visible in Google).
    s.db.addEnquiry(answers('bob'), TOKEN_B)
    const realFreeBusy = s.calendar.freeBusy.bind(s.calendar)
    const otherId = [...s.db.enquiries.keys()][1]!
    s.calendar.freeBusy = async (...args) => {
      const busy = await realFreeBusy(...args)
      // The other customer reserves between our availability check and our update.
      if (s.db.bookings.length === 1)
        await s.db.reserve(otherId, 'phone_consultation', THU_11, crypto.randomUUID())
      return busy
    }
    const res = await s.call({ action: 'reschedule', token: TOKEN_A, start: THU_11 })
    expect(res.body.status).toBe('slot_unavailable')
    expect(res.body.alternatives?.map((x) => x.start)).not.toContain(THU_11)
    expect(s.db.bookings[0]!.starts_at).toBe(THU_10)
    expect(s.calendar.moveCalls).toBe(0)
  })

  it('inside the cut-off the customer is asked to ring', async () => {
    const s = setup()
    await booked(s)
    s.db.settings = { ...s.db.settings, business_phone: '01 234 5678' }
    clock = Date.parse(THU_10) - 90 * 60_000
    const context = await s.call({ action: 'context', token: TOKEN_A })
    expect(context.body.booking).toMatchObject({ canChange: false })
    const res = await s.call({ action: 'reschedule', token: TOKEN_A, start: FRI_10 })
    expect(res.body).toEqual({ status: 'too_late', businessPhone: '01 234 5678' })
    expect((await s.call({ action: 'cancel', token: TOKEN_A })).body.status).toBe('too_late')
  })

  it('a Google update that keeps failing lands in needs-attention; the database time stays', async () => {
    const s = setup()
    await booked(s)
    s.calendar.script.moveError = new GoogleError('transient', '503')
    await s.call({ action: 'reschedule', token: TOKEN_A, start: FRI_10 })
    for (let i = 0; i < 10; i += 1) {
      clock += 3_600_000
      await runDueFor(s.deps, s.db.bookings[0]!.id)
    }
    const job = s.db.jobs.find((j) => j.kind === 'update_calendar_event')!
    expect(job.state).toBe('failed')
    expect(s.db.mismatches.get(s.db.bookings[0]!.id)).toMatch(/Could not move/)
    expect(s.db.bookings[0]!.starts_at).toBe(FRI_10)
  })

  it('an update that finds the event already at the new time does not move it again', async () => {
    const s = setup()
    await booked(s)
    await s.db.rescheduleBooking(s.db.bookings[0]!.id, FRI_10, 'staff')
    const ev = s.calendar.events.get(s.db.bookings[0]!.calendar_event_id)!
    s.calendar.events.set(ev.id, { ...ev, start: FRI_10, end: at('2027-03-05', 620) })
    const [job] = await s.db.claimSyncJobs(1)
    expect(await processSyncJob(job!, s.deps)).toBe('done')
    expect(s.calendar.moveCalls).toBe(0)
  })
})

describe('cancel', () => {
  it('cancels, frees the slot, removes the event once and emails once', async () => {
    const s = setup()
    await booked(s)
    const res = await s.call({ action: 'cancel', token: TOKEN_A, reason: 'Plans changed' })
    expect(res.body).toMatchObject({ status: 'cancelled', changed: true })
    expect(s.db.bookings[0]!.state).toBe('cancelled')
    const eventId = s.db.bookings[0]!.calendar_event_id
    expect(s.calendar.events.get(eventId)?.status).toBe('cancelled')
    expect((await s.call({ action: 'cancel', token: TOKEN_A })).body.status).toBe('not_live')
    expect(s.calendar.deleteCalls).toBe(1)
    expect(s.mailer.sent.filter((m) => m.subject.startsWith('Cancelled'))).toHaveLength(1)
    // Someone else can now book that time.
    await booked(s, TOKEN_B, THU_10)
  })

  it('a booking cancelled before its event existed never leaves an event behind', async () => {
    const s = setup()
    s.db.addEnquiry(answers('ann'), TOKEN_A)
    s.calendar.script.insertError = { error: new GoogleError('timeout', 'x'), createAnyway: true }
    await s.call({
      action: 'book',
      token: TOKEN_A,
      typeId: 'phone_consultation',
      start: THU_10,
      idempotencyKey: crypto.randomUUID(),
    })
    expect(s.db.bookings[0]!.state).toBe('calendar_pending')
    await s.call({ action: 'cancel', token: TOKEN_A })
    clock += 60_000
    await runDueFor(s.deps, s.db.bookings[0]!.id)
    await runDueFor(s.deps, s.db.bookings[0]!.id)
    const ev = s.calendar.events.get(s.db.bookings[0]!.calendar_event_id)
    expect(ev?.status ?? 'cancelled').toBe('cancelled')
    expect(s.db.bookings[0]!.state).toBe('cancelled')
  })
})

describe('reminders', () => {
  it('one reminder, at the lead time, sent by the worker path and never twice', async () => {
    const s = setup()
    await booked(s)
    const reminder = s.db.comms.find((c) => c.template === 'booking_reminder')!
    expect(reminder.next_attempt_at).toBe(Date.parse(THU_10) - 24 * 3_600_000)
    clock = Date.parse(THU_10) - 24 * 3_600_000
    await runDueFor(s.deps, s.db.bookings[0]!.id)
    await runDueFor(s.deps, s.db.bookings[0]!.id)
    expect(s.mailer.sent.filter((m) => m.subject.startsWith('Reminder'))).toHaveLength(1)
    expect(s.mailer.sent.find((m) => m.subject.startsWith('Reminder'))?.text).toContain(
      'Change or cancel: https://q3.example/#/book/',
    )
  })

  it('follows a reschedule and is never sent for a cancelled booking', async () => {
    const s = setup()
    await booked(s)
    await s.call({ action: 'reschedule', token: TOKEN_A, start: FRI_10 })
    const reminders = s.db.comms.filter((c) => c.template === 'booking_reminder')
    expect(reminders.map((c) => c.state)).toEqual(['skipped', 'queued'])
    expect(reminders[1]!.about_start).toBe(FRI_10)
    await s.call({ action: 'cancel', token: TOKEN_A })
    clock = Date.parse(FRI_10) - 3_600_000
    await runDueFor(s.deps, s.db.bookings[0]!.id)
    expect(s.mailer.sent.filter((m) => m.subject.startsWith('Reminder'))).toHaveLength(0)
  })

  it('is skipped when the booking was made inside the lead time', async () => {
    const s = setup()
    s.db.availabilityRow = { ...s.db.availabilityRow, min_notice_minutes: 60 }
    await booked(s, TOKEN_A, at('2027-03-01', 600))
    expect(s.db.comms.filter((c) => c.template === 'booking_reminder')).toHaveLength(0)
  })
})

describe('reconcile (flag only)', () => {
  it('flags an event deleted or moved in Google and clears it when it matches again', async () => {
    const s = setup()
    await booked(s)
    const b = s.db.bookings[0]!
    const ev = s.calendar.events.get(b.calendar_event_id)!
    s.calendar.events.set(ev.id, { ...ev, start: FRI_10, end: at('2027-03-05', 620) })
    expect(await reconcile(s.deps)).toEqual({ checked: 1, flagged: 1 })
    expect(s.db.mismatches.get(b.id)).toMatch(
      /moved in Google Calendar to Friday 5 March 2027 10:00/,
    )
    expect(b.starts_at).toBe(THU_10)
    s.calendar.events.set(ev.id, { ...ev, status: 'cancelled' })
    await reconcile(s.deps)
    expect(s.db.mismatches.get(b.id)).toBe('Event deleted in Google Calendar')
    s.calendar.events.set(ev.id, ev)
    await reconcile(s.deps)
    expect(s.db.mismatches.get(b.id)).toBeNull()
  })
})

describe('messages', () => {
  it('include the times in Irish time and the change link', async () => {
    const s = setup()
    await booked(s)
    const ctx = (await s.db.bookingContext(s.db.bookings[0]!.id))!
    const m = renderMessage('booking_cancelled', {
      ctx,
      manageUrl: 'https://q3.example/#/book/t',
      businessPhone: null,
      cancelledStart: THU_10,
    })
    expect(m.subject).toBe('Cancelled: Phone consultation, Thursday 4 March 2027 at 10:00')
    expect(m.text).toContain('book one here: https://q3.example/#/book/t')
  })
})
