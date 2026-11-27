import { describe, expect, it, vi } from 'vitest'
import type { WorkItem } from '@/api/estimates'

// The api module creates the Supabase client on import; the deploy job has no Supabase env.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const { offeredItems, tidyWorkItem } = await import('@/api/estimates')
const { orderTicked } = await import('@/components/staff/work-items-picker')

const item = (label: string, type: string | null, id = label): WorkItem => ({
  id,
  label,
  project_type: type,
  kind: 'included',
})
const list = [
  item('Strip out the old kitchen', 'kitchen'),
  item('Painting', 'kitchen', 'k-paint'),
  item('Wall tiling', 'bathroom'),
  item('Strip out', null),
  item('painting', null, 'any-paint'),
  item('Waste removal', null),
]

describe('work items offered', () => {
  it('puts the job type first, then any-job items without repeats', () => {
    expect(offeredItems(list, 'kitchen').map((i) => i.id)).toEqual([
      'Strip out the old kitchen',
      'k-paint',
      'Strip out',
      'Waste removal',
    ])
  })

  it('offers only any-job items without a type, or for a type with none of its own', () => {
    expect(offeredItems(list, null).map((i) => i.label)).toEqual([
      'Strip out',
      'painting',
      'Waste removal',
    ])
    expect(offeredItems(list, 'whole_home')).toEqual(offeredItems(list, null))
  })

  it('keeps the ticked ones in the order shown, extras last', () => {
    const offered = offeredItems(list, 'kitchen')
    expect(
      orderTicked(offered, ['Waste removal', 'Move the radiator', 'strip out the old kitchen']),
    ).toEqual(['Strip out the old kitchen', 'Waste removal', 'Move the radiator'])
  })

  it('tidies a typed label the way the server stores it', () => {
    expect(tidyWorkItem('  Move the   radiator ')).toBe('Move the radiator')
    expect(tidyWorkItem('x')).toBeNull()
    expect(tidyWorkItem('x'.repeat(61))).toBeNull()
  })
})
