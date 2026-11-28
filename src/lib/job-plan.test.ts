import { describe, expect, it } from 'vitest'
import {
  exactProduct,
  formatCents,
  lineTotal,
  parseEuroToCents,
  parseQuantity,
  planByStage,
  planSummary,
  priceText,
  quantityText,
  searchProducts,
  totalsOf,
  type PlanLine,
  type Product,
} from './job-plan'

const line = (over: Partial<PlanLine>): PlanLine => ({
  id: 'l',
  stage_id: 's1',
  product_id: 'p',
  name: 'Wall tile',
  quantity: 1,
  unit: 'm2',
  price_cents: 2450,
  got_at: null,
  position: 1,
  ...over,
})
const product = (name: string, over: Partial<Product> = {}): Product => ({
  id: name,
  name,
  unit: 'each',
  price_cents: 100,
  supplier: null,
  archived_at: null,
  ...over,
})

describe('job plan totals', () => {
  it('a line is quantity × price each, to the cent', () => {
    expect(lineTotal({ quantity: 12.5, price_cents: 2450 })).toBe(30625)
    expect(lineTotal({ quantity: 0.333, price_cents: 1000 })).toBe(333)
    expect(lineTotal({ quantity: 3, price_cents: 0 })).toBe(0)
  })

  it('totals count items, the ones got, and the money', () => {
    expect(
      totalsOf([line({ quantity: 2 }), line({ quantity: 1, got_at: '2026-11-28T10:00:00Z' })]),
    ).toEqual({ items: 2, got: 1, cents: 7350 })
    expect(totalsOf([])).toEqual({ items: 0, got: 0, cents: 0 })
  })

  it('groups lines under their stages, in order, with each stage’s totals', () => {
    const stages = [
      { id: 's2', name: 'Tiling', position: 2, done_at: null, tradesperson_id: null },
      { id: 's1', name: 'Strip out', position: 1, done_at: null, tradesperson_id: null },
    ]
    const plan = planByStage(stages, [
      line({ id: 'b', stage_id: 's2', position: 2 }),
      line({ id: 'a', stage_id: 's2', position: 1, quantity: 2 }),
    ])
    expect(plan.map((p) => p.stage.name)).toEqual(['Strip out', 'Tiling'])
    expect(plan[1]?.lines.map((l) => l.id)).toEqual(['a', 'b'])
    expect(plan[1]?.totals.cents).toBe(7350)
    expect(plan[0]?.totals.items).toBe(0)
  })

  it('the summary line', () => {
    expect(planSummary(0, [])).toBe('Not started')
    expect(planSummary(5, [line({ quantity: 100, price_cents: 3420 })])).toBe(
      '5 stages · 1 item · €3,420',
    )
    expect(planSummary(1, [line({}), line({})])).toBe('1 stage · 2 items · €49')
  })

  it('euro, whole or with cents', () => {
    expect(formatCents(342000)).toBe('€3,420')
    expect(formatCents(2450)).toBe('€24.50')
    expect(formatCents(0)).toBe('€0')
  })
})

describe('typed money and quantities', () => {
  it('reads euro as people type it', () => {
    expect(parseEuroToCents('24.50')).toBe(2450)
    expect(parseEuroToCents('€1,200')).toBe(120000)
    expect(parseEuroToCents('3.5')).toBe(350)
    expect(parseEuroToCents('0')).toBe(0)
    expect(parseEuroToCents('')).toBeNull()
    expect(parseEuroToCents('12.345')).toBeNull()
    expect(parseEuroToCents('-3')).toBeNull()
    expect(parseEuroToCents('ten')).toBeNull()
  })

  it('reads quantities', () => {
    expect(parseQuantity('12.5')).toBe(12.5)
    expect(parseQuantity('1')).toBe(1)
    expect(parseQuantity('0')).toBeNull()
    expect(parseQuantity('100001')).toBeNull()
    expect(parseQuantity('1.2345')).toBeNull()
  })

  it('starting values for the inputs', () => {
    expect(quantityText(12.5)).toBe('12.5')
    expect(quantityText(2)).toBe('2')
    expect(priceText(2450)).toBe('24.50')
    expect(priceText(120000)).toBe('1200')
  })
})

describe('searching the product list', () => {
  const list = [
    product('Wall tile white'),
    product('Floor tile grey'),
    product('Tile adhesive'),
    product('Grout'),
    product('Old tile', { archived_at: '2026-11-01T00:00:00Z' }),
  ]

  it('starts-with first, then a word, then anywhere; never archived', () => {
    expect(searchProducts(list, 'tile').map((p) => p.name)).toEqual([
      'Tile adhesive',
      'Floor tile grey',
      'Wall tile white',
    ])
    expect(searchProducts(list, 'out').map((p) => p.name)).toEqual(['Grout'])
    expect(searchProducts(list, '  ')).toEqual([])
    expect(searchProducts(list, 't', 2)).toHaveLength(2)
  })

  it('an exact name in any case is the product itself', () => {
    expect(exactProduct(list, ' grout ')?.name).toBe('Grout')
    expect(exactProduct(list, 'grou')).toBeNull()
  })
})
