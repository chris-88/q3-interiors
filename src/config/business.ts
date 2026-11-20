/**
 * Business values shown to customers. Every value marked PLACEHOLDER must be confirmed with
 * Q3 Interiors before paid traffic. A value left `null` is simply not shown: the copy is written
 * to read correctly without it, so nothing unconfirmed is ever claimed on the page.
 */
export type BusinessConfig = {
  name: string
  /** e.g. 'Dublin and north Kildare'. PLACEHOLDER: not yet confirmed. */
  serviceArea: string | null
  /** Public contact email for customers. PLACEHOLDER: not yet confirmed. */
  contactEmail: string | null
  /** Public contact phone for customers, as it should be displayed. PLACEHOLDER: not yet confirmed. */
  contactPhone: string | null
}

export const business: BusinessConfig = {
  name: 'Q3 Interiors',
  serviceArea: null, // PLACEHOLDER: service area to be confirmed with Q3 Interiors
  contactEmail: null, // PLACEHOLDER: contact email to be confirmed with Q3 Interiors
  contactPhone: null, // PLACEHOLDER: contact phone to be confirmed with Q3 Interiors
}
