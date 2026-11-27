import { findField, formatAnswer } from '@/forms/logic'
import type { FormDefinition } from '@/forms/types'

type Answered = { reference: string; answers: Record<string, string | string[]> }

/** The customer's name, else the reference (an enquiry always has one of them). */
export function enquiryName(e: Answered): string {
  const name = e.answers.name
  return typeof name === 'string' && name.trim() ? name.trim() : e.reference
}

/** The project type alone ("Kitchen"), or what they typed for "something else"; null if none. */
export function projectType(e: Answered, form: FormDefinition | undefined): string | null {
  const other = e.answers.project_type_other
  const type = e.answers.project_type
  const field = form ? findField(form, 'project_type') : undefined
  if (typeof other === 'string' && other.trim()) return other.trim()
  return (field ? formatAnswer(field, type) : null) ?? (typeof type === 'string' ? type : null)
}

/** "Kitchen · Dublin 8": the project type (or what they typed for "something else") and town. */
export function projectLine(e: Answered, form: FormDefinition | undefined): string {
  const other = e.answers.project_type_other
  const type = e.answers.project_type
  const field = form ? findField(form, 'project_type') : undefined
  const project =
    typeof other === 'string' && other.trim()
      ? other.trim()
      : ((field ? formatAnswer(field, type) : null) ?? (typeof type === 'string' ? type : null))
  const town = e.answers.location
  return [project ?? 'Project', typeof town === 'string' && town.trim() ? town.trim() : null]
    .filter(Boolean)
    .join(' · ')
}

// The list's search, remembered per tab (sessionStorage) so the enquiry page can walk the same list
// and coming back finds it as it was. Search text stays in this tab, never in a URL.
const SEARCH_KEY = 'q3.staff.enquirySearch'

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
  } catch {
    // storage blocked: it still works for this visit
  }
}

export const storedSearch = (): string => read(SEARCH_KEY) ?? ''
export const storeSearch = (q: string) => write(SEARCH_KEY, q)
