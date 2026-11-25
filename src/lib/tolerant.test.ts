import { z } from 'zod'
import { eventLine } from '@/components/staff/event-text'
import { DataShapeError, isKnown, openEnum, parseOne, parseRows, skippedSnapshot } from './tolerant'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const row = z.object({ id: z.string(), state: openEnum(['a', 'b']), n: z.number() })

describe('reading data a newer release wrote', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined))
  afterEach(() => vi.restoreAllMocks())

  it('accepts values it does not know and ignores extra fields', () => {
    expect(row.parse({ id: 'x', state: 'c', n: 1, added_later: true })).toEqual({
      id: 'x',
      state: 'c',
      n: 1,
    })
    expect(isKnown(['a', 'b'] as const, 'c')).toBe(false)
    expect(isKnown(['a', 'b'] as const, 'a')).toBe(true)
  })

  it('leaves out a row it cannot read, keeps the rest, and logs paths only', () => {
    const rows = parseRows(
      row,
      [
        { id: 'one', state: 'a', n: 1 },
        { id: 'two', state: 'b', n: 'Ann Smith 087 123 4567' },
        { id: 'three', state: 'new-thing', n: 3 },
      ],
      'things',
    )
    expect(rows.map((r) => r.id)).toEqual(['one', 'three'])
    expect(skippedSnapshot()).toContainEqual(['things', 1])
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls)
    expect(logged).toContain('"n"')
    expect(logged).not.toContain('Ann Smith')
    // A clean read clears the notice for that list.
    parseRows(row, [{ id: 'one', state: 'a', n: 1 }], 'things')
    expect(skippedSnapshot().find(([w]) => w === 'things')).toBeUndefined()
  })

  it('throws a DataShapeError naming the place and the fields, never the values', () => {
    try {
      parseOne(row, { id: 'x', state: 'a', n: 'secret value' }, 'this thing')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DataShapeError)
      expect((error as DataShapeError).where).toBe('this thing')
      expect((error as DataShapeError).paths).toEqual(['n'])
      expect(String((error as Error).message)).not.toContain('secret')
    }
    expect(() => parseRows(row, { not: 'a list' }, 'things')).toThrow(DataShapeError)
  })

  it('shows a history entry of a kind it does not know as a plain line', () => {
    const line = eventLine({
      id: 1,
      kind: 'something_new',
      detail: 'Details from the future',
      from_status: null,
      to_status: null,
      reason: null,
      actor_name: null,
      created_at: '2026-11-27T10:00:00Z',
    })
    expect(line).toEqual({ title: 'Update recorded', detail: 'Details from the future' })
    expect(
      eventLine({
        id: 2,
        kind: 'status_changed',
        detail: null,
        from_status: 'new',
        to_status: 'paused',
        reason: null,
        actor_name: null,
        created_at: '2026-11-27T10:00:00Z',
      }).title,
    ).toBe('Status changed from New to paused')
  })
})
