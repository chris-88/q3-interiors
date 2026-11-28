import { describe, expect, it } from 'vitest'
import { addCounts, batches, euroToCents, parseCatalogue, parseLine } from './product-import'

const line = (o: Record<string, unknown>) => JSON.stringify(o)
const good = {
  url: 'https://www.example.invalid/products/white-cement.html',
  categories: ['Building', 'Cement'],
  name: "O'Brien Premium White Cement 25kg Bag",
  sku: '0011011',
  price_inc: '12.80',
  availability: 'InStock',
  price_ex: '10.41',
}

describe('reading the catalogue file', () => {
  it('a good line: VAT-included price in cents, the breadcrumb joined, price_ex ignored', () => {
    expect(parseLine(line(good))).toEqual({
      sku: '0011011',
      name: "O'Brien Premium White Cement 25kg Bag",
      price_cents: 1280,
      url: good.url,
      category: 'Building > Cement',
    })
  })

  it('skips bad lines with a reason', () => {
    expect(parseLine('{not json')).toBe('not JSON')
    expect(parseLine('[1,2]')).toBe('not JSON')
    expect(parseLine(line({ url: good.url, error: 'HTTP 404' }))).toBe('fetch error')
    expect(parseLine(line({ ...good, name: undefined }))).toBe('no name')
    expect(parseLine(line({ ...good, sku: '' }))).toBe('no SKU')
    expect(parseLine(line({ ...good, price_inc: undefined }))).toBe('no price')
    expect(parseLine(line({ ...good, price_inc: 'POA' }))).toBe('bad price')
    expect(parseLine(line({ ...good, price_inc: '0.00' }))).toBe('bad price')
    expect(parseLine(line({ ...good, name: 'x'.repeat(201) }))).toBe('name too long')
    expect(parseLine('   ')).toBeNull()
  })

  it('treats text as data: tidied, control characters gone, only https links kept', () => {
    const row = parseLine(
      line({
        ...good,
        name: "  Robert'); drop table products;--\u0000\n  Cement ",
        url: 'javascript:alert(1)',
        categories: ['  Building ', '', 'Cement'],
      }),
    )
    expect(row).toMatchObject({
      name: "Robert'); drop table products;-- Cement",
      url: null,
      category: 'Building > Cement',
    })
  })

  it('euro as written', () => {
    expect(euroToCents('12.8')).toBe(1280)
    expect(euroToCents('€1,234.50')).toBe(123450)
    expect(euroToCents(9)).toBe(900)
    expect(euroToCents('12.345')).toBeNull()
    expect(euroToCents('-3')).toBeNull()
  })

  it('the file: counts, skips by reason, one row per SKU (the later line kept)', () => {
    const text = [
      line(good),
      line({ ...good, price_inc: '13.10' }),
      line({ url: good.url, error: 'timeout' }),
      '',
      line({ ...good, sku: '0011016', name: 'Hydrated Lime 25Kg', price_inc: '13.75' }),
      'garbage',
    ].join('\n')
    const parsed = parseCatalogue(text)
    expect(parsed.lines).toBe(5)
    expect(parsed.rows.map((r) => [r.sku, r.price_cents])).toEqual([
      ['0011011', 1310],
      ['0011016', 1375],
    ])
    expect(parsed.skipped).toEqual({
      'fetch error': 1,
      'not JSON': 1,
      'duplicate SKU (later line kept)': 1,
    })
  })

  it('a re-run of the same file gives the same rows', () => {
    const text = [line(good), line({ ...good, sku: '2' })].join('\n')
    expect(parseCatalogue(text)).toEqual(parseCatalogue(text))
  })

  it('batches and adds up the counts', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(
      addCounts(
        { added: 1, updated: 0, unchanged: 2, kept_your_price: 0, invalid: 0 },
        { added: 2, invalid: 1 },
      ),
    ).toEqual({ added: 3, updated: 0, unchanged: 2, kept_your_price: 0, invalid: 1 })
  })
})
