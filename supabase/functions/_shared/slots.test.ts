import { generateSlots, type AvailabilityRules, type Interval, type SlotType } from './slots.ts'
import { fromLocal, toLocal } from './time.ts'

const weekdays9to5 = Object.fromEntries(
  ['1', '2', '3', '4', '5'].map((d) => [d, [['09:00', '17:00']] as [string, string][]]),
)

const rules: AvailabilityRules = {
  weeklyHours: weekdays9to5,
  minNoticeMinutes: 24 * 60,
  horizonDays: 21,
  dailyVisitLimit: 3,
  slotStepMinutes: 30,
}

const phone: SlotType = {
  mode: 'phone',
  durationMinutes: 20,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
}
const visit: SlotType = {
  mode: 'on_site',
  durationMinutes: 60,
  bufferBeforeMinutes: 30,
  bufferAfterMinutes: 30,
}

const at = (iso: string) => Date.parse(iso)
const local = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number)
  const instant = fromLocal(date, (h ?? 0) * 60 + (m ?? 0))
  if (instant === null) throw new Error(`no such local time ${date} ${time}`)
  return instant
}
const day = (slots: { date: string; time: string }[], date: string) =>
  slots.filter((s) => s.date === date).map((s) => s.time)

describe('generateSlots', () => {
  it('offers working-hours slots from the end of the notice period, in Irish time', () => {
    // Monday 1 March 2027, 08:00 GMT.
    const slots = generateSlots({
      now: at('2027-03-01T08:00:00Z'),
      type: phone,
      rules,
      busy: [],
      reservations: [],
    })
    expect(slots[0]).toEqual({
      start: '2027-03-02T09:00:00.000Z',
      end: '2027-03-02T09:20:00.000Z',
      date: '2027-03-02',
      time: '09:00',
    })
    expect(day(slots, '2027-03-01')).toEqual([])
    const tuesday = day(slots, '2027-03-02')
    expect(tuesday).toHaveLength(16)
    expect(tuesday.at(-1)).toBe('16:30')
    expect(day(slots, '2027-03-06')).toEqual([]) // Saturday
  })

  it('honours the minimum notice to the minute', () => {
    const slots = generateSlots({
      now: at('2027-03-01T10:15:00Z'),
      type: phone,
      rules,
      busy: [],
      reservations: [],
    })
    expect(slots[0]?.start).toBe('2027-03-02T10:30:00.000Z')
  })

  it('stops at the booking horizon, counted in local days including today', () => {
    const slots = generateSlots({
      now: at('2027-03-01T06:00:00Z'),
      type: phone,
      rules: { ...rules, minNoticeMinutes: 0, horizonDays: 2 },
      busy: [],
      reservations: [],
    })
    expect(new Set(slots.map((s) => s.date))).toEqual(new Set(['2027-03-01', '2027-03-02']))
  })

  it('keeps 09:00 local across the March clock change (GMT to IST)', () => {
    const slots = generateSlots({
      now: at('2027-03-25T06:00:00Z'),
      type: phone,
      rules: { ...rules, minNoticeMinutes: 0, horizonDays: 7 },
      busy: [],
      reservations: [],
    })
    const first = (date: string) => slots.find((s) => s.date === date)
    expect(first('2027-03-26')?.start).toBe('2027-03-26T09:00:00.000Z') // Friday, GMT
    expect(first('2027-03-29')?.start).toBe('2027-03-29T08:00:00.000Z') // Monday, IST
    expect(first('2027-03-29')?.time).toBe('09:00')
    expect(day(slots, '2027-03-29').at(-1)).toBe('16:30')
  })

  it('keeps 09:00 local across the October clock change (IST to GMT)', () => {
    const slots = generateSlots({
      now: at('2027-10-28T06:00:00Z'),
      type: phone,
      rules: { ...rules, minNoticeMinutes: 0, horizonDays: 7 },
      busy: [],
      reservations: [],
    })
    expect(slots.find((s) => s.date === '2027-10-29')?.start).toBe('2027-10-29T08:00:00.000Z') // Friday, IST
    expect(slots.find((s) => s.date === '2027-11-01')?.start).toBe('2027-11-01T09:00:00.000Z') // Monday, GMT
  })

  it('skips wall times that do not exist when the clocks go forward', () => {
    const slots = generateSlots({
      now: at('2027-03-27T12:00:00Z'),
      type: phone,
      rules: {
        ...rules,
        weeklyHours: { '7': [['00:30', '03:00']] },
        minNoticeMinutes: 0,
        horizonDays: 2,
      },
      busy: [],
      reservations: [],
    })
    // Sunday 28 March 2027: 01:00 to 02:00 local does not exist.
    expect(day(slots, '2027-03-28')).toEqual(['00:30', '02:00', '02:30'])
    expect(slots.map((s) => s.start)).toEqual([
      '2027-03-28T00:30:00.000Z',
      '2027-03-28T01:00:00.000Z',
      '2027-03-28T01:30:00.000Z',
    ])
  })

  it('keeps the window end in real time on the day the clocks go back', () => {
    // Sunday 31 October 2027, 00:00-03:00 local is four real hours; 60-minute slots fit until 02:00.
    const slots = generateSlots({
      now: at('2027-10-30T12:00:00Z'),
      type: { ...phone, durationMinutes: 60, bufferAfterMinutes: 0 },
      rules: {
        ...rules,
        weeklyHours: { '7': [['00:00', '03:00']] },
        minNoticeMinutes: 0,
        horizonDays: 2,
        slotStepMinutes: 60,
      },
      busy: [],
      reservations: [],
    })
    for (const s of slots) {
      expect(Date.parse(s.end)).toBeLessThanOrEqual(local('2027-10-31', '03:00'))
    }
    expect(day(slots, '2027-10-31')).toContain('00:00')
  })

  it('treats an all-day busy event as blocking the whole day', () => {
    const allDay: Interval = {
      start: local('2027-03-03', '00:00'),
      end: local('2027-03-04', '00:00'),
    }
    const slots = generateSlots({
      now: at('2027-03-01T08:00:00Z'),
      type: phone,
      rules,
      busy: [allDay],
      reservations: [],
    })
    expect(day(slots, '2027-03-03')).toEqual([])
    expect(day(slots, '2027-03-04')).toHaveLength(16)
  })

  it('excludes every occurrence of a recurring busy period, including the buffers', () => {
    const lunches: Interval[] = ['2027-03-02', '2027-03-03', '2027-03-04'].map((d) => ({
      start: local(d, '12:00'),
      end: local(d, '13:00'),
    }))
    const slots = generateSlots({
      now: at('2027-03-01T08:00:00Z'),
      type: visit,
      rules,
      busy: lunches,
      reservations: [],
    })
    for (const d of ['2027-03-02', '2027-03-03', '2027-03-04']) {
      const times = day(slots, d)
      // A visit at 10:30 ends 11:30 and its travel buffer ends exactly at 12:00: allowed.
      expect(times).toContain('10:30')
      // 11:00, 11:30, 12:00, 12:30 and 13:00 would touch the lunch with the visit or a buffer.
      for (const t of ['11:00', '11:30', '12:00', '12:30', '13:00']) expect(times).not.toContain(t)
      expect(times).toContain('13:30')
    }
    expect(day(slots, '2027-03-05')).toContain('12:00')
  })

  it('keeps buffers clear of existing bookings', () => {
    const existing = { start: local('2027-03-02', '10:00'), end: local('2027-03-02', '11:00') }
    const reservation = {
      blocked: { start: existing.start - 30 * 60_000, end: existing.end + 30 * 60_000 },
      start: existing.start,
      mode: 'on_site' as const,
    }
    const times = day(
      generateSlots({
        now: at('2027-03-01T08:00:00Z'),
        type: phone,
        rules,
        busy: [],
        reservations: [reservation],
      }),
      '2027-03-02',
    )
    // Phone call 20 min + 10 min after-buffer must end by 09:30.
    expect(times).toContain('09:00')
    expect(times).not.toContain('09:30')
    expect(times).not.toContain('11:00')
    expect(times).toContain('11:30')
  })

  it('stops offering visits on a day that has reached the daily visit limit', () => {
    const visitAt = (time: string) => {
      const start = local('2027-03-02', time)
      return {
        blocked: { start: start - 1_800_000, end: start + 5_400_000 },
        start,
        mode: 'on_site' as const,
      }
    }
    const input = {
      now: at('2027-03-01T08:00:00Z'),
      rules: { ...rules, dailyVisitLimit: 2 },
      busy: [],
      reservations: [visitAt('09:30'), visitAt('14:00')],
    }
    expect(day(generateSlots({ ...input, type: visit }), '2027-03-02')).toEqual([])
    expect(day(generateSlots({ ...input, type: phone }), '2027-03-02')).toContain('12:00')
    expect(day(generateSlots({ ...input, type: visit }), '2027-03-03')).not.toEqual([])
  })

  it('reports local date and time consistently with the instant', () => {
    const slots = generateSlots({
      now: at('2027-06-01T08:00:00Z'),
      type: visit,
      rules,
      busy: [],
      reservations: [],
    })
    for (const s of slots.slice(0, 20)) {
      const l = toLocal(Date.parse(s.start))
      expect(l.date).toBe(s.date)
      expect(
        `${String(Math.floor(l.minutes / 60)).padStart(2, '0')}:${String(l.minutes % 60).padStart(2, '0')}`,
      ).toBe(s.time)
    }
  })
})
