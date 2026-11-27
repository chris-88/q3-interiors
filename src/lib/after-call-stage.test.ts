import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/20261129140000_after_call.sql?raw'
import { WORDING } from '../../supabase/functions/_shared/messages'
import {
  callHeldAt,
  enquiryStage,
  matchesStage,
  nextStep,
  stageLine,
  type StageBooking,
} from './enquiry-stage'

const now = Date.parse('2026-11-27T12:00:00Z')
const call = (over: Partial<StageBooking> = {}): StageBooking => ({
  starts_at: '2026-11-25T10:00:00Z',
  confirmed_at: '2026-11-20T10:00:00Z',
  state: 'confirmed',
  mode: 'phone',
  attendance: null,
  ...over,
})
const base = {
  status: 'contacted',
  outcome: null,
  contact_requested_at: null,
  bookings: [] as StageBooking[],
  answers: {},
}

describe('after the call', () => {
  it('a past call waits for its attendance, then offers the next step', () => {
    const waiting = { ...base, bookings: [call()] }
    expect(enquiryStage(waiting, now).key).toBe('to_record')
    const held = { ...base, bookings: [call({ attendance: 'attended' })] }
    const stage = enquiryStage(held, now)
    expect(stage).toEqual({ key: 'call_held', label: 'Call held' })
    expect(stageLine(held, stage, now)).toBe('Call held 25 Nov, next step to choose')
    expect(nextStep(stage.key)).toBe('after_call')
    expect(matchesStage(stage.key, 'action')).toBe(true)
    // A no-show is not a held call: it is a missed call, to ring or rebook.
    const missed = { ...base, bookings: [call({ attendance: 'no_show' })] }
    const m = enquiryStage(missed, now)
    expect(m).toEqual({ key: 'missed_call', label: 'Missed call' })
    expect(stageLine(missed, m, now)).toBe('Missed call Wed 25 Nov · ring or rebook')
    expect(nextStep(m.key)).toBe('missed')
    expect(matchesStage(m.key, 'action')).toBe(true)
  })

  it('a missed site visit reads Missed visit; anything since it moves on', () => {
    const visit = call({ mode: 'on_site', attendance: 'no_show' })
    const missed = { ...base, bookings: [visit] }
    const m = enquiryStage(missed, now)
    expect(m).toEqual({ key: 'missed_visit', label: 'Missed visit' })
    expect(stageLine(missed, m, now)).toBe('Missed visit Wed 25 Nov · ring or rebook')
    expect(nextStep(m.key)).toBe('missed')
    // Rebooked: the new appointment leads.
    const rebooked = {
      ...missed,
      bookings: [visit, call({ mode: 'on_site', starts_at: '2026-12-02T10:00:00Z' })],
    }
    expect(enquiryStage(rebooked, now).key).toBe('booked')
    // "We already spoke" after the missed call: the call is held.
    const spoke = {
      ...base,
      bookings: [call({ attendance: 'no_show' })],
      call_held_at: '2026-11-26T09:30:00Z',
    }
    expect(enquiryStage(spoke, now).key).toBe('call_held')
    // An estimate sent after it: the estimate's stage.
    const estimated = {
      ...missed,
      estimates: [
        {
          sent_at: '2026-11-26T09:00:00Z',
          valid_until: '2026-12-06T09:00:00Z',
          low_eur: 9500,
          high_eur: 10500,
          quote_requested_at: null,
        },
      ],
    }
    expect(enquiryStage(estimated, now).key).toBe('estimate_sent')
    // An outcome still wins.
    expect(enquiryStage({ ...missed, outcome: 'lost' }, now).key).toBe('lost')
  })

  it('"We already spoke" holds the call with or without a booking', () => {
    const early = { ...base, call_held_at: '2026-11-26T09:30:00Z' }
    expect(enquiryStage(early, now).key).toBe('call_held')
    const cancelled = {
      ...early,
      bookings: [call({ starts_at: '2026-11-29T10:00:00Z', state: 'cancelled' })],
    }
    expect(enquiryStage(cancelled, now).key).toBe('call_held')
    expect(callHeldAt(cancelled, now)).toBe('2026-11-26T09:30:00Z')
  })

  it('shows the link sent until they book, then the visit', () => {
    const sent = {
      ...base,
      call_held_at: '2026-11-26T09:30:00Z',
      visit_link_sent_at: '2026-11-27T09:00:00Z',
    }
    const stage = enquiryStage(sent, now)
    expect(stage).toEqual({ key: 'link_sent', label: 'Site visit link sent' })
    expect(stageLine(sent, stage, now)).toBe('Site visit link sent 27 Nov')
    expect(nextStep(stage.key)).toBe('after_call')
    expect(matchesStage(stage.key, 'action')).toBe(false)
    // A link sent before the call was held does not count.
    expect(enquiryStage({ ...sent, visit_link_sent_at: '2026-11-25T09:00:00Z' }, now).key).toBe(
      'call_held',
    )
    const visit: StageBooking = {
      starts_at: '2026-12-02T10:00:00Z',
      confirmed_at: '2026-11-27T11:00:00Z',
      state: 'confirmed',
      mode: 'on_site',
    }
    expect(enquiryStage({ ...sent, bookings: [visit] }, now).key).toBe('booked')
    // Once that visit's time has passed, it is the visit that is asked about, then the estimate.
    const later = Date.parse('2026-12-03T12:00:00Z')
    expect(enquiryStage({ ...sent, bookings: [visit] }, later).key).toBe('to_record')
    expect(
      enquiryStage({ ...sent, bookings: [{ ...visit, attendance: 'attended' }] }, later).key,
    ).toBe('awaiting_quote')
  })

  it('an estimate after the call takes over the stage', () => {
    const e = {
      ...base,
      call_held_at: '2026-11-26T09:30:00Z',
      estimates: [
        {
          sent_at: '2026-11-27T10:00:00Z',
          valid_until: '2026-12-07T10:00:00Z',
          low_eur: 9500,
          high_eur: 10500,
          quote_requested_at: null,
        },
      ],
    }
    expect(enquiryStage(e, now).key).toBe('estimate_sent')
  })

  it('the database default for the after-call caveats is the email default', () => {
    expect(migration).toContain(`select '${WORDING.estimate_call_caveats.default}'::text`)
  })
})
