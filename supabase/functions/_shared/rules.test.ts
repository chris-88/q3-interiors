import { customerCanChange, planReminder, withoutOwnTime } from './rules.ts'

const H = 3_600_000
const start = Date.parse('2027-03-10T10:00:00Z')

describe('change cut-off', () => {
  it('allows changes until the cut-off and not after', () => {
    expect(customerCanChange(start, start - 3 * H, 120)).toBe(true)
    expect(customerCanChange(start, start - 2 * H - 1, 120)).toBe(true)
    expect(customerCanChange(start, start - 2 * H, 120)).toBe(false)
    expect(customerCanChange(start, start - H, 120)).toBe(false)
    expect(customerCanChange(start, start + H, 120)).toBe(false)
  })

  it('with no cut-off, allows changes until the start', () => {
    expect(customerCanChange(start, start - 1, 0)).toBe(true)
    expect(customerCanChange(start, start, 0)).toBe(false)
  })
})

describe('reminder planning', () => {
  const lead = 24 * 60

  it('plans one reminder the lead time before the start', () => {
    expect(
      planReminder({ start, bookedAt: start - 72 * H, now: start - 72 * H, leadMinutes: lead }),
    ).toBe(start - 24 * H)
  })

  it('skips the reminder when the time was chosen inside the lead time', () => {
    expect(
      planReminder({ start, bookedAt: start - 23 * H, now: start - 23 * H, leadMinutes: lead }),
    ).toBeNull()
    expect(
      planReminder({ start, bookedAt: start - 24 * H + 1, now: start - 30 * H, leadMinutes: lead }),
    ).toBeNull()
  })

  it('sends a missed reminder straight away while the appointment is still ahead', () => {
    expect(
      planReminder({ start, bookedAt: start - 72 * H, now: start - 2 * H, leadMinutes: lead }),
    ).toBe(start - 2 * H)
  })

  it('never plans a reminder for an appointment that has started', () => {
    expect(
      planReminder({ start, bookedAt: start - 72 * H, now: start, leadMinutes: lead }),
    ).toBeNull()
  })

  it('follows the lead time setting', () => {
    expect(
      planReminder({ start, bookedAt: start - 5 * H, now: start - 5 * H, leadMinutes: 60 }),
    ).toBe(start - H)
  })
})

describe('own time removed from busy periods', () => {
  const own = { start: 100, end: 200 }
  it('drops an exact match and trims overlaps, keeping other busy time', () => {
    expect(withoutOwnTime([{ start: 100, end: 200 }], own)).toEqual([])
    expect(withoutOwnTime([{ start: 50, end: 250 }], own)).toEqual([
      { start: 50, end: 100 },
      { start: 200, end: 250 },
    ])
    expect(
      withoutOwnTime(
        [
          { start: 0, end: 50 },
          { start: 300, end: 400 },
        ],
        own,
      ),
    ).toEqual([
      { start: 0, end: 50 },
      { start: 300, end: 400 },
    ])
  })
})
