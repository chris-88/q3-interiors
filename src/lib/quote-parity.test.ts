import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/20261129160000_quotes.sql?raw'
import wordmarkFile from '../../public/brand/q3-full-black.svg?raw'
import { WORDING } from '../../supabase/functions/_shared/messages'
import { WORDMARK_SVG } from '../../supabase/functions/_shared/wordmark'
import { enquiryStage, matchesStage, nextStep, stageLine, type StageQuote } from './enquiry-stage'

describe('quotes in the database and the document', () => {
  it('use the same default terms', () => {
    expect(migration).toContain(`select '${WORDING.quote_terms.default}'::text`)
  })

  it('draw the same wordmark as the brand file', () => {
    const paths = (svg: string) => svg.match(/<path[^>]*>/g)
    expect(paths(WORDMARK_SVG)).toEqual(paths(wordmarkFile))
  })
})

describe('quotes in the stage', () => {
  const now = Date.parse('2026-11-30T12:00:00Z')
  const quote = (over: Partial<StageQuote> = {}): StageQuote => ({
    number: 'Q3-Q-0001',
    version: 1,
    price_eur: 10200,
    sent_at: '2026-11-28T10:00:00Z',
    change_requested_at: null,
    ...over,
  })
  const base = {
    status: 'contacted',
    outcome: 'quoted',
    contact_requested_at: null,
    bookings: [],
    answers: {},
    quote_amount: 10200,
  }

  it('shows the quote sent', () => {
    const e = { ...base, quotes: [quote()] }
    const stage = enquiryStage(e, now)
    expect(stage.key).toBe('quoted')
    expect(stageLine(e, stage, now)).toBe('Quote Q3-Q-0001 sent 28 Nov: €10,200')
  })

  it('a change asked for needs action until an updated version goes', () => {
    const e = { ...base, quotes: [quote({ change_requested_at: '2026-11-29T09:00:00Z' })] }
    const stage = enquiryStage(e, now)
    expect(stage).toEqual({ key: 'change_requested', label: 'Change asked for' })
    expect(stageLine(e, stage, now)).toBe('Change asked for 29 Nov on Q3-Q-0001')
    expect(matchesStage(stage.key, 'action')).toBe(true)
    expect(nextStep(stage.key)).toBe('quote_change')
    const updated = {
      ...e,
      quotes: [
        ...e.quotes,
        quote({ version: 2, sent_at: '2026-11-30T09:00:00Z', price_eur: 11000 }),
      ],
    }
    expect(stageLine(updated, enquiryStage(updated, now), now)).toBe(
      'Quote Q3-Q-0001 (v2) sent 30 Nov: €11,000',
    )
  })

  it('a quote recorded by hand still reads as before', () => {
    const e = { ...base, quotes: [] }
    expect(stageLine(e, enquiryStage(e, now), now)).toBe('Quoted €10,200')
  })
})
