import {
  formatEuro,
  matchesOutcomeFilter,
  outcomeInputSchema,
  parseEuro,
  reasonLabel,
  stageLabel,
} from './outcome'

const now = new Date('2026-11-26T12:00:00Z')

describe('outcome input', () => {
  it('reads euro amounts as people type them', () => {
    expect(parseEuro('18450')).toBe(18450)
    expect(parseEuro('18,450.50')).toBe(18450.5)
    expect(parseEuro('€18 450')).toBe(18450)
    expect(parseEuro('1,200,000')).toBe(1200000)
    expect(parseEuro('0')).toBeNull()
    expect(parseEuro('-5')).toBeNull()
    expect(parseEuro('12.345')).toBeNull()
    expect(parseEuro('abc')).toBeNull()
    expect(parseEuro('')).toBeNull()
    expect(formatEuro(18450.5)).toBe('€18,450.50')
  })

  it('validates a quote and a win: amount, date not in the future', () => {
    const schema = outcomeInputSchema(now)
    expect(schema.parse({ stage: 'quoted', amount: '18,450', on: '2026-11-20', note: '' })).toEqual(
      {
        stage: 'quoted',
        amount: 18450,
        on: '2026-11-20',
        note: '',
      },
    )
    const bad = schema.safeParse({ stage: 'won', amount: 'lots', on: '2026-12-25', note: '' })
    expect(bad.success).toBe(false)
    const messages = bad.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    expect(messages).toEqual([
      'amount: Enter the amount in euro, for example 18,450.',
      'on: The date cannot be in the future.',
    ])
  })

  it('needs a reason for a loss, and a note for "other"', () => {
    const schema = outcomeInputSchema(now)
    expect(schema.safeParse({ stage: 'lost', reason: 'price', note: '' }).success).toBe(true)
    expect(
      schema.safeParse({ stage: 'lost', reason: undefined, note: '' }).error?.issues[0]?.message,
    ).toBe('Choose a reason.')
    expect(
      schema.safeParse({ stage: 'lost', reason: 'other', note: ' ' }).error?.issues[0]?.message,
    ).toBe('Say why it was lost.')
  })

  it('labels stages and reasons, including ones this build does not know', () => {
    expect(stageLabel(null)).toBe('No outcome yet')
    expect(stageLabel('won')).toBe('Won')
    expect(stageLabel('on_hold')).toBe('on_hold')
    expect(reasonLabel('chose_another')).toBe('Went elsewhere')
    expect(reasonLabel('project_cancelled')).toBe('Project cancelled or postponed')
    expect(reasonLabel('budget_cut')).toBe('budget cut')
  })
})

describe('outcome filter', () => {
  const past = {
    starts_at: '2026-11-20T10:00:00Z',
    confirmed_at: '2026-11-18T10:00:00Z',
    state: 'confirmed',
  }
  const future = { ...past, starts_at: '2026-12-20T10:00:00Z' }
  const at = now.getTime()
  it('awaiting quote: no outcome and a confirmed appointment that has happened', () => {
    expect(matchesOutcomeFilter({ outcome: null, bookings: [past] }, 'awaiting_quote', at)).toBe(
      true,
    )
    expect(matchesOutcomeFilter({ outcome: null, bookings: [future] }, 'awaiting_quote', at)).toBe(
      false,
    )
    expect(matchesOutcomeFilter({ outcome: null, bookings: [] }, 'awaiting_quote', at)).toBe(false)
    expect(
      matchesOutcomeFilter(
        { outcome: null, bookings: [{ ...past, state: 'cancelled' }] },
        'awaiting_quote',
        at,
      ),
    ).toBe(false)
    expect(
      matchesOutcomeFilter({ outcome: 'quoted', bookings: [past] }, 'awaiting_quote', at),
    ).toBe(false)
  })
  it('stage filters match the stage; all matches everything', () => {
    expect(matchesOutcomeFilter({ outcome: 'won', bookings: [] }, 'won', at)).toBe(true)
    expect(matchesOutcomeFilter({ outcome: 'won', bookings: [] }, 'lost', at)).toBe(false)
    expect(matchesOutcomeFilter({ outcome: 'paused', bookings: [] }, 'all', at)).toBe(true)
  })
})
