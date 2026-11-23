/**
 * Business values shown to customers. Every value marked PLACEHOLDER must be confirmed with
 * Q3 Interiors before paid traffic. A value left `null` is simply not shown: the copy is written
 * to read correctly without it, so nothing unconfirmed is ever claimed on the page.
 *
 * The privacy notice (`/#/privacy`) reads the legal details below; while they are null it says
 * plainly that they are still to be added.
 */
export type BusinessConfig = {
  name: string
  /** e.g. 'Dublin and north Kildare'. PLACEHOLDER: not yet confirmed. */
  serviceArea: string | null
  /** Public contact email for customers. PLACEHOLDER: not yet confirmed. */
  contactEmail: string | null
  /** Public contact phone for customers, as it should be displayed. PLACEHOLDER: not yet confirmed. */
  contactPhone: string | null
  /** Registered legal name of the business (the data controller). PLACEHOLDER. */
  legalName: string | null
  /** Postal address for the business. PLACEHOLDER. */
  postalAddress: string | null
  /** Where people send privacy requests (access, correction, deletion). PLACEHOLDER. */
  privacyContact: string | null
}

export const business: BusinessConfig = {
  name: 'Q3 Interiors',
  serviceArea: null, // PLACEHOLDER: service area to be confirmed with Q3 Interiors
  contactEmail: null, // PLACEHOLDER: contact email to be confirmed with Q3 Interiors
  contactPhone: null, // PLACEHOLDER: contact phone to be confirmed with Q3 Interiors
  legalName: null, // PLACEHOLDER: registered business name (data controller)
  postalAddress: null, // PLACEHOLDER: business postal address
  privacyContact: null, // PLACEHOLDER: email or address for privacy requests
}

/** Contact details customers can use when the online system cannot help, if confirmed. */
export function contactLine(): string | null {
  const parts = [business.contactPhone, business.contactEmail].filter((v): v is string =>
    Boolean(v),
  )
  return parts.length ? parts.join(' or ') : null
}
