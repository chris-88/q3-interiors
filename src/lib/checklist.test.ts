import { describe, expect, it } from 'vitest'
import { checklistItems, type ChecklistData } from './checklist'

const today: ChecklistData = {
  business_missing: ['legal name', 'postal address', 'privacy contact'],
  bookable_name: 'Chris',
  calendar_connected: true,
  calendar_healthy: true,
  calendar_email: 'test@example.com',
  test_calendar_email: null,
  retention_months: null,
  privacy_reviewed: false,
  privacy_reviewable: false,
  form_version: 1,
  last_booking_at: null,
  campaign_links: 0,
  ticks: {},
}
const item = (d: ChecklistData, id: string) => checklistItems(d).find((i) => i.id === id)

describe('go-live checklist', () => {
  it('lists what is missing today, in plain words', () => {
    const items = checklistItems(today)
    expect(items.filter((i) => i.done).map((i) => i.id)).toEqual(['bookable'])
    expect(item(today, 'business')?.detail).toBe(
      'Still to fill in: legal name, postal address and privacy contact.',
    )
    expect(item(today, 'test_account')?.action).toBe('mark_test_calendar')
    expect(item(today, 'form')?.detail).toMatch(/still version 1/)
    expect(item(today, 'privacy')?.detail).toMatch(/Fill in the legal name/)
  })

  it('stays amber while bookings use the test account, green once another account takes over', () => {
    const flagged = { ...today, test_calendar_email: 'test@example.com' }
    expect(item(flagged, 'test_account')).toMatchObject({ done: false, action: undefined })
    expect(item({ ...flagged, calendar_email: 'dad@q3interiors.ie' }, 'test_account')?.done).toBe(
      true,
    )
  })

  it('explains a bookable person without a calendar', () => {
    const d = { ...today, calendar_connected: false, calendar_healthy: false, bookable_name: 'Dad' }
    expect(item(d, 'bookable')).toMatchObject({ done: false })
    expect(item(d, 'bookable')?.detail).toMatch(/Dad takes bookings but has not connected/)
    expect(item(d, 'test_account')?.done).toBe(false)
  })

  it('turns everything green when it is all done', () => {
    const tick = { at: '2026-12-01T10:00:00Z', by: 'Chris' }
    const done: ChecklistData = {
      ...today,
      business_missing: [],
      calendar_email: 'dad@q3interiors.ie',
      test_calendar_email: 'test@example.com',
      retention_months: 24,
      privacy_reviewed: true,
      privacy_reviewable: true,
      form_version: 2,
      last_booking_at: '2026-12-01T09:00:00Z',
      campaign_links: 1,
      ticks: {
        types_hours_reviewed: tick,
        google_app_production: tick,
        bookings_forwarder: tick,
        phone_check: tick,
      },
    }
    expect(checklistItems(done).every((i) => i.done)).toBe(true)
    expect(item(done, 'phone')?.detail).toBe('Ticked by Chris on 2026-12-01.')
  })
})
