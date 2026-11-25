import { isBusy, isNewer, latestBuild, ownBuild } from './staff-version'

describe('staff build version', () => {
  it('knows its own build from the StaffApp chunk name, and nothing in dev', () => {
    expect(ownBuild('https://staff.q3interiors.ie/assets/StaffApp-CcGEM2YL.js')).toBe(
      'StaffApp-CcGEM2YL.js',
    )
    expect(ownBuild('http://localhost:5173/src/staff-version.ts')).toBeNull()
  })

  it('is newer only when the published build differs from a known own build', () => {
    expect(isNewer('StaffApp-a.js', 'StaffApp-b.js')).toBe(true)
    expect(isNewer('StaffApp-a.js', 'StaffApp-a.js')).toBe(false)
    expect(isNewer(null, 'StaffApp-b.js')).toBe(false)
    expect(isNewer('StaffApp-a.js', null)).toBe(false)
  })

  it('reads version.json without the cache and survives failures', async () => {
    const calls: RequestInit[] = []
    const ok = (async (_url: string, init: RequestInit) => {
      calls.push(init)
      return new Response(JSON.stringify({ app: 'StaffApp-b.js', shell: 'x' }))
    }) as unknown as typeof fetch
    expect(await latestBuild(ok)).toBe('StaffApp-b.js')
    expect(calls[0]?.cache).toBe('no-store')
    const down = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await latestBuild(down)).toBeNull()
    const junk = (async () => new Response('<html>')) as unknown as typeof fetch
    expect(await latestBuild(junk)).toBeNull()
  })

  it('counts typing, a focused text field or a save in flight as busy', () => {
    const input = document.createElement('input')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const area = document.createElement('textarea')
    const none = { typedSinceSave: false, saving: false }
    expect(isBusy({ activeElement: input, ...none })).toBe(true)
    expect(isBusy({ activeElement: area, ...none })).toBe(true)
    expect(isBusy({ activeElement: checkbox, ...none })).toBe(false)
    expect(isBusy({ activeElement: document.body, ...none })).toBe(false)
    expect(isBusy({ activeElement: null, typedSinceSave: true, saving: false })).toBe(true)
    expect(isBusy({ activeElement: null, typedSinceSave: false, saving: true })).toBe(true)
  })
})
