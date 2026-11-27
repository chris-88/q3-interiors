import { describe, expect, it } from 'vitest'
import { enquiryStage, matchesStage, nextStep, stageLine, type StageBooking } from './enquiry-stage'

const now = Date.parse('2026-11-26T12:00:00Z')
const past: StageBooking = {
  starts_at: '2026-11-20T10:00:00Z',
  confirmed_at: '2026-11-18T10:00:00Z',
  state: 'confirmed',
  mode: 'on_site',
}
const base = {
  status: 'contacted',
  outcome: null,
  contact_requested_at: null,
  bookings: [past],
  answers: {},
}
const estimate = (sent: string, requested: string | null = null) => ({
  sent_at: sent,
  valid_until: new Date(Date.parse(sent) + 10 * 86_400_000).toISOString(),
  low_eur: 9500,
  high_eur: 10500,
  quote_requested_at: requested,
})

describe('estimates in the stage', () => {
  it('shows an open estimate with its range', () => {
    const e = { ...base, estimates: [estimate('2026-11-24T15:00:00Z')] }
    const stage = enquiryStage(e, now)
    expect(stage).toEqual({ key: 'estimate_sent', label: 'Estimate sent' })
    expect(stageLine(e, stage, now)).toBe('Estimate sent 24 Nov · €9,500 to €10,500')
    expect(nextStep(stage.key)).toBe('estimate')
    expect(matchesStage(stage.key, 'action')).toBe(false)
  })

  it('needs action once a quote is asked for, or after 10 days with no answer', () => {
    const asked = {
      ...base,
      estimates: [estimate('2026-11-24T15:00:00Z', '2026-11-25T09:00:00Z')],
    }
    const s1 = enquiryStage(asked, now)
    expect(s1.key).toBe('quote_requested')
    // News first, so the important part is not cut off on a phone.
    expect(stageLine(asked, s1, now)).toBe('Quote requested 25 Nov · €9,500 to €10,500')
    expect(matchesStage(s1.key, 'action')).toBe(true)
    const quiet = {
      ...base,
      bookings: [{ ...past, starts_at: '2026-11-09T10:00:00Z' }],
      estimates: [estimate('2026-11-10T15:00:00Z')],
    }
    const s2 = enquiryStage(quiet, now)
    expect(s2).toEqual({ key: 'no_answer', label: 'No answer in 10 days' })
    expect(stageLine(quiet, s2, now)).toBe('No answer in 10 days · €9,500 to €10,500')
    expect(matchesStage(s2.key, 'action')).toBe(true)
  })

  it('uses the newest estimate, and an outcome still wins', () => {
    const two = {
      ...base,
      estimates: [estimate('2026-11-10T15:00:00Z'), estimate('2026-11-25T15:00:00Z')],
    }
    expect(enquiryStage(two, now).key).toBe('estimate_sent')
    expect(enquiryStage({ ...two, outcome: 'quoted' }, now).key).toBe('quoted')
    expect(enquiryStage({ ...base, estimates: undefined }, now).key).toBe('awaiting_quote')
  })

  it('flags a quote that is past its due date (3 working days)', () => {
    const asked = {
      ...base,
      bookings: [{ ...past, starts_at: '2026-11-17T10:00:00Z' }],
      estimates: [estimate('2026-11-18T15:00:00Z', '2026-11-20T09:00:00Z')],
    }
    const stage = enquiryStage(asked, now)
    expect(stageLine(asked, stage, now)).toBe(
      'Quote overdue, was due Wed 25 Nov · €9,500 to €10,500',
    )
  })

  it('never hides a visit still to come behind an estimate (call held, estimate, visit booked)', () => {
    const call: StageBooking = {
      starts_at: '2026-11-18T10:00:00Z',
      confirmed_at: '2026-11-15T10:00:00Z',
      state: 'confirmed',
      mode: 'phone',
      attendance: 'attended',
    }
    const visit: StageBooking = {
      starts_at: '2026-11-28T10:00:00Z',
      confirmed_at: '2026-11-25T10:00:00Z',
      state: 'confirmed',
      mode: 'on_site',
    }
    const e = {
      ...base,
      bookings: [call, visit],
      estimates: [estimate('2026-11-20T15:00:00Z', '2026-11-21T09:00:00Z')],
    }
    const stage = enquiryStage(e, now)
    expect(stage).toEqual({ key: 'booked', label: 'Booked' })
    expect(nextStep(stage.key)).toBe('appointment')
    expect(stageLine(e, stage, now)).toBe('Site visit Sat 28 Nov, 10:00 · Estimate sent 20 Nov')
    // Once that visit has happened, the next thing is a new estimate based on it.
    const later = Date.parse('2026-11-28T12:00:00Z')
    const after = enquiryStage(e, later)
    expect(after).toEqual({ key: 'awaiting_quote', label: 'Estimate to write' })
    expect(nextStep(after.key)).toBe('record')
    // A call after the estimate does not reopen it.
    const rang = { ...e, bookings: [call, { ...visit, mode: 'phone' }] }
    expect(enquiryStage(rang, later).key).toBe('quote_requested')
  })
})
