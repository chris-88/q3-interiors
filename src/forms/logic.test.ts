import { enquiryV1 } from './enquiry/v1'
import {
  allFields,
  cleanAnswers,
  formatAnswer,
  findField,
  isVisible,
  validateFields,
  visibleFields,
} from './logic'
import type { Answers, FormDefinition } from './types'

const valid: Answers = {
  project_type: 'kitchen',
  description: 'Replace the kitchen units and worktops.',
  location: 'D07 X2Y3',
  timing: 'flexible',
  name: 'Test Person',
  email: 'test@example.com',
  phone: '087 123 4567',
}

const fields = allFields(enquiryV1)

function field(id: string) {
  const found = findField(enquiryV1, id)
  if (!found) throw new Error(`no field ${id}`)
  return found
}

describe('schema shape', () => {
  it('has unique field ids', () => {
    const ids = fields.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only makes fields conditional on fields that come earlier', () => {
    fields.forEach((f, index) => {
      if (!f.visibleWhen) return
      const controller = fields.findIndex((other) => other.id === f.visibleWhen?.field)
      expect(controller).toBeGreaterThanOrEqual(0)
      expect(controller).toBeLessThan(index)
    })
  })
})

describe('conditional visibility', () => {
  it('hides the rooms question for a single-room project', () => {
    expect(isVisible(field('rooms'), { project_type: 'kitchen' })).toBe(false)
  })

  it('shows the rooms question for multi-room projects', () => {
    for (const type of ['several_rooms', 'whole_home', 'extension', 'other']) {
      expect(isVisible(field('rooms'), { project_type: type })).toBe(true)
    }
  })

  it('hides conditional questions until the controlling answer exists', () => {
    expect(isVisible(field('project_type_other'), {})).toBe(false)
    expect(isVisible(field('project_type_other'), { project_type: 'other' })).toBe(true)
  })

  it('lists only the visible fields of a step', () => {
    const step = enquiryV1.steps[0]
    expect(step).toBeDefined()
    const ids = visibleFields(step?.fields ?? [], { project_type: 'bathroom' }).map((f) => f.id)
    expect(ids).toEqual(['project_type'])
  })
})

describe('validation derived from the schema', () => {
  it('accepts a complete set of answers', () => {
    expect(validateFields(fields, valid)).toEqual({})
  })

  it('requires required fields and reports them by field id', () => {
    const errors = validateFields(fields, {})
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining([
        'project_type',
        'description',
        'location',
        'timing',
        'name',
        'email',
        'phone',
      ]),
    )
    expect(errors).not.toHaveProperty('budget')
  })

  it('does not validate hidden conditional fields', () => {
    expect(validateFields(fields, valid)).not.toHaveProperty('rooms')
  })

  it('requires a visible conditional field', () => {
    const errors = validateFields(fields, { ...valid, project_type: 'whole_home' })
    expect(errors.rooms).toBe('Choose at least one.')
    expect(
      validateFields(fields, { ...valid, project_type: 'other' }).project_type_other,
    ).toBeDefined()
  })

  it('rejects options that are not in the schema', () => {
    expect(validateFields(fields, { ...valid, timing: 'yesterday' }).timing).toBeDefined()
    expect(
      validateFields(fields, { ...valid, project_type: 'whole_home', rooms: ['kitchen', 'garage'] })
        .rooms,
    ).toBeDefined()
  })

  it('treats the budget as optional but still checks a given value', () => {
    expect(validateFields(fields, { ...valid, budget: 'need_guidance' })).toEqual({})
    expect(validateFields(fields, { ...valid, budget: 'a lot' }).budget).toBeDefined()
  })

  it('checks email and phone formats', () => {
    expect(validateFields(fields, { ...valid, email: 'not-an-email' }).email).toMatch(
      /email address/,
    )
    expect(validateFields(fields, { ...valid, phone: '12' }).phone).toMatch(/phone number/)
    expect(validateFields(fields, { ...valid, phone: '+353 87 123 4567' })).toEqual({})
  })

  it('enforces min and max lengths after trimming', () => {
    expect(validateFields(fields, { ...valid, description: '   short   ' }).description).toMatch(
      /a little more/,
    )
    expect(validateFields(fields, { ...valid, name: 'x'.repeat(121) }).name).toMatch(/under 120/)
  })

  it('treats whitespace-only text as missing', () => {
    expect(validateFields(fields, { ...valid, name: '   ' }).name).toBe('This is required.')
  })

  it('validates optional text fields only when filled in', () => {
    const form: FormDefinition = {
      formId: 'test',
      version: 1,
      title: 't',
      steps: [
        {
          id: 's',
          title: 's',
          fields: [{ id: 'note', type: 'email', label: 'Note', required: false, maxLength: 50 }],
        },
      ],
    }
    const optional = allFields(form)
    expect(validateFields(optional, {})).toEqual({})
    expect(validateFields(optional, { note: '' })).toEqual({})
    expect(validateFields(optional, { note: 'nope' }).note).toBeDefined()
  })
})

describe('cleanAnswers', () => {
  it('drops answers to hidden questions, blanks and unknown keys, and trims text', () => {
    const cleaned = cleanAnswers(enquiryV1, {
      ...valid,
      name: '  Test Person  ',
      rooms: ['kitchen'],
      project_type_other: 'boat',
      budget: '',
      surprise: 'x',
    })
    expect(cleaned).toEqual({ ...valid })
  })

  it('keeps a conditional answer while its question is visible', () => {
    const cleaned = cleanAnswers(enquiryV1, {
      ...valid,
      project_type: 'whole_home',
      rooms: ['kitchen', 'bedrooms'],
    })
    expect(cleaned.rooms).toEqual(['kitchen', 'bedrooms'])
  })
})

describe('formatAnswer', () => {
  it('renders choices through the labels of the given version', () => {
    expect(formatAnswer(field('timing'), 'flexible')).toBe('I am flexible')
    expect(formatAnswer(field('rooms'), ['kitchen', 'attic'])).toBe('Kitchen, Attic')
    expect(formatAnswer(field('budget'), undefined)).toBeNull()
  })

  it('shows an unrecognised stored value as it is rather than hiding it', () => {
    expect(formatAnswer(field('timing'), 'retired_option')).toBe('retired_option')
  })
})
