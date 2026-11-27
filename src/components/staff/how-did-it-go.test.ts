import { describe, expect, it, vi } from 'vitest'
import type { StaffBooking } from '@/api/staff-booking'

// The component's api modules create the Supabase client on import.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const { outcomeTarget, outcomeTitle } = await import('./how-did-it-go')

const now = Date.parse('2026-11-27T12:00:00Z')
const booking = (over: Partial<StaffBooking> & { mode?: string }): StaffBooking =>
  ({
    id: 'b',
    state: 'confirmed',
    starts_at: '2026-11-24T10:00:00Z',
    attendance: null,
    appointment_types: { label: 'Site visit', mode: over.mode ?? 'on_site' },
    ...over,
  }) as unknown as StaffBooking

describe('How did it go?', () => {
  it('asks about the appointment that has started and has nothing recorded', () => {
    const t = outcomeTarget(
      [booking({ id: 'old', starts_at: '2026-11-20T10:00:00Z' }), booking({})],
      now,
    )
    expect(t).toMatchObject({ kind: 'passed', booking: { id: 'b' } })
    expect(outcomeTitle(t)).toBe('How did the site visit go?')
  })

  it('a recorded one is not asked about again; a call still to come is', () => {
    const t = outcomeTarget(
      [
        booking({ attendance: 'attended' }),
        booking({ id: 'call', mode: 'phone', starts_at: '2026-12-01T11:00:00Z' }),
      ],
      now,
    )
    expect(t).toMatchObject({ kind: 'coming', booking: { id: 'call' } })
    expect(outcomeTitle(t)).toBe('How did the call go?')
  })

  it('with no appointment, it is about ringing them', () => {
    const t = outcomeTarget([booking({ state: 'cancelled' })], now)
    expect(t).toEqual({ kind: 'ring' })
    expect(outcomeTitle(t)).toBe('How did it go?')
  })
})
