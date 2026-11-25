import { describe, expect, it } from 'vitest'
import {
  WORDING,
  WORDING_KEYS,
  renderMessage,
  renderStaffAlert,
  wordingProblem,
  type Wording,
} from './messages.ts'
import type { BookingContext, EnquirySummary } from './types.ts'

const ctx = (mode: 'phone' | 'on_site' = 'on_site') =>
  ({
    booking: { starts_at: '2027-03-04T10:00:00Z' },
    enquiry: {
      id: 'e1',
      reference: 'Q3-ABC123',
      answers: { name: 'Ann Smith', phone: '087 123 4567' },
      site_details: { site_address: '12 Example Road' },
    },
    staff: { display_name: 'Pat Quinn' },
    type: { mode, duration_minutes: 60, what_to_prepare: 'Clear the hallway.' },
  }) as unknown as BookingContext

const base = {
  manageUrl: 'https://q3.example/#/book/tok',
  businessPhone: null,
  privacyUrl: 'https://q3.example/#/privacy',
  siteUrl: 'https://q3.example',
}

/** Rewords every block, including attempts at markup. */
const hostile: Wording = Object.fromEntries(
  WORDING_KEYS.map((k) => [k, `<b>${k}</b> <script>alert(1)</script>`]),
)

describe('wording blocks', () => {
  it('validate length, emptiness, tokens and control characters', () => {
    expect(wordingProblem('booking_confirmation.intro', '')).toBe('This cannot be empty.')
    expect(wordingProblem('booking_confirmation.closing', '')).toBeNull()
    expect(wordingProblem('sign_off', 'x'.repeat(121))).toBe('Use at most 120 characters.')
    expect(
      wordingProblem('booking_confirmation.intro', 'Hi {first_name}, your {event} is set.'),
    ).toBeNull()
    expect(wordingProblem('booking_confirmation.intro', 'Your {date} is set.')).toMatch(
      /Only these/,
    )
    expect(wordingProblem('visit_disclaimer', 'See you {first_name}')).toBe(
      'Curly brackets cannot be used here.',
    )
    expect(wordingProblem('sign_off', 'Q3\u0007')).toBe('Remove the unusual characters.')
    for (const key of WORDING_KEYS) expect(wordingProblem(key, WORDING[key].default)).toBeNull()
  })

  it('fill tokens and use the reworded text', () => {
    const m = renderMessage('booking_confirmation', {
      ...base,
      ctx: ctx('phone'),
      wording: {
        'booking_confirmation.intro': 'Thanks {first_name}! Your {event} is in the diary.',
        sign_off: 'Pat and the Q3 team',
      },
    })
    expect(m.text).toContain('Thanks Ann! Your call is in the diary.')
    expect(m.text).toContain('Pat and the Q3 team')
    expect(m.text).toContain('This call is to talk your project through.')
  })

  it('fall back to the default when a stored block is not valid', () => {
    const m = renderMessage('booking_reminder', {
      ...base,
      ctx: ctx(),
      wording: { 'booking_reminder.intro': 'Your {date}' },
    })
    expect(m.text).toContain('A reminder of your site visit with Q3 Interiors.')
  })

  it('leave an empty optional paragraph out', () => {
    const m = renderMessage('booking_confirmation', {
      ...base,
      ctx: ctx(),
      wording: { 'booking_confirmation.closing': 'Parking is on the road.' },
    })
    expect(m.text).toMatch(/Parking is on the road\.\n\nQ3 Interiors/)
    expect(renderMessage('booking_confirmation', { ...base, ctx: ctx() }).text).toMatch(
      /price range\. It does not commit you to a quote, and it is not a start date\.\n\nQ3 Interiors/,
    )
  })

  it('lead the confirmation with the time, length and what will happen, then the reference', () => {
    const visit = renderMessage('booking_confirmation', { ...base, ctx: ctx() }).text
    expect(visit).toMatch(
      /Thursday 4 March 2027 at 10:00 \(Irish time\)\nAbout 60 minutes\n\nPat will meet you at 12 Example Road\.\n\nYour enquiry reference is Q3-ABC123\.\n\nChange time: https:\/\/q3.example\/#\/book\/tok\?do=change\n\nCancel appointment: https:\/\/q3.example\/#\/book\/tok\?do=cancel/,
    )
    const call = renderMessage('booking_confirmation', { ...base, ctx: ctx('phone') })
    expect(call.text).toContain('Pat will ring you on 087 123 4567.')
    expect(call.html).toContain('>Change time</a>')
    expect(call.html).toContain('>Cancel appointment</a>')
  })

  it.each([
    'booking_confirmation',
    'booking_reminder',
    'booking_rescheduled',
    'booking_cancelled',
  ] as const)(
    '%s keeps its fixed parts and escapes everything, however it is reworded',
    (template) => {
      const m = renderMessage(template, {
        ...base,
        ctx: ctx(),
        wording: hostile,
        cancelledStart: '2027-03-04T10:00:00Z',
      })
      // The date and time, the reference, the main link, the privacy link, a plain-text part.
      expect(m.text).toContain('Thursday 4 March 2027 at 10:00')
      expect(m.text).toContain('Q3-ABC123')
      expect(m.text).toContain('https://q3.example/#/book/tok')
      expect(m.text).toContain('How we use your details: https://q3.example/#/privacy')
      expect(m.html).toMatch(/href="https:\/\/q3.example\/#\/book\/tok(\?do=change)?"/)
      expect(m.html).toContain('href="https://q3.example/#/privacy"')
      // No markup gets through from a block.
      expect(m.html).not.toContain('<script>')
      expect(m.html).not.toMatch(/<b>/)
      expect(m.html).toContain('&lt;script&gt;')
    },
  )

  it('give staff the v2 choice and follow-ups, and mark a contact request', () => {
    const summary = {
      id: 'e1',
      reference: 'Q3-ABC123',
      answers: {
        appointment_preference: 'on_site',
        project_type: 'kitchen',
        kitchen_layout: 'guidance',
        location: 'Dublin 8',
      },
      schema: {
        steps: [
          {
            fields: [
              {
                id: 'appointment_preference',
                options: [{ value: 'on_site', label: 'Site visit' }],
              },
              { id: 'project_type', options: [{ value: 'kitchen', label: 'Kitchen' }] },
              {
                id: 'kitchen_layout',
                options: [{ value: 'guidance', label: 'I’d like guidance' }],
              },
            ],
          },
        ],
      },
      contact_request_reason: 'No suitable time',
    } as unknown as EnquirySummary
    const alert = renderStaffAlert('staff_callback_request', {
      summary,
      staffUrl: 'https://staff.example/#/enquiries/e1',
    })
    expect(alert.subject).toBe('Call-back requested Q3-ABC123: Kitchen')
    expect(alert.text).toContain(
      'Project: Kitchen\nArea: Dublin 8\nAsked for: Site visit\nKitchen layout: I’d like guidance\nWhy: No suitable time',
    )
  })

  it('apply to staff alerts too, with the fixed details kept', () => {
    const summary = {
      id: 'e1',
      reference: 'Q3-ABC123',
      answers: { project_type_other: 'Attic', location: 'D7' },
      schema: null,
      contact_request_reason: null,
    } as unknown as EnquirySummary
    const m = renderStaffAlert('staff_new_enquiry', {
      summary,
      staffUrl: 'https://q3.example/#/staff/enquiries/e1',
      wording: { 'staff_new_enquiry.intro': 'New one!', 'staff_new_enquiry.note': '' },
    })
    expect(m.text).toMatch(/^New one!\n\nReference: Q3-ABC123/)
    expect(m.text).not.toContain('may book a call')
    expect(m.html).toContain('href="https://q3.example/#/staff/enquiries/e1"')
  })
})
