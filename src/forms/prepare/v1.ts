import type { FormDefinition } from '../types.ts'

/**
 * "Help us prepare", version 1. PUBLISHED: asked after a booking (part B of the v2 journey) and
 * stored as an enquiry revision (`prepare_details`). Do not edit; add a v2 instead.
 *
 * `budget` and `timing` keep the ids and option values of enquiry v1, so v1 answers and these are
 * the same thing to the report and the staff views; only the labels are shorter.
 * Access notes are not here: they belong to the site details (`site_details.access_notes`), and
 * photos and the news-and-offers consent have their own records.
 */
export const prepareV1: FormDefinition = {
  formId: 'prepare',
  version: 1,
  title: 'Help us prepare',
  steps: [
    {
      id: 'prepare',
      title: 'Help us prepare',
      fields: [
        {
          id: 'budget',
          type: 'single',
          label: 'Rough budget',
          required: false,
          options: [
            { value: 'under_10k', label: 'Under €10,000' },
            { value: '10k_25k', label: '€10,000 to €25,000' },
            { value: '25k_50k', label: '€25,000 to €50,000' },
            { value: '50k_100k', label: '€50,000 to €100,000' },
            { value: 'over_100k', label: 'Over €100,000' },
            { value: 'need_guidance', label: 'I’d like guidance' },
          ],
        },
        {
          id: 'timing',
          type: 'single',
          label: 'When would you like the work to start?',
          required: false,
          options: [
            { value: 'asap', label: 'As soon as possible' },
            { value: 'within_3_months', label: 'Within 3 months' },
            { value: '3_to_6_months', label: 'In 3 to 6 months' },
            { value: '6_to_12_months', label: 'In 6 to 12 months' },
            { value: 'flexible', label: 'I’m flexible' },
          ],
        },
      ],
    },
  ],
}
