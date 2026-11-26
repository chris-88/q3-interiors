import { currentEnquiryForm } from './forms/enquiry/v3'
import { initAttribution } from './lib/attribution'
import { takeEntry } from './lib/entry'
import { safeStorage } from './lib/storage'

/**
 * Customer site only, before the router renders: read campaign tags from the arrival address,
 * then take a website link's entry parameters (route, project type, inspiration) and tidy the
 * address. Loaded by `main.tsx` only in the customer build, so the staff bundle carries none of
 * the journey.
 */
export function bootCustomer() {
  initAttribution(safeStorage('local'))
  takeEntry(safeStorage('session'), currentEnquiryForm)
}
