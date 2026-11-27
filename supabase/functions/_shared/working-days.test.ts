import { describe, expect, it } from 'vitest'
import { addWorkingDays, isPastDate, isWorkingDay } from './working-days.ts'
import { quotePageText, quoteSteps, QUOTE_PAGE_WORDING } from './quote-page.ts'

describe('working days (Monday to Friday, Irish time, no public holidays yet)', () => {
  it('counts from the next day and skips weekends', () => {
    // Friday 27 Nov 2026 + 3 -> Wednesday 2 Dec.
    expect(addWorkingDays('2026-11-27T10:00:00Z', 3)).toBe('2026-12-02')
    // Wednesday + 3 -> Monday.
    expect(addWorkingDays('2026-11-25T09:00:00Z', 3)).toBe('2026-11-30')
    // A Saturday or Sunday request counts from Monday.
    expect(addWorkingDays('2026-11-28T09:00:00Z', 3)).toBe('2026-12-02')
    expect(addWorkingDays('2026-11-29T23:00:00Z', 1)).toBe('2026-11-30')
    // 15 working days is three weeks.
    expect(addWorkingDays('2026-11-27T10:00:00Z', 15)).toBe('2026-12-18')
    expect(addWorkingDays('2026-11-27T10:00:00Z', 0)).toBe('2026-11-27')
  })

  it('uses the Irish date, not UTC', () => {
    // 00:30 Friday 3 July in Ireland is still Thursday in UTC: the Irish date counts.
    expect(addWorkingDays('2026-07-02T23:30:00Z', 1)).toBe('2026-07-06')
    // 00:30 Saturday in Ireland is Friday in UTC: counting starts from the weekend.
    expect(addWorkingDays('2026-07-03T23:30:00Z', 1)).toBe('2026-07-06')
  })

  it('knows weekdays and when a date has passed', () => {
    expect(isWorkingDay('2026-11-27')).toBe(true)
    expect(isWorkingDay('2026-11-28')).toBe(false)
    expect(isPastDate('2026-12-02', Date.parse('2026-12-02T23:30:00Z'))).toBe(false)
    expect(isPastDate('2026-12-02', Date.parse('2026-12-03T00:30:00Z'))).toBe(true)
  })
})

describe('the estimate page text', () => {
  it('fills in the defaults, keeps an emptied timing line empty', () => {
    const t = quotePageText({ quote_timing: '  ', quote_page_ask: '' })
    expect(t.quote_timing).toBe('')
    expect(t.quote_page_ask).toBe(QUOTE_PAGE_WORDING.quote_page_ask.default)
    expect(quotePageText({}).quote_timing).toBe('You’ll have your quote within 3 working days.')
  })

  it('reads the steps one per line, numbering optional', () => {
    expect(quoteSteps(QUOTE_PAGE_WORDING.quote_page_steps.default)).toEqual([
      'We send your quote by email within 3 working days, with a PDF copy.',
      'If you want anything changed or added, tell us and we update the quote.',
      'A 10% deposit books your start date.',
      'We confirm your start date once the deposit is in.',
    ])
    expect(quoteSteps('1. One\n\n2) Two\n')).toEqual(['One', 'Two'])
  })
})
