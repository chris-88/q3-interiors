import { describe, expect, it } from 'vitest'
import { staffHostUrl, unprefixedStaffPath } from './staff-redirect'

describe('staff host redirects', () => {
  it('send old customer-site staff URLs to the same place on the staff site', () => {
    expect(staffHostUrl('/staff', '')).toBe('https://staff.q3interiors.ie/#/')
    expect(staffHostUrl('/staff/', '')).toBe('https://staff.q3interiors.ie/#/')
    expect(staffHostUrl('/staff/settings/people', '')).toBe(
      'https://staff.q3interiors.ie/#/settings/people',
    )
    expect(staffHostUrl('/staff/set-password', '?token_hash=x&type=recovery&welcome=1')).toBe(
      'https://staff.q3interiors.ie/#/set-password?token_hash=x&type=recovery&welcome=1',
    )
    expect(staffHostUrl('/staff/enquiries/abc', '')).toBe(
      'https://staff.q3interiors.ie/#/enquiries/abc',
    )
  })

  it('strip the old prefix on the staff site, keeping the query', () => {
    expect(unprefixedStaffPath('/staff', '')).toBe('/')
    expect(unprefixedStaffPath('/staff/forgot', '')).toBe('/forgot')
    expect(unprefixedStaffPath('/staff/set-password', '?token_hash=y')).toBe(
      '/set-password?token_hash=y',
    )
    expect(unprefixedStaffPath('/staffing', '')).toBe('/staffing')
  })
})
