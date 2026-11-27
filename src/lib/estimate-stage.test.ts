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
    expect(stageLine(e, stage, now)).toBe('Estimate sent 24 Nov: €9,500 to €10,500')
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
    expect(stageLine(asked, s1, now)).toBe(
      'Estimate sent 24 Nov: €9,500 to €10,500 · Quote requested 25 Nov',
    )
    expect(matchesStage(s1.key, 'action')).toBe(true)
    const quiet = { ...base, estimates: [estimate('2026-11-10T15:00:00Z')] }
    const s2 = enquiryStage(quiet, now)
    expect(s2).toEqual({ key: 'no_answer', label: 'No answer in 10 days' })
    expect(stageLine(quiet, s2, now)).toBe(
      'Estimate sent 10 Nov: €9,500 to €10,500 · No answer in 10 days',
    )
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
})
