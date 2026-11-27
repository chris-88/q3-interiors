import { describe, expect, it } from 'vitest'
import {
  directionsHref,
  enquiryStage,
  mailHref,
  matchesSearch,
  matchesStage,
  nextStep,
  siteAddress,
  stageLine,
  telHref,
  type StageBooking,
} from './enquiry-stage'

const now = Date.parse('2026-11-26T12:00:00Z')
const past: StageBooking = {
  starts_at: '2026-11-20T10:00:00Z',
  confirmed_at: '2026-11-18T10:00:00Z',
  state: 'confirmed',
  mode: 'on_site',
  attendance: 'attended',
}
const future: StageBooking = {
  starts_at: '2026-11-27T10:30:00Z',
  confirmed_at: '2026-11-25T10:00:00Z',
  state: 'confirmed',
  mode: 'on_site',
}

const enquiry = (over: Record<string, unknown> = {}) => ({
  id: 'e',
  reference: 'Q3-ABC123',
  status: 'new',
  outcome: null as string | null,
  contact_requested_at: null as string | null,
  bookings: [] as StageBooking[],
  answers: {
    name: 'Sample Customer',
    email: 'sample@example.com',
    phone: '087 765 4321',
    location: 'Dublin 8',
  } as Record<string, string>,
  quote_amount: null as number | null,
  outcome_value: null as number | null,
  outcome_reason: null as string | null,
  ...over,
})

const key = (over: Record<string, unknown>) => enquiryStage(enquiry(over), now).key

describe('enquiryStage', () => {
  it('outcomes first: won and lost beat everything, unsuitable closes', () => {
    expect(key({ outcome: 'won', status: 'unsuitable', bookings: [future] })).toBe('won')
    expect(key({ outcome: 'lost' })).toBe('lost')
    expect(key({ status: 'unsuitable', bookings: [future] })).toBe('closed')
    expect(key({ outcome: 'quoted', bookings: [future] })).toBe('quoted')
  })
  it('an upcoming live appointment is Booked, even when an earlier one has passed', () => {
    expect(key({ bookings: [future] })).toBe('booked')
    expect(key({ bookings: [past, future] })).toBe('booked')
    expect(key({ bookings: [{ ...future, state: 'calendar_pending', confirmed_at: null }] })).toBe(
      'booked',
    )
    expect(key({ bookings: [{ ...future, state: 'cancelled' }] })).toBe('new')
  })
  it('a confirmed appointment that has happened, with no outcome, is Estimate to write', () => {
    expect(key({ bookings: [past] })).toBe('awaiting_quote')
    // Nothing recorded about it yet: the next thing is to say how it went.
    expect(key({ bookings: [{ ...past, attendance: null }] })).toBe('to_record')
    expect(key({ bookings: [{ ...past, state: 'cancelled' }] })).toBe('new')
    expect(key({ bookings: [{ ...past, confirmed_at: null, state: 'failed' }] })).toBe('new')
  })
  it('a contact request needs a call back until someone marks it contacted', () => {
    const asked = { contact_requested_at: '2026-11-25T09:00:00Z' }
    expect(key({ ...asked })).toBe('contact')
    expect(key({ ...asked, status: 'in_review' })).toBe('contact')
    expect(key({ ...asked, status: 'contacted' })).toBe('contacted')
    expect(key({ ...asked, bookings: [future] })).toBe('booked')
  })
  it('falls back to the handling status, and shows values a newer release wrote as they are', () => {
    expect(key({})).toBe('new')
    expect(key({ status: 'in_review' })).toBe('in_review')
    expect(key({ status: 'contacted' })).toBe('contacted')
    expect(enquiryStage(enquiry({ status: 'awaiting_survey' }), now)).toEqual({
      key: 'other',
      label: 'awaiting_survey',
    })
    expect(enquiryStage(enquiry({ outcome: 'deferred' }), now)).toEqual({
      key: 'other',
      label: 'deferred',
    })
  })
})

describe('stageLine', () => {
  const line = (over: Record<string, unknown>) => {
    const e = enquiry(over)
    return stageLine(e, enquiryStage(e, now), now)
  }
  it('says what is next or where it stands', () => {
    expect(line({ bookings: [future] })).toBe('Site visit Fri 27 Nov, 10:30')
    expect(line({ bookings: [{ ...future, mode: 'phone' }] })).toBe('Call Fri 27 Nov, 10:30')
    expect(line({ bookings: [{ ...future, state: 'reserved' }] })).toBe(
      'Site visit Fri 27 Nov, 10:30 (not confirmed yet)',
    )
    expect(line({ contact_requested_at: '2026-11-25T09:00:00Z' })).toBe('Asked to be contacted')
    expect(line({ bookings: [past] })).toBe('Site visit Fri 20 Nov, no estimate yet')
    expect(line({ outcome: 'quoted', quote_amount: 18450 })).toBe('Quoted €18,450')
    expect(line({ outcome: 'quoted', quote_amount: 18450.5 })).toBe('Quoted €18,450.50')
    expect(line({ outcome: 'won', outcome_value: 18000 })).toBe('Won €18,000')
    expect(line({ outcome: 'won' })).toBe('Won')
    expect(line({ outcome: 'lost', outcome_reason: 'chose_another' })).toBe('Lost: Went elsewhere')
    expect(line({ status: 'unsuitable' })).toBe('Not suitable')
    expect(line({ answers: { appointment_preference: 'on_site' } })).toBe(
      'Wants a site visit, not booked yet',
    )
  })
})

describe('chips', () => {
  it('Open is everything not won, lost or closed; Needs action is new, call back, awaiting quote', () => {
    expect(matchesStage('booked', 'open')).toBe(true)
    expect(matchesStage('other', 'open')).toBe(true)
    expect(matchesStage('won', 'open')).toBe(false)
    expect(matchesStage('closed', 'open')).toBe(false)
    expect(matchesStage('closed', 'all')).toBe(true)
    for (const k of ['new', 'contact', 'awaiting_quote'] as const)
      expect(matchesStage(k, 'action')).toBe(true)
    for (const k of ['contacted', 'booked', 'quoted', 'in_review'] as const)
      expect(matchesStage(k, 'action')).toBe(false)
  })
})

describe('search', () => {
  const e = enquiry({
    answers: {
      name: 'Áine Murphy',
      email: 'aine@example.com',
      phone: '087 123 4567',
      location: 'Dublin 8',
    },
  })
  it('finds by name, email, town, reference and phone, ignoring case and spacing', () => {
    expect(matchesSearch(e, '')).toBe(true)
    expect(matchesSearch(e, 'murphy')).toBe(true)
    expect(matchesSearch(e, 'AINE@')).toBe(true)
    expect(matchesSearch(e, 'dublin  8')).toBe(true)
    expect(matchesSearch(e, 'q3-abc')).toBe(true)
    expect(matchesSearch(e, '0871234567')).toBe(true)
    expect(matchesSearch(e, '123 45')).toBe(true)
    expect(matchesSearch(e, '+353 87 123')).toBe(true)
    expect(matchesSearch(e, 'cork')).toBe(false)
    expect(matchesSearch(e, '999')).toBe(false)
  })
})

describe('nextStep', () => {
  it('chooses the one thing to do at each stage', () => {
    expect(nextStep('contact')).toBe('contact')
    expect(nextStep('new')).toBe('reach')
    expect(nextStep('contacted')).toBe('waiting')
    expect(nextStep('booked')).toBe('appointment')
    expect(nextStep('awaiting_quote')).toBe('record')
    expect(nextStep('quoted')).toBe('quoted')
    expect(nextStep('won')).toBe('result')
    expect(nextStep('lost')).toBe('result')
    expect(nextStep('closed')).toBe('closed')
    expect(nextStep('other')).toBe('newer')
  })
})

describe('quick actions', () => {
  it('builds tel, mailto and directions links only from usable values', () => {
    expect(telHref('087 765 4321')).toBe('tel:0877654321')
    expect(telHref('+353 87 765 4321')).toBe('tel:+353877654321')
    expect(telHref('')).toBeNull()
    expect(mailHref(' sample@example.com ')).toBe('mailto:sample@example.com')
    expect(mailHref('not an email')).toBeNull()
    expect(directionsHref('12 Example Road, Dublin 8')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=12%20Example%20Road%2C%20Dublin%208',
    )
    expect(directionsHref(null)).toBeNull()
  })
  it('drives to the stored site address, else the street answered, else nowhere', () => {
    expect(siteAddress({}, { site_address: '1 Main St, Cork' })).toBe('1 Main St, Cork')
    expect(siteAddress({ site_street: '12 Example Road', location: 'Dublin 8' }, null)).toBe(
      '12 Example Road, Dublin 8',
    )
    expect(siteAddress({ location: 'Dublin 8' }, null)).toBeNull()
  })
})
