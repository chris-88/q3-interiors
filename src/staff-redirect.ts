import { STAFF_URL } from '../supabase/functions/_shared/site.ts'

/**
 * Where an old customer-site staff URL lives now: `/staff/x?y` on the customer site becomes
 * `/#/x?y` on the staff site (and `/staff` the console home). The query is kept, so set-password
 * and forgot-password links already emailed still work.
 */
export function staffHostUrl(pathname: string, search: string): string {
  const rest = pathname.replace(/^\/staff(?=\/|$)/, '') || '/'
  return `${STAFF_URL}/#${rest}${search}`
}

/** The same mapping on the staff site itself, for old `/staff/...` links: a router path. */
export function unprefixedStaffPath(pathname: string, search: string): string {
  return `${pathname.replace(/^\/staff(?=\/|$)/, '') || '/'}${search}`
}
