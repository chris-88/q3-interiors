import { allFields, cleanAnswers, validateFields } from '../logic'
import { enquiryV1 } from './v1'
import { composeSiteAddress, enquiryV2 } from './v2'

const call = {
  appointment_preference: 'phone',
  project_type: 'kitchen',
  location: 'Dublin 8',
  name: 'Test Person',
  email: 'test@example.com',
  phone: '087 123 4567',
}

describe('enquiry form v2', () => {
  it('keeps the v1 ids and option values it carries over', () => {
    const v1 = new Map(allFields(enquiryV1).map((f) => [f.id, f]))
    for (const id of ['project_type', 'project_type_other', 'location', 'name', 'email', 'phone']) {
      const before = v1.get(id)
      const after = allFields(enquiryV2).find((f) => f.id === id)
      expect(after?.type).toBe(before?.type)
      if (before?.type === 'single' && after?.type === 'single') {
        expect(after.options.map((o) => o.value)).toEqual(before.options.map((o) => o.value))
      }
    }
  })

  it('asks for the visit address only on the site-visit route, and the phone on both', () => {
    const fields = allFields(enquiryV2)
    expect(validateFields(fields, call)).toEqual({})
    const visit = { ...call, appointment_preference: 'on_site' }
    expect(Object.keys(validateFields(fields, visit))).toEqual(['site_street'])
    expect(validateFields(fields, { ...visit, site_street: '12 Example Road' })).toEqual({})
    expect(Object.keys(validateFields(fields, { ...call, phone: '' }))).toEqual(['phone'])
  })

  it('requires an answer for "Something else" only, with no minimum length', () => {
    const fields = allFields(enquiryV2)
    const other = { ...call, project_type: 'other' }
    expect(Object.keys(validateFields(fields, other))).toEqual(['project_type_other'])
    expect(validateFields(fields, { ...other, project_type_other: 'Shed' })).toEqual({})
    expect(validateFields(fields, { ...call, project_type: 'several_rooms' })).toEqual({})
  })

  it('drops answers to follow-ups that no longer apply', () => {
    const cleaned = cleanAnswers(enquiryV2, {
      ...call,
      project_type: 'bathroom',
      kitchen_layout: 'changing',
      site_street: '12 Example Road',
    })
    expect(cleaned).not.toHaveProperty('kitchen_layout')
    expect(cleaned).not.toHaveProperty('site_street')
  })

  it('joins the visit address as the database does', () => {
    expect(composeSiteAddress('12 Example Road', ' Apt 3 ', 'D07 X2Y3')).toBe(
      '12 Example Road, Apt 3, D07 X2Y3',
    )
    expect(composeSiteAddress('12 Example Road', '', 'Dublin 8')).toBe('12 Example Road, Dublin 8')
  })
})
