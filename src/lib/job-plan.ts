// The job plan's arithmetic and search, pure and unit-tested (src/lib/job-plan.test.ts). Money is
// whole cents everywhere; a line's total is its quantity times its price each, rounded to the cent.

export type PlanStage = {
  id: string
  name: string
  position: number
  done_at: string | null
  tradesperson_id: string | null
}

export type PlanLine = {
  id: string
  stage_id: string
  product_id: string | null
  name: string
  quantity: number
  unit: string
  price_cents: number
  got_at: string | null
  position: number
}

export type Product = {
  id: string
  name: string
  unit: string
  price_cents: number
  supplier: string | null
  archived_at: string | null
}

export type Tradesperson = {
  id: string
  name: string
  trade: string | null
  phone: string | null
  archived_at: string | null
}

/** A line's total in cents: quantity × price each, rounded half up to the cent. */
export function lineTotal(line: Pick<PlanLine, 'quantity' | 'price_cents'>): number {
  return Math.round(line.quantity * line.price_cents)
}

export type StageTotals = { items: number; got: number; cents: number }

export function totalsOf(
  lines: Pick<PlanLine, 'quantity' | 'price_cents' | 'got_at'>[],
): StageTotals {
  return lines.reduce(
    (t, l) => ({
      items: t.items + 1,
      got: t.got + (l.got_at ? 1 : 0),
      cents: t.cents + lineTotal(l),
    }),
    { items: 0, got: 0, cents: 0 },
  )
}

/** The stages in order, each with its lines in the order they were added. */
export function planByStage(stages: PlanStage[], lines: PlanLine[]) {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((stage) => {
      const own = lines
        .filter((l) => l.stage_id === stage.id)
        .sort((a, b) => a.position - b.position)
      return { stage, lines: own, totals: totalsOf(own) }
    })
}

const euro = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})
const euroCents = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "€3,420" for whole euro, "€24.50" otherwise. */
export function formatCents(cents: number): string {
  return cents % 100 === 0 ? euro.format(cents / 100) : euroCents.format(cents / 100)
}

/** "5 stages · 12 items · €3,420", or "Not started". */
export function planSummary(
  stages: number,
  lines: Pick<PlanLine, 'quantity' | 'price_cents' | 'got_at'>[],
) {
  if (stages === 0) return 'Not started'
  const t = totalsOf(lines)
  return [
    `${stages} ${stages === 1 ? 'stage' : 'stages'}`,
    `${t.items} ${t.items === 1 ? 'item' : 'items'}`,
    formatCents(t.cents),
  ].join(' · ')
}

/** Euro as people type it ("24.50", "€1,200", "1200") in cents; null when it is not a price. */
export function parseEuroToCents(text: string): number | null {
  const t = text.replace(/[€\s,]/g, '')
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null
  const [whole = '0', frac = ''] = t.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

/** A quantity: positive, at most three decimals and 100,000. */
export function parseQuantity(text: string): number | null {
  const t = text.replace(/[\s,]/g, '')
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= 100000 ? n : null
}

/** "12.5", "1" (no trailing zeros) for an input's starting value. */
export const quantityText = (n: number) => String(Number(n.toFixed(3)))
/** "24.50", "1200" for an input's starting value. */
export const priceText = (cents: number) =>
  cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)

/**
 * The products to offer for what he has typed, best first: names starting with it, then a word
 * starting with it, then containing it; archived ones never. At most `limit`.
 */
export function searchProducts(products: Product[], query: string, limit = 5): Product[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return []
  const rank = (name: string) => {
    const n = name.toLowerCase()
    if (n.startsWith(q)) return 0
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1
    if (n.includes(q)) return 2
    return 3
  }
  return products
    .filter((p) => !p.archived_at)
    .map((p) => ({ p, r: rank(p.name) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p)
}

/** Whether the typed name is already a product (any case): then there is no "Add as new". */
export function exactProduct(products: Product[], query: string): Product | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  return products.find((p) => p.name.toLowerCase() === q) ?? null
}
