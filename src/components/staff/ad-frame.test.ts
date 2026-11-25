import { describe, expect, it } from 'vitest'
import { AD_FRAME_CSP, withFrameCsp, withPauseRule } from './ad-frame'

describe('ad frame document', () => {
  it('puts the policy first in head', () => {
    const out = withFrameCsp('<html><head><style>x{}</style></head><body></body></html>')
    expect(out.indexOf(AD_FRAME_CSP)).toBeLessThan(out.indexOf('<style>'))
  })

  it('adds a pause rule that applies only one pixel wider than the ad, after its own styles', () => {
    const out = withPauseRule('<html><head><style>a{}</style></head><body></body></html>', 1440)
    expect(out).toMatch(
      /<style>a\{\}<\/style><style>@media \(min-width: 1441px\) \{ \*, \*::before, \*::after \{ animation-play-state: paused !important; \} \}<\/style><\/head>/,
    )
    expect(withPauseRule('<main class="ad"></main>', 1440)).toContain('min-width: 1441px')
  })
})
