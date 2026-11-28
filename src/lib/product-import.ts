// Reading a supplier catalogue file for `npm run products:import` (scripts/products-import.mts).
// The file is untrusted data: one JSON object per line from a fetch of the supplier's public
// pages. Each line becomes a row for public.import_supplier_products (sent as JSON parameters,
// never put into SQL), or is skipped with a reason. Self-contained so Node runs it directly.

export type CatalogueRow = {
  sku: string
  name: string
  /** The supplier's price, VAT included, in cents. */
  price_cents: number
  url: string | null
  category: string | null
}

export type SkipReason =
  | 'not JSON'
  | 'fetch error'
  | 'no name'
  | 'no SKU'
  | 'no price'
  | 'bad price'
  | 'name too long'
  | 'duplicate SKU (later line kept)'

export type ParsedCatalogue = {
  rows: CatalogueRow[]
  lines: number
  skipped: Partial<Record<SkipReason, number>>
}

// Control characters (C0, DEL, C1) and zero-width marks are dropped; runs of white space become one.
// oxlint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g
const tidy = (v: unknown): string =>
  typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : ''

/** "12.80", "€1,234.5", "9" → cents; anything else (or not above zero) → null. */
export function euroToCents(v: unknown): number | null {
  const t = (typeof v === 'number' ? String(v) : tidy(v)).replace(/[€,\s]/g, '')
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null
  const [whole = '0', frac = ''] = t.split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return cents > 0 ? cents : null
}

/** The supplier page, https only and short enough to keep; else none. */
function pageUrl(v: unknown): string | null {
  const t = tidy(v)
  if (!t || t.length > 500) return null
  try {
    return new URL(t).protocol === 'https:' ? t : null
  } catch {
    return null
  }
}

function category(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const parts = v.map(tidy).filter(Boolean)
  const joined = parts.join(' > ')
  return joined ? joined.slice(0, 200) : null
}

/** One line: a row, or why it was skipped. */
export function parseLine(line: string): CatalogueRow | SkipReason | null {
  if (!line.trim()) return null
  let o: unknown
  try {
    o = JSON.parse(line)
  } catch {
    return 'not JSON'
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return 'not JSON'
  const x = o as Record<string, unknown>
  if ('error' in x && x.error) return 'fetch error'
  const name = tidy(x.name)
  if (name.length < 2) return 'no name'
  if (name.length > 200) return 'name too long'
  const sku = tidy(x.sku)
  if (!sku || sku.length > 60) return 'no SKU'
  // price_inc is the VAT-included price; price_ex is unreliable and never read.
  if (x.price_inc === undefined || x.price_inc === null || tidy(String(x.price_inc)) === '')
    return 'no price'
  const price = euroToCents(x.price_inc)
  if (price === null || price > 100_000_000) return 'bad price'
  return { sku, name, price_cents: price, url: pageUrl(x.url), category: category(x.categories) }
}

/** The whole file: rows (one per SKU, the later line kept) and the skipped lines by reason. */
export function parseCatalogue(text: string): ParsedCatalogue {
  const bySku = new Map<string, CatalogueRow>()
  const skipped: ParsedCatalogue['skipped'] = {}
  const skip = (r: SkipReason) => (skipped[r] = (skipped[r] ?? 0) + 1)
  let lines = 0
  for (const line of text.split(/\r?\n/)) {
    const got = parseLine(line)
    if (got === null) continue
    lines++
    if (typeof got === 'string') {
      skip(got)
      continue
    }
    if (bySku.has(got.sku)) {
      skip('duplicate SKU (later line kept)')
      bySku.delete(got.sku)
    }
    bySku.set(got.sku, got)
  }
  return { rows: [...bySku.values()], lines, skipped }
}

/** Rows in batches for the database function (at most 1,000 a call). */
export function batches<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

export type ImportCounts = {
  added: number
  updated: number
  unchanged: number
  kept_your_price: number
  invalid: number
}

export function addCounts(a: ImportCounts, b: Partial<ImportCounts>): ImportCounts {
  return {
    added: a.added + (b.added ?? 0),
    updated: a.updated + (b.updated ?? 0),
    unchanged: a.unchanged + (b.unchanged ?? 0),
    kept_your_price: a.kept_your_price + (b.kept_your_price ?? 0),
    invalid: a.invalid + (b.invalid ?? 0),
  }
}
