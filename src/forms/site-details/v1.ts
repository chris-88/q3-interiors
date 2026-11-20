import type { FormDefinition } from '../types.ts'

/**
 * Site details, version 1. PUBLISHED: asked before an on-site visit is booked and stored as an
 * enquiry revision. Do not edit; add a v2 instead (see CLAUDE.md, "Form versions").
 */
export const siteDetailsV1: FormDefinition = {
  formId: 'site_details',
  version: 1,
  title: 'Where is the property?',
  steps: [
    {
      id: 'site',
      title: 'Where is the property?',
      description:
        'We need the address to plan the visit. It is only shared with the person visiting.',
      fields: [
        {
          id: 'site_address',
          type: 'textarea',
          label: 'Address of the property',
          help: 'Include the Eircode if you have it.',
          required: true,
          minLength: 8,
          maxLength: 300,
          autoComplete: 'street-address',
        },
        {
          id: 'access_notes',
          type: 'textarea',
          label: 'Anything we should know to get in?',
          help: 'For example parking, a side entrance, or a dog in the garden.',
          required: false,
          maxLength: 500,
        },
      ],
    },
  ],
}
