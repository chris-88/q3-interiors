import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './errors'

// The hooks module imports the client; keep the real one (and its env check) out of the test.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const { adErrorMessage, latestVersion } = await import('./ads')

describe('ad review messages', () => {
  it.each([
    ['not allowed', 'Only an admin can do that.'],
    ['open requests', 'There are open change requests on this version.'],
    ['not the current version', 'A newer version has been published. Reload the page.'],
    ['ad archived', 'This ad is archived.'],
    ['request length', 'Write between 3 and 1,000 characters.'],
    ['request not open', 'That request is no longer open.'],
    ['something else', 'That did not work. Please try again.'],
  ])('turns "%s" into plain words', (message, words) => {
    expect(adErrorMessage(new ApiError(message, '22023'))).toBe(words)
  })

  it('picks the newest version as current', () => {
    const v = (version: number) => ({
      id: `v${version}`,
      version,
      caption: 'c',
      headline: null,
      button_label: null,
      notes: null,
      created_at: '2026-11-25T10:00:00Z',
      approved_at: null,
      approved_by_name: null,
      link_url: null,
      ad_variants: [],
    })
    const ad = {
      id: 'a',
      name: 'n',
      status: 'new' as const,
      created_at: '',
      created_by_name: null,
      set_name: null,
      set_position: null,
      campaign_creatives: null,
      ad_versions: [v(1), v(3), v(2)],
      ad_requests: [],
      ad_events: [],
    }
    expect(latestVersion(ad)?.version).toBe(3)
  })
})
