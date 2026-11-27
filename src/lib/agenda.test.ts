import { describe, expect, it } from 'vitest'
import {
  appointmentBadge,
  dayHeading,
  groupByDay,
  readAgendaFilter,
  splitAgenda,
  type AgendaBooking,
} from './agenda'

// Thursday 26 November 2026, noon in Dublin (UTC in winter).
const now = Date.parse('2026-11-26T12:00:00Z')

const booking = (id: string, start: string, over: Partial<AgendaBooking> = {}): AgendaBooking => ({
  id,
  enquiry_id: `e-${id}`,
  state: 'confirmed',
  starts_at: start,
  ends_at: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
  attendance: null,
  calendar_mismatch: null,
  enquiries: { outcome: null },
  ...over,
})

describe('dayHeading', () => {
  it('names today, tomorrow and yesterday in Irish time, else a short date', () => {
    expect(dayHeading('2026-11-26T18:00:00Z', now)).toBe('Today')
    expect(dayHeading('2026-11-27T09:00:00Z', now)).toBe('Tomorrow')
    expect(dayHeading('2026-11-25T09:00:00Z', now)).toBe('Yesterday')
    expect(dayHeading('2026-11-28T09:00:00Z', now)).toBe('Sat 28 Nov')
    // 23:30 UTC on 26 June is 00:30 on 27 June in Dublin (summer time).
    expect(dayHeading('2027-06-26T23:30:00Z', Date.parse('2027-06-26T12:00:00Z'))).toBe('Tomorrow')
  })
})

describe('splitAgenda and groupByDay', () => {
  const list = [
    booking('later', '2026-11-28T10:00:00Z'),
    booking('soon', '2026-11-26T15:00:00Z'),
    booking('done', '2026-11-25T10:00:00Z'),
    booking('off', '2026-11-27T10:00:00Z', { state: 'cancelled' }),
    booking('odd', '2026-11-27T11:00:00Z', { state: 'awaiting_deposit' }),
    booking('now', '2026-11-26T11:45:00Z'),
  ]
  it('upcoming: not cancelled or failed and not over, soonest first; past: the rest', () => {
    const { upcoming, past } = splitAgenda(list, now)
    expect(upcoming.map((b) => b.id)).toEqual(['now', 'soon', 'odd', 'later'])
    expect(past.map((b) => b.id)).toEqual(['off', 'done'])
  })
  it('groups consecutive appointments by Irish day with plain headings', () => {
    const groups = groupByDay(splitAgenda(list, now).upcoming, now)
    expect(groups.map((g) => [g.heading, g.bookings.map((b) => b.id)])).toEqual([
      ['Today', ['now', 'soon']],
      ['Tomorrow', ['odd']],
      ['Sat 28 Nov', ['later']],
    ])
  })
  it('reads the chip from the address', () => {
    expect(readAgendaFilter('')).toBe('upcoming')
    expect(readAgendaFilter('?show=past')).toBe('past')
    expect(readAgendaFilter('?show=other')).toBe('upcoming')
  })
})

describe('appointmentBadge', () => {
  it('only when something is not normal', () => {
    const base = { state: 'confirmed', attendance: null, calendar_mismatch: null }
    expect(appointmentBadge(base)).toBeNull()
    expect(appointmentBadge({ ...base, attendance: 'attended' })).toBeNull()
    expect(appointmentBadge({ ...base, state: 'cancelled' })?.label).toBe('Cancelled')
    expect(appointmentBadge({ ...base, state: 'failed' })?.label).toBe('Calendar write failed')
    expect(appointmentBadge({ ...base, state: 'calendar_pending' })?.label).toBe('Unconfirmed')
    expect(appointmentBadge({ ...base, calendar_mismatch: 'Event moved' })?.label).toBe(
      'Calendar differs',
    )
    expect(appointmentBadge({ ...base, attendance: 'no_show' })?.label).toBe('No-show')
    expect(appointmentBadge({ ...base, state: 'awaiting_deposit' })?.label).toBe('awaiting_deposit')
  })
})
