import { describe, expect, it } from 'vitest'
import {
  estimateRange,
  formatEuro,
  formatPercent,
  formatRange,
  isValidPercent,
  PERCENT_OPTIONS,
} from './estimate'

// The same cases as private.estimate_range in supabase/tests/estimates.sql.
const CASES: [number, number, number, number][] = [
  [100, 5, 95, 105],
  [10000, 5, 9500, 10500],
  [999, 10, 900, 1100],
  [1000, 10, 900, 1100],
  [12345, 7.5, 11400, 13250],
  [870, 0.5, 865, 875],
  [9999, 30, 7000, 13000],
  [250, 0, 250, 250],
]

describe('estimate range', () => {
  it.each(CASES)('%i at %s%% is %i to %i', (price, percent, low, high) => {
    expect(estimateRange(price, percent)).toEqual({ low, high })
  })

  it('rounds to 50 from 1,000 and to 5 below', () => {
    expect(estimateRange(1000, 2.5)).toEqual({ low: 1000, high: 1050 })
    expect(estimateRange(990, 2.5)).toEqual({ low: 965, high: 1015 })
  })

  it('takes percents from 0 to 30 in half steps, and whole euro from 100', () => {
    expect(PERCENT_OPTIONS).toHaveLength(61)
    expect(PERCENT_OPTIONS[1]).toBe(0.5)
    expect(isValidPercent(10)).toBe(true)
    expect(isValidPercent(10.25)).toBe(false)
    expect(isValidPercent(30.5)).toBe(false)
    expect(() => estimateRange(99, 10)).toThrow(RangeError)
    expect(() => estimateRange(1000.5, 10)).toThrow(RangeError)
    expect(() => estimateRange(1000, 31)).toThrow(RangeError)
  })

  it('writes the range plainly', () => {
    expect(formatRange(9500, 10500)).toBe('€9,500 to €10,500')
    expect(formatEuro(95)).toBe('€95')
    expect(formatPercent(7.5)).toBe('7.5')
    expect(formatPercent(10)).toBe('10')
  })
})
