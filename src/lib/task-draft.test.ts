import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  draftHasContent,
  estimateDraftSchema,
  hasDraft,
  readDraft,
  writeDraft,
} from './task-draft'

const values = { price: '9500', percent: '10', work: '', ticked: ['Strip out'] }

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('task drafts (kept on this device until sent)', () => {
  it('reads back what was written, per enquiry and kind', () => {
    writeDraft('estimate', 'e1', null, values)
    expect(readDraft('estimate', 'e1', null, estimateDraftSchema)).toEqual(values)
    expect(readDraft('estimate', 'e2', null, estimateDraftSchema)).toBeNull()
    expect(hasDraft('quote', 'e1', null)).toBe(false)
    expect(hasDraft('estimate', 'e1', null)).toBe(true)
  })

  it('a draft started before another estimate went out is not offered', () => {
    writeDraft('estimate', 'e1', null, values)
    expect(readDraft('estimate', 'e1', 'est-2', estimateDraftSchema)).toBeNull()
  })

  it('cleared once sent; a stored value of the wrong shape is ignored', () => {
    writeDraft('estimate', 'e1', null, values)
    clearDraft('estimate', 'e1')
    expect(hasDraft('estimate', 'e1', null)).toBe(false)
    writeDraft('estimate', 'e1', null, { price: 3 })
    expect(readDraft('estimate', 'e1', null, estimateDraftSchema)).toBeNull()
    window.localStorage.setItem('q3.staff.draft.estimate.e1', 'not json')
    expect(readDraft('estimate', 'e1', null, estimateDraftSchema)).toBeNull()
  })

  it('storage that throws never breaks the form', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeDraft('estimate', 'e1', null, values)).not.toThrow()
    expect(readDraft('estimate', 'e1', null, estimateDraftSchema)).toBeNull()
  })

  it('only a change from the starting values counts as a draft', () => {
    const start = { price: '', percent: '10', work: '', ticked: [] }
    expect(draftHasContent(start, start)).toBe(false)
    expect(draftHasContent(values, start)).toBe(true)
  })
})
