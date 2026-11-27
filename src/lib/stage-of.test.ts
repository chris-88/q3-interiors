import { describe, expect, it } from 'vitest'
import {
  diaryWhen,
  groupStages,
  stageOf,
  stripSteps,
  type StageBooking,
  type ViewInput,
} from './enquiry-stage'

// Friday 27 Nov 2026, noon in Dublin.
const now = Date.parse('2026-11-27T12:00:00Z')

const enquiry = (over: Partial<ViewInput> & { id?: string } = {}) => ({
  id: 'e',
  reference: 'Q3-ABC123',
  status: 'new',
  outcome: null,
  contact_requested_at: null,
  bookings: [] as StageBooking[],
  answers: { name: 'Sample Customer', appointment_preference: 'phone' } as Record<string, unknown>,
  submitted_at: '2026-11-27T09:00:00Z',
  ...over,
})

const booking = (over: Partial<StageBooking>): StageBooking => ({
  starts_at: '2026-11-24T10:00:00Z',
  confirmed_at: '2026-11-20T10:00:00Z',
  state: 'confirmed',
  mode: 'on_site',
  attendance: null,
  ...over,
})

const estimate = (over: Record<string, unknown> = {}) => ({
  sent_at: '2026-11-25T15:00:00Z',
  valid_until: '2026-12-05T15:00:00Z',
  low_eur: 9500,
  high_eur: 10500,
  quote_requested_at: null as string | null,
  ...over,
})

describe('stageOf', () => {
  it('a new enquiry is your move: ring today, on the Call step', () => {
    const v = stageOf(enquiry(), now)
    expect(v).toMatchObject({
      key: 'new',
      step: 'call',
      whose: 'q3',
      group: 'your_move',
      due: { date: '2026-11-27', kind: 'due' },
      urgency: 'today',
      chip: 'Ring today',
      news: 'Wants a call',
      primary: 'ring',
    })
    const older = stageOf(enquiry({ submitted_at: '2026-11-24T09:00:00Z' }), now)
    expect(older).toMatchObject({ urgency: 'overdue', chip: 'Ring, due Tue 24 Nov' })
  })

  it('an appointment to come is in the diary with its time, never hidden by an estimate', () => {
    const v = stageOf(
      enquiry({
        bookings: [booking({ starts_at: '2026-11-30T10:00:00Z' })],
        estimates: [estimate()],
      }),
      now,
    )
    expect(v).toMatchObject({
      key: 'booked',
      group: 'diary',
      whose: 'diary',
      urgency: 'neutral',
      chip: 'Visit Mon 10:00',
      news: 'Estimate sent 25 Nov',
      primary: null,
      others: ['move', 'cancel'],
    })
    expect(v.next?.starts_at).toBe('2026-11-30T10:00:00Z')
  })

  it('a finished appointment with nothing recorded asks how it went', () => {
    const v = stageOf(enquiry({ bookings: [booking({})] }), now)
    expect(v).toMatchObject({
      key: 'to_record',
      step: 'visit',
      group: 'your_move',
      urgency: 'overdue',
      chip: 'How did it go?',
      primary: 'record_outcome',
    })
  })

  it('after a visit that went ahead: write the estimate, due the same day', () => {
    const v = stageOf(enquiry({ bookings: [booking({ attendance: 'attended' })] }), now)
    expect(v).toMatchObject({
      key: 'awaiting_quote',
      step: 'estimate',
      chip: 'Write estimate',
      news: 'Visited Tue 24 Nov',
      primary: 'write_estimate',
      urgency: 'overdue',
    })
  })

  it('an estimate out waits on them until its good-until date, then comes back as No answer', () => {
    const e = enquiry({ bookings: [booking({ attendance: 'attended' })], estimates: [estimate()] })
    expect(stageOf(e, now)).toMatchObject({
      key: 'estimate_sent',
      group: 'waiting',
      whose: 'customer',
      due: { date: '2026-12-05', kind: 'until' },
      chip: 'Good till 5 Dec',
      news: 'Estimate €9,500 to €10,500',
    })
    const later = Date.parse('2026-12-06T12:00:00Z')
    expect(stageOf(e, later)).toMatchObject({
      key: 'no_answer',
      group: 'your_move',
      chip: 'No answer',
      urgency: 'overdue',
      primary: 'ring',
    })
  })

  it('a quote request is due 3 working days later', () => {
    const v = stageOf(
      enquiry({ estimates: [estimate({ quote_requested_at: '2026-11-25T09:00:00Z' })] }),
      now,
    )
    expect(v).toMatchObject({
      key: 'quote_requested',
      step: 'quote',
      due: { date: '2026-11-30', kind: 'due' },
      urgency: 'later',
      chip: 'Quote due Mon 30 Nov',
      news: 'Asked for a quote 25 Nov',
      primary: 'write_quote',
    })
  })

  it('a quote sent waits until its good-until date; a change asked for is due in 3 working days', () => {
    const q = {
      number: 'Q3-Q-0001',
      version: 1,
      price_eur: 10200,
      sent_at: '2026-11-26T10:00:00Z',
      change_requested_at: null as string | null,
      valid_until: '2026-12-17',
    }
    const e = enquiry({ outcome: 'quoted', quotes: [q] })
    expect(stageOf(e, now)).toMatchObject({
      key: 'quoted',
      group: 'waiting',
      chip: 'Good till 17 Dec',
      news: 'Quote €10,200',
      others: ['revise_quote', 'view_quote', 'mark_won', 'mark_lost'],
    })
    expect(stageOf(e, Date.parse('2026-12-18T12:00:00Z'))).toMatchObject({
      key: 'quote_no_answer',
      group: 'your_move',
      chip: 'No answer',
    })
    const asked = enquiry({
      outcome: 'quoted',
      quotes: [{ ...q, change_requested_at: '2026-11-27T09:00:00Z' }],
    })
    expect(stageOf(asked, now)).toMatchObject({
      key: 'change_requested',
      chip: 'Updated quote due Wed 2 Dec',
      primary: 'revise_quote',
    })
  })

  it('won, lost and closed are finished; a newer release’s outcome stays in view, plainly', () => {
    expect(stageOf(enquiry({ outcome: 'won' }), now)).toMatchObject({
      group: 'finished',
      step: 'deposit',
      primary: null,
    })
    expect(stageOf(enquiry({ status: 'unsuitable' }), now).group).toBe('finished')
    expect(stageOf(enquiry({ outcome: 'paused' }), now)).toMatchObject({
      key: 'other',
      label: 'paused',
      group: 'your_move',
      due: null,
      primary: null,
      others: ['ring', 'email'],
    })
  })
})

describe('the list grouped by whose move it is', () => {
  it('your move: overdue first, then oldest due; diary: next first; waiting: soonest good-until', () => {
    const rows = [
      enquiry({
        id: 'later',
        estimates: [estimate({ quote_requested_at: '2026-11-26T09:00:00Z' })],
      }),
      enquiry({ id: 'today' }),
      enquiry({ id: 'overdue-new', submitted_at: '2026-11-25T09:00:00Z' }),
      enquiry({ id: 'overdue-old', submitted_at: '2026-11-20T09:00:00Z' }),
      enquiry({ id: 'diary-2', bookings: [booking({ starts_at: '2026-12-01T10:00:00Z' })] }),
      enquiry({ id: 'diary-1', bookings: [booking({ starts_at: '2026-11-28T10:00:00Z' })] }),
      enquiry({ id: 'wait-2', estimates: [estimate({ valid_until: '2026-12-06T10:00:00Z' })] }),
      enquiry({ id: 'wait-1', estimates: [estimate()] }),
      enquiry({ id: 'contacted', status: 'contacted' }),
      enquiry({ id: 'won', outcome: 'won' }),
    ]
    const g = groupStages(rows, '', now)
    expect(g.your_move.map((r) => r.id)).toEqual(['overdue-old', 'overdue-new', 'today', 'later'])
    expect(g.diary.map((r) => r.id)).toEqual(['diary-1', 'diary-2'])
    expect(g.waiting.map((r) => r.id)).toEqual(['wait-1', 'wait-2', 'contacted'])
    expect(g.finished.map((r) => r.id)).toEqual(['won'])
  })

  it('search narrows every group', () => {
    const rows = [enquiry({ id: 'a' }), enquiry({ id: 'b', answers: { name: 'Other Person' } })]
    expect(groupStages(rows, 'other', now).your_move.map((r) => r.id)).toEqual(['b'])
  })

  it('diary times read short within the week', () => {
    expect(diaryWhen('2026-11-27T15:00:00Z', now)).toBe('Today 15:00')
    expect(diaryWhen('2026-11-28T10:00:00Z', now)).toBe('Tomorrow 10:00')
    expect(diaryWhen('2026-12-01T10:00:00Z', now)).toBe('Tue 10:00')
    expect(diaryWhen('2026-12-08T10:00:00Z', now)).toBe('Tue 8 Dec, 10:00')
  })
})

describe('stripSteps (the strip from the record)', () => {
  const states = (e: ReturnType<typeof enquiry>) =>
    stripSteps(e, stageOf(e, now), now).map((s) => `${s.step}:${s.state}`)

  it('an estimate straight from a call skips the visit; a visit booked after it is now, not done', () => {
    const fromCall = enquiry({ call_held_at: '2026-11-23T10:00:00Z', estimates: [estimate()] })
    expect(states(fromCall)).toEqual([
      'call:done',
      'visit:skipped',
      'estimate:done',
      'quote:todo',
      'deposit:todo',
    ])
    const visitBooked = enquiry({
      call_held_at: '2026-11-23T10:00:00Z',
      estimates: [estimate()],
      bookings: [booking({ starts_at: '2026-12-01T10:00:00Z' })],
    })
    expect(states(visitBooked)).toEqual([
      'call:done',
      'visit:now',
      'estimate:done',
      'quote:todo',
      'deposit:todo',
    ])
  })

  it('a site visit booked with no call: the call is skipped, the visit is now', () => {
    const e = enquiry({ bookings: [booking({ starts_at: '2026-12-01T10:00:00Z' })] })
    expect(states(e)).toEqual([
      'call:skipped',
      'visit:now',
      'estimate:todo',
      'quote:todo',
      'deposit:todo',
    ])
  })

  it('a new enquiry: the call is now and nothing is done', () => {
    expect(states(enquiry())).toEqual([
      'call:now',
      'visit:todo',
      'estimate:todo',
      'quote:todo',
      'deposit:todo',
    ])
  })

  it('lost keeps how far it got and has no now', () => {
    const e = enquiry({
      outcome: 'lost',
      bookings: [booking({ attendance: 'attended' })],
      estimates: [estimate()],
    })
    expect(states(e)).toEqual([
      'call:skipped',
      'visit:done',
      'estimate:done',
      'quote:todo',
      'deposit:todo',
    ])
  })

  it('won with the full history: every step done, the last one "Won", never "Deposit" done', () => {
    const e = enquiry({
      outcome: 'won',
      call_held_at: '2026-11-20T10:00:00Z',
      bookings: [booking({ attendance: 'attended' })],
      estimates: [estimate()],
      quote_amount: 10200,
    })
    expect(states(e)).toEqual([
      'call:done',
      'visit:done',
      'estimate:done',
      'quote:done',
      'deposit:won',
    ])
  })

  it('a quote recorded by hand, then won: the quote stays done; steps never reached are skipped', () => {
    const e = enquiry({
      outcome: 'won',
      quote_amount: 18450,
      bookings: [booking({ attendance: 'attended' })],
    })
    expect(states(e)).toEqual([
      'call:skipped',
      'visit:done',
      'estimate:skipped',
      'quote:done',
      'deposit:won',
    ])
  })

  it('lost after a quote: what happened stays done, no now, the deposit to come', () => {
    const e = enquiry({
      outcome: 'lost',
      bookings: [booking({ attendance: 'attended' })],
      estimates: [estimate()],
      quote_amount: 10200,
    })
    expect(states(e)).toEqual([
      'call:skipped',
      'visit:done',
      'estimate:done',
      'quote:done',
      'deposit:todo',
    ])
  })
})
