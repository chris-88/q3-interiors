import { z } from 'zod'

/*
 * Reading data that a newer release may already have written. Migrations are applied before a
 * deploy, so an open page always meets new data for a while: new enum values, new event kinds,
 * extra columns, new form versions. The rule (CLAUDE.md, "Forward compatibility"): a read path
 * tolerates what it does not know and degrades to a plain rendering, never to a failed screen.
 *
 * - `openEnum`: the known values for typing and labels, but any string is accepted.
 * - `parseRows`: lists are parsed row by row; a row that still does not fit is left out, counted
 *   (`useSkippedRows`) and its issue paths (never values) logged.
 * - `parseOne`: a single object; a mismatch throws `DataShapeError`, which the staff console
 *   answers by checking for a newer build (reload) or a plain "Reload" message.
 */

/** A string that is one of `values` as far as types go, or something newer. */
export type Open<T extends string> = T | (string & Record<never, never>)

export function openEnum<const T extends readonly [string, ...string[]]>(_values: T) {
  return z.string() as unknown as z.ZodType<Open<T[number]>, string>
}

export function isKnown<const T extends readonly string[]>(
  values: T,
  value: string | null | undefined,
): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

/** A response this build could not read. `paths` name the fields, never their values. */
export class DataShapeError extends Error {
  readonly where: string
  readonly paths: string[]
  constructor(where: string, paths: string[]) {
    super(`Could not read ${where}`)
    this.name = 'DataShapeError'
    this.where = where
    this.paths = paths
  }
}

function issuePaths(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => i.path.join('.') || '(root)'))].slice(0, 10)
}

// Rows left out, per list, for the console's notice.
const skipped = new Map<string, number>()
const listeners = new Set<() => void>()
let snapshot: [string, number][] = []

function report(where: string, count: number) {
  if (count === 0 ? !skipped.has(where) : skipped.get(where) === count) return
  if (count === 0) skipped.delete(where)
  else skipped.set(where, count)
  snapshot = [...skipped.entries()]
  listeners.forEach((l) => l())
}

export function subscribeSkipped(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function skippedSnapshot(): [string, number][] {
  return snapshot
}

export function parseRows<S extends z.ZodType>(
  schema: S,
  data: unknown,
  where: string,
): z.output<S>[] {
  if (!Array.isArray(data)) throw new DataShapeError(where, ['(not a list)'])
  const rows: z.output<S>[] = []
  let left = 0
  for (const [index, row] of data.entries()) {
    const parsed = schema.safeParse(row)
    if (parsed.success) {
      rows.push(parsed.data)
    } else {
      left += 1
      console.warn(`Q3: left out a ${where} row this version cannot read`, {
        index,
        paths: issuePaths(parsed.error),
      })
    }
  }
  report(where, left)
  return rows
}

export function parseOne<S extends z.ZodType>(
  schema: S,
  data: unknown,
  where: string,
): z.output<S> {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  const paths = issuePaths(parsed.error)
  console.warn(`Q3: could not read ${where}`, { paths })
  throw new DataShapeError(where, paths)
}
