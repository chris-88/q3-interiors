import type { FormDefinition } from '../types.ts'

/**
 * Enquiry form, version 2 (the booking-first journey). PUBLISHED: this object is stored in
 * `form_versions` and enquiries made with it are read through it. Do not edit it; add a v3.
 *
 * Field ids and option values carried over from v1 keep their meaning (`project_type` and its
 * values, `project_type_other`, `location`, `name`, `email`, `phone`). New in v2:
 * `appointment_preference` (chosen on the landing page), the project follow-ups
 * `kitchen_layout` and `rooms_involved`, and the visit address lines `site_street` and
 * `site_unit`. On save, the database joins the address lines and `location` into the enquiry's
 * site details (see `private.site_address_from_answers`), which is what bookings use.
 *
 * The screens do not render this generically: `src/pages/enquiry-page.tsx` lays it out as the
 * Project and Details screens and words the phone label by route. Validation still comes from
 * this schema, on the client and in `submit_enquiry`.
 */
export const enquiryV2: FormDefinition = {
  formId: 'enquiry',
  version: 2,
  title: 'Let’s talk about your renovation',
  steps: [
    {
      id: 'appointment',
      title: 'Phone call or site visit',
      fields: [
        {
          id: 'appointment_preference',
          type: 'single',
          label: 'Appointment preference',
          required: true,
          options: [
            { value: 'phone', label: 'Phone call' },
            { value: 'on_site', label: 'Site visit' },
          ],
        },
      ],
    },
    {
      id: 'project',
      title: 'What work are you planning?',
      fields: [
        {
          id: 'project_type',
          type: 'single',
          label: 'Project type',
          required: true,
          options: [
            { value: 'kitchen', label: 'Kitchen' },
            { value: 'bathroom', label: 'Bathroom' },
            { value: 'several_rooms', label: 'Several rooms' },
            { value: 'whole_home', label: 'Whole home renovation' },
            { value: 'extension', label: 'Extension' },
            { value: 'attic', label: 'Attic conversion' },
            { value: 'other', label: 'Something else' },
          ],
        },
        {
          id: 'kitchen_layout',
          type: 'single',
          label: 'Are you keeping the layout or changing it?',
          required: false,
          visibleWhen: { field: 'project_type', in: ['kitchen'] },
          options: [
            { value: 'keeping', label: 'Keeping it' },
            { value: 'changing', label: 'Changing it' },
            { value: 'guidance', label: 'I’d like guidance' },
          ],
        },
        {
          id: 'rooms_involved',
          type: 'text',
          label: 'Which rooms are involved?',
          required: false,
          maxLength: 200,
          visibleWhen: { field: 'project_type', in: ['several_rooms'] },
        },
        {
          id: 'project_type_other',
          type: 'text',
          label: 'What would you like us to look at?',
          required: true,
          maxLength: 200,
          visibleWhen: { field: 'project_type', in: ['other'] },
        },
        {
          id: 'location',
          type: 'text',
          label: 'Town or Eircode',
          required: true,
          minLength: 2,
          maxLength: 80,
          autoComplete: 'postal-code',
        },
      ],
    },
    {
      id: 'contact',
      title: 'How can we reach you?',
      fields: [
        {
          id: 'name',
          type: 'text',
          label: 'Your name',
          required: true,
          maxLength: 120,
          autoComplete: 'name',
        },
        {
          id: 'email',
          type: 'email',
          label: 'Email',
          required: true,
          maxLength: 254,
          autoComplete: 'email',
        },
        {
          id: 'phone',
          type: 'tel',
          label: 'Phone number',
          required: true,
          maxLength: 30,
          autoComplete: 'tel',
        },
        {
          id: 'site_street',
          type: 'text',
          label: 'House name or number and street',
          required: true,
          minLength: 4,
          maxLength: 150,
          autoComplete: 'address-line1',
          visibleWhen: { field: 'appointment_preference', in: ['on_site'] },
        },
        {
          id: 'site_unit',
          type: 'text',
          label: 'Apartment or unit',
          required: false,
          maxLength: 60,
          autoComplete: 'address-line2',
          visibleWhen: { field: 'appointment_preference', in: ['on_site'] },
        },
      ],
    },
  ],
}

/** The version new enquiries are made with. */
export const currentEnquiryForm: FormDefinition = enquiryV2

/** Joins the visit address lines and the town or Eircode, as the database does on save. */
export function composeSiteAddress(
  street: string | undefined,
  unit: string | undefined,
  location: string | undefined,
): string {
  return [street, unit, location]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(', ')
}
