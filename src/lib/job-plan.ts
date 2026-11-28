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
  /** null = Dad's own product; else the supplier catalogue it came from ("goodwins"). */
  source?: string | null
  supplier_sku?: string | null
  source_url?: string | null
  category?: string | null
  /** The supplier's VAT-inclusive price at the last import. */
  supplier_price_cents?: number | null
  /** Staff changed a catalogue product's price; imports keep it. */
  price_edited_at?: string | null
  /** Lines on jobs that use it. */
  uses?: number
}

/** Supplier catalogues this build knows by name; an unknown source shows its supplier or slug. */
export const SOURCE_NAMES: Record<string, string> = { goodwins: 'Goodwins' }
export const sourceName = (p: Pick<Product, 'source' | 'supplier'>) =>
  p.source ? (SOURCE_NAMES[p.source] ?? p.supplier ?? p.source) : null

/**
 * A product's price as the lists show it: "€12 / bag" for his own; "€12.80 inc VAT · Goodwins"
 * from a catalogue; "€11 / each, your price · Goodwins €13.50 inc VAT" once he changed it.
 */
export function productPriceLine(p: Product): string {
  const own = `${formatCents(p.price_cents)} / ${p.unit}`
  const from = sourceName(p)
  if (!from) return p.supplier ? `${own} · ${p.supplier}` : own
  if (
    p.price_edited_at &&
    p.supplier_price_cents != null &&
    p.supplier_price_cents !== p.price_cents
  )
    return `${own}, your price · ${from} ${formatCents(p.supplier_price_cents)} inc VAT`
  if (p.price_edited_at) return `${own}, your price · ${from}`
  return `${formatCents(p.price_cents)} inc VAT · ${from}`
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

/** Whether the typed name is already a product (any case): then there is no "Add as new". */
export function exactProduct(products: Product[], query: string): Product | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  return products.find((p) => p.name.toLowerCase() === q) ?? null
}

/** What is still to get: the items not ticked and what they cost. */
export function toGet(lines: Pick<PlanLine, 'quantity' | 'price_cents' | 'got_at'>[]) {
  const left = lines.filter((l) => !l.got_at)
  return { items: left.length, cents: left.reduce((c, l) => c + lineTotal(l), 0) }
}

/** "To get: 3 items · €179", "Everything got", or "Nothing to get yet". */
export function toGetLine(lines: Pick<PlanLine, 'quantity' | 'price_cents' | 'got_at'>[]) {
  if (lines.length === 0) return 'Nothing to get yet'
  const t = toGet(lines)
  if (t.items === 0) return 'Everything got'
  return `To get: ${t.items} ${t.items === 1 ? 'item' : 'items'} · ${formatCents(t.cents)}`
}

/** "Next: First fix plumbing · Pat Example (Plumber)", or "Every stage done". */
export function nextStageLine(stages: PlanStage[], people: Tradesperson[]) {
  const next = [...stages].sort((a, b) => a.position - b.position).find((s) => !s.done_at)
  if (!next) return 'Every stage done'
  const who = people.find((p) => p.id === next.tradesperson_id)
  const name = who ? ` · ${who.name}${who.trade ? ` (${who.trade})` : ''}` : ''
  return `Next: ${next.name}${name}`
}

/** The units offered as chips (so "m2" and "sqm" do not split); anything else is typed. */
export const UNITS = ['each', 'm2', 'm', 'bag', 'box', 'length', 'tin'] as const
