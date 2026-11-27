import { describe, expect, it, vi } from 'vitest'
import type { StageView } from '@/lib/enquiry-stage'

// The action panels import api modules, which create the Supabase client on import.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const { ACTIONS, barAction } = await import('./enquiry-now')

const view = (over: Partial<StageView>): StageView =>
  ({
    key: 'new',
    label: 'New',
    step: 'call',
    whose: 'q3',
    group: 'your_move',
    due: null,
    urgency: 'neutral',
    chip: null,
    news: '',
    primary: 'ring',
    others: [],
    next: null,
    ...over,
  }) as StageView

describe('the enquiry page actions', () => {
  it('every action does something: a link (phone, email or a task screen) or a panel', () => {
    for (const [key, def] of Object.entries(ACTIONS)) {
      const ways = [def.href, def.panel].filter(Boolean)
      expect(ways, key).toHaveLength(1)
      expect(def.title('Mary').length, key).toBeGreaterThan(0)
      expect(def.line.length, key).toBeGreaterThan(0)
    }
  })

  it('the bar shows the stage’s primary; a diary stage its first other action; a result none', () => {
    expect(barAction(view({ primary: 'write_estimate' }))).toBe('write_estimate')
    expect(barAction(view({ primary: null, whose: 'diary', others: ['move', 'cancel'] }))).toBe(
      'move',
    )
    expect(barAction(view({ primary: null, whose: 'none', others: ['edit_result'] }))).toBeNull()
  })
})
