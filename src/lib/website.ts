/**
 * The public website, q3interiors.ie (built in its own repo). Its project pages link here with
 * `?appointment=call|visit[&inspiration=<slug>][&project_type=<label>]`. This is the one place
 * that knows its address and its projects.
 *
 * The projects are a small copy of the website's `projects.json` (slug, title, location only; no
 * photos). A slug not listed here is ignored on arrival; add a project here when the website
 * adds one.
 */
export const WEBSITE_URL = 'https://q3interiors.ie'

export type WebsiteProject = { slug: string; title: string; location: string }

export const WEBSITE_PROJECTS: readonly WebsiteProject[] = [
  { slug: 'donabate', title: 'Victorian hallway', location: 'Donabate, Co. Dublin' },
  { slug: 'fairview', title: 'Kitchen fit-out', location: 'Fairview, Dublin 3' },
  {
    slug: 'fitzwilliam-office',
    title: 'Georgian office fit-out',
    location: 'Fitzwilliam Square, Dublin 2',
  },
  { slug: 'castleknock', title: 'Victorian bathroom', location: 'Castleknock, Dublin 15' },
  {
    slug: 'fitzwilliam-bathroom',
    title: 'Georgian bathroom',
    location: 'Fitzwilliam Square, Dublin 2',
  },
  { slug: 'adelaide', title: 'Apartment fit-out', location: 'Adelaide Road, Dublin 2' },
]

export function findProject(slug: string | null | undefined): WebsiteProject | null {
  return WEBSITE_PROJECTS.find((p) => p.slug === slug) ?? null
}

/** The website's page for a project. */
export function projectUrl(slug: string): string {
  return `${WEBSITE_URL}/our-work/${slug}/`
}
