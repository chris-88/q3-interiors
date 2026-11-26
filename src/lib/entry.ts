import { z } from 'zod'
import type { FormDefinition } from '@/forms/types'
import { readJson, type SafeStorage } from './storage'
import type { Route } from './journey'
import { findProject } from './website'

/*
 * Arriving from the website (phase 1 of the website brief). A project page or the homepage links
 * to `https://book.q3interiors.ie/?appointment=call|visit[&inspiration=<slug>]
 * [&project_type=<label>][&utm_*]`. At boot (`takeEntry`, before the router renders) the
 * parameters are read from the real query string or from inside the hash route, kept for this
 * tab, and removed from the address bar; a known route opens the Project screen in the same tab
 * (`#/enquire?type=…`, which the enquiry page takes into the draft and drops, as for the landing
 * choices). Campaign tags and click ids are left where they are, so attribution is unchanged.
 * Nothing personal is ever read from or written to the URL.
 */

export const ENTRY_KEYS = ['appointment', 'type', 'inspiration', 'project_type'] as const

export type Entry = {
  /** The route to open, from `appointment` (call, visit) or the older `type` (phone, on_site). */
  route: Route | null
  /** A project type option value matched from its visible label, or null. */
  projectType: string | null
  /** A known website project slug, or null. */
  inspiration: string | null
  /** The link came from the website (any `appointment` value, or a known project). */
  fromWebsite: boolean
}

type UrlParts = { search: string; hash: string }

function split(hash: string): { path: string; query: string } {
  const route = hash.startsWith('#') ? hash.slice(1) : hash
  const i = route.indexOf('?')
  return i === -1
    ? { path: route, query: '' }
    : { path: route.slice(0, i), query: route.slice(i + 1) }
}

function params(query: string): URLSearchParams {
  try {
    return new URLSearchParams(query)
  } catch {
    return new URLSearchParams()
  }
}

const norm = (v: string | null) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const APPOINTMENTS: Record<string, Route> = { call: 'phone', visit: 'on_site' }
const TYPES: Record<string, Route> = { phone: 'phone', on_site: 'on_site' }

/** The project type option whose label matches, ignoring case and spacing. */
export function projectTypeFromLabel(form: FormDefinition, label: string | null): string | null {
  const wanted = norm(label)
  if (!wanted) return null
  const field = form.steps.flatMap((s) => s.fields).find((f) => f.id === 'project_type')
  if (!field || field.type !== 'single') return null
  return field.options.find((o) => norm(o.label) === wanted)?.value ?? null
}

/** Reads the entry parameters; a value before the `#` wins over one inside the hash route. */
export function parseEntry(url: UrlParts, form: FormDefinition): Entry {
  const outer = params(url.search)
  const inner = params(split(url.hash).query)
  const get = (key: string) => (outer.has(key) ? outer.get(key) : inner.get(key))
  const appointment = APPOINTMENTS[norm(get('appointment'))] ?? null
  const type = TYPES[norm(get('type'))] ?? null
  const inspiration = findProject(norm(get('inspiration')))?.slug ?? null
  return {
    route: appointment ?? type,
    projectType: projectTypeFromLabel(form, get('project_type')),
    inspiration,
    fromWebsite: get('appointment') !== null || inspiration !== null,
  }
}

function hasEntryKeys(url: UrlParts): boolean {
  const outer = params(url.search)
  const inner = params(split(url.hash).query)
  return ENTRY_KEYS.some((k) => outer.has(k) || inner.has(k))
}

/** Paths where entry parameters are taken: the landing page and the form. */
const ENTRY_PATHS = new Set(['', '/', '/enquire'])

/**
 * The address to show once the entry is taken: entry parameters removed from both places, other
 * parameters (campaign tags, click ids) kept, and the Project screen when a route is known.
 * Null when there is nothing to change.
 */
export function cleanedAddress(url: UrlParts & { pathname: string }, entry: Entry): string | null {
  const { path, query } = split(url.hash)
  if (!ENTRY_PATHS.has(path) || !hasEntryKeys(url)) return null
  const outer = params(url.search)
  const inner = params(query)
  for (const key of ENTRY_KEYS) {
    outer.delete(key)
    inner.delete(key)
  }
  if (entry.route) inner.set('type', entry.route)
  const search = outer.toString()
  const rest = inner.toString()
  const target = entry.route ? '/enquire' : path || '/'
  return `${url.pathname}${search ? `?${search}` : ''}#${target}${rest ? `?${rest}` : ''}`
}

// ---------------------------------------------------------------------------------------------
// What this tab keeps
// ---------------------------------------------------------------------------------------------

const KEY = 'q3.entry'

const contextSchema = z.object({
  inspiration: z.string().nullable(),
  fromWebsite: z.boolean(),
  /** A project type still to be put into the draft (taken once by the enquiry page). */
  pendingProjectType: z.string().nullable(),
})
export type EntryContext = z.infer<typeof contextSchema>

const EMPTY: EntryContext = { inspiration: null, fromWebsite: false, pendingProjectType: null }

// Survives storage that is blocked, for this page view.
let memory: EntryContext = EMPTY

export function readEntry(storage: SafeStorage): EntryContext {
  const parsed = contextSchema.safeParse(readJson(storage, KEY))
  if (!parsed.success) return memory
  // A known slug only: a project removed from the list is dropped.
  return { ...parsed.data, inspiration: findProject(parsed.data.inspiration)?.slug ?? null }
}

export function writeEntry(storage: SafeStorage, context: EntryContext) {
  memory = context
  storage.set(KEY, JSON.stringify(context))
}

/** The project type to pre-select has been put into the draft. */
export function takePendingProjectType(storage: SafeStorage) {
  const current = readEntry(storage)
  if (current.pendingProjectType !== null)
    writeEntry(storage, { ...current, pendingProjectType: null })
}

/** After a successful submission the project has been saved with it. */
export function clearInspiration(storage: SafeStorage) {
  writeEntry(storage, { ...readEntry(storage), inspiration: null })
}

/**
 * At boot, once (customer site): keep the entry for this tab and tidy the address. A new website
 * arrival replaces what an earlier one in this tab left; an arrival without entry parameters
 * keeps it (a reload, Back, or a later page).
 */
export function takeEntry(
  storage: SafeStorage,
  form: FormDefinition,
  location: Location = window.location,
  history: History = window.history,
) {
  const url = { search: location.search, hash: location.hash, pathname: location.pathname }
  if (!hasEntryKeys(url)) {
    memory = readEntry(storage)
    return
  }
  const entry = parseEntry(url, form)
  const before = readEntry(storage)
  if (entry.fromWebsite || entry.projectType) {
    writeEntry(storage, {
      inspiration: entry.fromWebsite ? entry.inspiration : before.inspiration,
      fromWebsite: before.fromWebsite || entry.fromWebsite,
      pendingProjectType: entry.projectType,
    })
  }
  const address = cleanedAddress(url, entry)
  if (address) {
    try {
      history.replaceState(history.state, '', address)
    } catch {
      // Some embedded browsers refuse; the enquiry page still drops ?type= itself.
    }
  }
}
