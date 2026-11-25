import { bookLabel, formatSlotShort, recapLine, routeTitle, suggestSlots } from './journey'

const slot = (date: string, time: string) => ({
  date,
  time,
  // Winter: Irish time is UTC.
  start: `${date}T${time}:00.000Z`,
  end: `${date}T${time}:00.000Z`,
})

describe('suggestSlots', () => {
  it('spreads three suggestions across different days', () => {
    const slots = [
      slot('2026-11-27', '10:00'),
      slot('2026-11-27', '10:30'),
      slot('2026-11-30', '09:00'),
      slot('2026-11-30', '11:00'),
      slot('2026-12-01', '14:00'),
      slot('2026-12-02', '09:00'),
    ]
    expect(suggestSlots(slots).map((s) => s.start)).toEqual([
      '2026-11-27T10:00:00.000Z',
      '2026-11-30T09:00:00.000Z',
      '2026-12-01T14:00:00.000Z',
    ])
  })

  it('fills from the earliest remaining times when there are fewer days', () => {
    const slots = [
      slot('2026-11-30', '11:00'),
      slot('2026-11-27', '10:30'),
      slot('2026-11-27', '10:00'),
    ]
    expect(suggestSlots(slots).map((s) => `${s.date} ${s.time}`)).toEqual([
      '2026-11-27 10:00',
      '2026-11-27 10:30',
      '2026-11-30 11:00',
    ])
  })

  it('shows only what can be booked', () => {
    expect(suggestSlots([slot('2026-11-27', '10:00')])).toHaveLength(1)
    expect(suggestSlots([])).toEqual([])
  })
})

describe('labels', () => {
  it('words the book button with the chosen day and time in Irish time', () => {
    expect(formatSlotShort('2026-11-27T10:30:00Z')).toBe('Fri 27 Nov, 10:30')
    // Summer time: 09:30 UTC is 10:30 in Dublin.
    expect(formatSlotShort('2027-06-04T09:30:00Z')).toBe('Fri 4 Jun, 10:30')
    expect(bookLabel('phone', { start: '2026-11-27T10:30:00Z' })).toBe(
      'Book call · Fri 27 Nov, 10:30',
    )
    expect(bookLabel('on_site', null)).toBe('Book site visit')
  })

  it('builds the route title and the recap', () => {
    expect(routeTitle('phone', 20)).toBe('Phone call · 20 minutes')
    expect(routeTitle('on_site', null)).toBe('Site visit')
    expect(recapLine('on_site', 'Kitchen', 'Dublin 8')).toBe('Site visit · Kitchen · Dublin 8')
    expect(recapLine('phone', null, 'Cork')).toBe('Phone call · Cork')
  })
})
