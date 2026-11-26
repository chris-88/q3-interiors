import { z } from 'zod'
import { parseRows } from './tolerant'

/** The pilot report from `pilot_report(from, to)`, and the arithmetic the page shows. */

const count = z.number().int().nonnegative()

export const pilotRowSchema = z.object({
  dim: z.enum(['all', 'version', 'route', 'campaign', 'content']),
  key: z.string(),
  sessions: count.nullable(),
  chose: count.nullable(),
  saved: count,
  booked: count,
  attended: count,
  suitable_attended: count,
  chased: count,
  // Slice 7; defaults keep this page reading a report from before it.
  quoted: count.default(0),
  won: count.default(0),
  won_value: z.coerce.number().default(0),
  median_to_saved_seconds: z.number().nullable(),
  median_to_booked_seconds: z.number().nullable(),
})
export type PilotRow = z.infer<typeof pilotRowSchema>

export const pilotReportSchema = z.object({
  counted_from: z.string(),
  // Row by row: a dimension a newer release adds is left out, not fatal.
  rows: z.array(z.unknown()).transform((rows) => parseRows(pilotRowSchema, rows, 'pilot measures')),
  headline: z.object({ instagram_sessions: count, instagram_suitable_attended: count }),
})
export type PilotReport = z.infer<typeof pilotReportSchema>

/** YYYY-MM-DD (Irish date) when session counting began. */
export function countedFromDate(report: PilotReport): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(
    new Date(report.counted_from),
  )
}

/**
 * Sessions for a row, or null for "not counted": form v1 never had sessions, and nothing was
 * counted for a range that ends before counting began. Inside the counted period a missing
 * number is a real zero.
 */
export function sessionsFor(row: PilotRow, report: PilotReport, to: string): number | null {
  if (row.dim === 'version' && row.key === '1') return null
  if (to < countedFromDate(report)) return null
  return row.sessions ?? 0
}

/** Per 100 landing sessions, one decimal; null when there is nothing to divide by. */
export function per100(part: number, sessions: number | null): number | null {
  if (sessions === null || sessions === 0) return null
  return Math.round((part / sessions) * 1000) / 10
}

export function formatPer100(value: number | null, sessions: number | null): string {
  if (sessions === null) return 'not counted'
  return value === null ? '–' : value.toFixed(1)
}

export function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

/** "4 min", "2 h 5 min", "3 days"; "–" when there is no joined session. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '–'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  return `${Math.round(hours / 24)} days`
}

const LABELS: Record<string, string> = {
  'all:all': 'All',
  'version:1': 'Form v1',
  'version:2': 'Form v2',
  'version:3': 'Form v3',
  'route:phone': 'Phone call',
  'route:on_site': 'Site visit',
  'route:none': 'No route chosen',
  'route:unknown': 'Route not known',
  'campaign:(unknown)': 'No campaign tag',
  'content:(none)': 'No ad tag (utm_content)',
  'content:(other)': 'Other ads (smaller ones, together)',
}

export function rowLabel(row: PilotRow): string {
  return LABELS[`${row.dim}:${row.key}`] ?? row.key
}

export function rowsFor(report: PilotReport, dim: PilotRow['dim']): PilotRow[] {
  return report.rows.filter((r) => r.dim === dim)
}

/** One campaign split by ad (`pilot_report_by_content`): one row per utm_content, capped. */
export const contentReportSchema = z.object({
  campaign: z.string(),
  cap: z.number().int().default(25),
  rows: z
    .array(z.unknown())
    .transform((rows) => parseRows(pilotRowSchema, rows, 'pilot measures by ad')),
})
export type ContentReport = z.infer<typeof contentReportSchema>
