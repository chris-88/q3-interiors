// The estimate rules, shared by the staff console (form, live preview) and the functions (email).
// The database applies the same range rule in private.estimate_range; tests pin both.

/** Whole euro, VAT included. */
export const PRICE_MIN = 100
export const PRICE_MAX = 10_000_000
/** Plus or minus, in steps of half a percent. */
export const PERCENT_MIN = 0
export const PERCENT_MAX = 30
export const PERCENT_STEP = 0.5
export const PERCENT_DEFAULT = 10
export const WORK_MIN = 3
export const WORK_MAX = 600
/** How long an estimate stays open. */
export const VALID_DAYS = 10

export const PERCENT_OPTIONS: number[] = Array.from(
  { length: (PERCENT_MAX - PERCENT_MIN) / PERCENT_STEP + 1 },
  (_, i) => PERCENT_MIN + i * PERCENT_STEP,
)

export function isValidPercent(percent: number): boolean {
  return (
    Number.isFinite(percent) &&
    percent >= PERCENT_MIN &&
    percent <= PERCENT_MAX &&
    Number.isInteger(percent * 2)
  )
}

/**
 * low = price x (1 - p), high = price x (1 + p), each rounded to the nearest 50 euro when the
 * price is 1,000 or more, otherwise to the nearest 5 euro (halves round up). 100 at 5% is 95 to
 * 105. Worked in tenths of a percent so no floating-point error decides a rounding.
 */
export function estimateRange(price: number, percent: number): { low: number; high: number } {
  if (!Number.isInteger(price) || price < PRICE_MIN || price > PRICE_MAX)
    throw new RangeError('price')
  if (!isValidPercent(percent)) throw new RangeError('percent')
  const tenths = Math.round(percent * 10)
  const unit = price >= 1000 ? 50 : 5
  const round = (scaled: number) => Math.round(scaled / (1000 * unit)) * unit
  return { low: round(price * (1000 - tenths)), high: round(price * (1000 + tenths)) }
}

/** "€9,500" */
export function formatEuro(value: number): string {
  return `€${new Intl.NumberFormat('en-IE', { maximumFractionDigits: 0 }).format(value)}`
}

/** "€9,500 to €10,500" */
export function formatRange(low: number, high: number): string {
  return `${formatEuro(low)} to ${formatEuro(high)}`
}

/** "5" for 5.0, "7.5" for 7.5. */
export function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1)
}
