/** One campaign's counts from `funnel_report`. */
export type FunnelRow = {
  campaign: string
  enquiries: number
  booked: number
  attended: number
  won: number
  cancelled: number
  no_shows: number
  won_value: number
}

export type FunnelStage = {
  label: string
  count: number
  fromPrevious: number | null
  fromStart: number | null
}

/** A share in [0, 1], or null when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

export function formatRate(value: number | null): string {
  return value === null ? '–' : `${Math.round(value * 100)}%`
}

export function totals(rows: FunnelRow[]): FunnelRow {
  return rows.reduce<FunnelRow>(
    (sum, r) => ({
      campaign: 'All campaigns',
      enquiries: sum.enquiries + r.enquiries,
      booked: sum.booked + r.booked,
      attended: sum.attended + r.attended,
      won: sum.won + r.won,
      cancelled: sum.cancelled + r.cancelled,
      no_shows: sum.no_shows + r.no_shows,
      won_value: sum.won_value + r.won_value,
    }),
    {
      campaign: 'All campaigns',
      enquiries: 0,
      booked: 0,
      attended: 0,
      won: 0,
      cancelled: 0,
      no_shows: 0,
      won_value: 0,
    },
  )
}

/** Enquiries -> booked -> attended -> won, each with the rate from the step before and from the start. */
export function stages(row: FunnelRow): FunnelStage[] {
  const steps: [string, number][] = [
    ['Enquiries', row.enquiries],
    ['Booked', row.booked],
    ['Attended', row.attended],
    ['Won', row.won],
  ]
  return steps.map(([label, count], i) => ({
    label,
    count,
    fromPrevious: i === 0 ? null : rate(count, steps[i - 1]?.[1] ?? 0),
    fromStart: i === 0 ? null : rate(count, row.enquiries),
  }))
}
