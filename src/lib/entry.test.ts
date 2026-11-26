import { describe, expect, it } from 'vitest'
import { enquiryV2 } from '@/forms/enquiry/v2'
import { currentEnquiryForm, enquiryV3 } from '@/forms/enquiry/v3'
import {
  cleanedAddress,
  parseEntry,
  projectTypeFromLabel,
  readEntry,
  takeEntry,
  takePendingProjectType,
} from './entry'
import type { SafeStorage } from './storage'
import { WEBSITE_PROJECTS, findProject, projectUrl } from './website'

const form = currentEnquiryForm
const url = (search: string, hash = '') => ({ search, hash, pathname: '/' })

function memoryStorage(): SafeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  }
}

describe('parseEntry', () => {
  it('maps appointment=call|visit to the route, and keeps the older type=', () => {
    expect(parseEntry(url('?appointment=call'), form).route).toBe('phone')
    expect(parseEntry(url('?appointment=visit'), form).route).toBe('on_site')
    expect(parseEntry(url('?appointment=VISIT'), form).route).toBe('on_site')
    expect(parseEntry(url('', '#/enquire?type=phone'), form).route).toBe('phone')
    expect(parseEntry(url('?appointment=video'), form).route).toBeNull()
    expect(parseEntry(url(''), form).route).toBeNull()
  })
  it('reads the parameters inside the hash route too; before the # wins', () => {
    expect(parseEntry(url('', '#/?appointment=visit&inspiration=fairview'), form)).toEqual({
      route: 'on_site',
      projectType: null,
      inspiration: 'fairview',
      fromWebsite: true,
    })
    expect(parseEntry(url('?appointment=call', '#/?appointment=visit'), form).route).toBe('phone')
  })
  it('accepts only known project slugs', () => {
    for (const p of WEBSITE_PROJECTS)
      expect(parseEntry(url(`?appointment=visit&inspiration=${p.slug}`), form).inspiration).toBe(
        p.slug,
      )
    expect(parseEntry(url('?appointment=visit&inspiration=elsewhere'), form).inspiration).toBeNull()
    expect(parseEntry(url('?inspiration=Fairview'), form).inspiration).toBe('fairview')
  })
  it('is a website arrival with any appointment value or a known project', () => {
    expect(parseEntry(url('?appointment=nonsense'), form).fromWebsite).toBe(true)
    expect(parseEntry(url('?inspiration=adelaide'), form).fromWebsite).toBe(true)
    expect(parseEntry(url('', '#/enquire?type=phone'), form).fromWebsite).toBe(false)
    expect(parseEntry(url('?utm_source=instagram'), form).fromWebsite).toBe(false)
  })
})

describe('projectTypeFromLabel', () => {
  it('matches every visible label, ignoring case and spacing', () => {
    const labels: [string, string][] = [
      ['Kitchen', 'kitchen'],
      ['bathroom', 'bathroom'],
      ['Several rooms', 'several_rooms'],
      ['WHOLE HOME  RENOVATION', 'whole_home'],
      ['Extension', 'extension'],
      ['Attic conversion', 'attic'],
      ['Workplace fit-out', 'workplace'],
      [' Something else ', 'other'],
    ]
    for (const [label, value] of labels) expect(projectTypeFromLabel(form, label)).toBe(value)
  })
  it('ignores option values, unknown labels and empty ones', () => {
    expect(projectTypeFromLabel(form, 'whole_home')).toBeNull()
    expect(projectTypeFromLabel(form, 'Garden')).toBeNull()
    expect(projectTypeFromLabel(form, '')).toBeNull()
    expect(projectTypeFromLabel(form, null)).toBeNull()
  })
})

describe('cleanedAddress', () => {
  it('opens the Project screen, drops the entry keys and keeps campaign tags and click ids', () => {
    const u = url('?appointment=visit&inspiration=fairview&project_type=Kitchen&utm_source=site')
    expect(cleanedAddress(u, parseEntry(u, form))).toBe('/?utm_source=site#/enquire?type=on_site')
    const inner = url('', '#/?appointment=call&utm_campaign=home&fbclid=x')
    expect(cleanedAddress(inner, parseEntry(inner, form))).toBe(
      '/#/enquire?utm_campaign=home&fbclid=x&type=phone',
    )
  })
  it('without a usable route, stays on the landing page without the entry keys', () => {
    const u = url('?appointment=video&inspiration=fairview&utm_source=site')
    expect(cleanedAddress(u, parseEntry(u, form))).toBe('/?utm_source=site#/')
  })
  it('leaves other pages and untouched links alone', () => {
    expect(cleanedAddress(url('?utm_source=instagram'), parseEntry(url(''), form))).toBeNull()
    const booking = url('?appointment=call', '#/book/tok')
    expect(cleanedAddress(booking, parseEntry(booking, form))).toBeNull()
  })
})

describe('takeEntry', () => {
  const fakeWindow = (search: string, hash = '') => {
    const replaced: string[] = []
    return {
      location: { search, hash, pathname: '/' } as Location,
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, u: string) => replaced.push(u),
      } as unknown as History,
      replaced,
    }
  }
  it('keeps the project and the suggestion for this tab and tidies the address once', () => {
    const storage = memoryStorage()
    const w = fakeWindow('?appointment=visit&inspiration=fairview&project_type=Kitchen')
    takeEntry(storage, form, w.location, w.history)
    expect(w.replaced).toEqual(['/#/enquire?type=on_site'])
    expect(readEntry(storage)).toEqual({
      inspiration: 'fairview',
      fromWebsite: true,
      pendingProjectType: 'kitchen',
    })
    takePendingProjectType(storage)
    expect(readEntry(storage).pendingProjectType).toBeNull()
    // A reload of the tidied address changes nothing.
    const again = fakeWindow('', '#/enquire')
    takeEntry(storage, form, again.location, again.history)
    expect(again.replaced).toEqual([])
    expect(readEntry(storage).inspiration).toBe('fairview')
  })
  it('a plain Instagram arrival records nothing and does not touch the address', () => {
    const storage = memoryStorage()
    const w = fakeWindow('?utm_source=instagram&utm_campaign=kitchens')
    takeEntry(storage, form, w.location, w.history)
    expect(w.replaced).toEqual([])
    expect(storage.data.size).toBe(0)
  })
})

describe('website projects and form v3', () => {
  it('has the six projects with page links on the website', () => {
    expect(WEBSITE_PROJECTS.map((p) => p.slug)).toEqual([
      'donabate',
      'fairview',
      'fitzwilliam-office',
      'castleknock',
      'fitzwilliam-bathroom',
      'adelaide',
    ])
    expect(findProject('nope')).toBeNull()
    expect(projectUrl('fairview')).toBe('https://q3interiors.ie/our-work/fairview/')
  })
  it('v3 is v2 with Workplace fit-out before Something else, and nothing else changed', () => {
    const options = (f: typeof enquiryV2) =>
      f.steps.flatMap((s) => s.fields).find((x) => x.id === 'project_type' && x.type === 'single')
    const v2 = options(enquiryV2)
    const v3 = options(enquiryV3)
    expect(v3 && 'options' in v3 && v3.options.map((o) => o.value)).toEqual([
      'kitchen',
      'bathroom',
      'several_rooms',
      'whole_home',
      'extension',
      'attic',
      'workplace',
      'other',
    ])
    const strip = (f: typeof enquiryV2) =>
      JSON.stringify({
        ...f,
        version: 0,
        steps: f.steps.map((s) => ({
          ...s,
          fields: s.fields.map((x) =>
            x.id === 'project_type' && x.type === 'single'
              ? { ...x, options: x.options.filter((o) => o.value !== 'workplace') }
              : x,
          ),
        })),
      })
    expect(strip(enquiryV3)).toBe(strip(enquiryV2))
    expect(v2 && 'options' in v2 && v2.options.some((o) => o.value === 'workplace')).toBe(false)
    expect(enquiryV3.version).toBe(3)
  })
})
