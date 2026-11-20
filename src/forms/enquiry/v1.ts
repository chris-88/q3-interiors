import type { FormDefinition } from '../types.ts'

/**
 * Enquiry form, version 1. PUBLISHED: this object is stored in `form_versions` and old
 * enquiries are read through it. Do not edit it. To change a question, copy it to `v2.ts`,
 * bump `version`, and publish (see CLAUDE.md, "Form versions").
 */
export const enquiryV1: FormDefinition = {
  formId: 'enquiry',
  version: 1,
  title: 'Tell us about your project',
  steps: [
    {
      id: 'project',
      title: 'What kind of project is it?',
      description: 'Pick the closest match. You can add detail in the next step.',
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
          id: 'project_type_other',
          type: 'text',
          label: 'What kind of project?',
          required: true,
          maxLength: 120,
          visibleWhen: { field: 'project_type', in: ['other'] },
        },
      ],
    },
    {
      id: 'details',
      title: 'Tell us a little more',
      fields: [
        {
          id: 'description',
          type: 'textarea',
          label: 'What would you like done?',
          help: 'A few sentences in your own words is plenty.',
          required: true,
          minLength: 10,
          maxLength: 1000,
        },
        {
          id: 'rooms',
          type: 'multi',
          label: 'Which rooms or areas are involved?',
          help: 'Choose all that apply.',
          required: true,
          visibleWhen: {
            field: 'project_type',
            in: ['several_rooms', 'whole_home', 'extension', 'other'],
          },
          options: [
            { value: 'kitchen', label: 'Kitchen' },
            { value: 'bathroom', label: 'Bathroom or en suite' },
            { value: 'living', label: 'Living or dining areas' },
            { value: 'bedrooms', label: 'Bedrooms' },
            { value: 'hall_stairs', label: 'Hall, stairs and landing' },
            { value: 'utility', label: 'Utility room' },
            { value: 'attic', label: 'Attic' },
            { value: 'exterior', label: 'Outside the house' },
          ],
        },
      ],
    },
    {
      id: 'where_when',
      title: 'Where and when',
      fields: [
        {
          id: 'location',
          type: 'text',
          label: 'Eircode or area',
          help: 'An Eircode is best. If you do not have it to hand, the town or area is fine.',
          required: true,
          minLength: 2,
          maxLength: 120,
          autoComplete: 'postal-code',
          placeholder: 'e.g. D07 X2Y3 or Phibsborough',
        },
        {
          id: 'timing',
          type: 'single',
          label: 'When would you like the work to start?',
          required: true,
          options: [
            { value: 'asap', label: 'As soon as possible' },
            { value: 'within_3_months', label: 'Within 3 months' },
            { value: '3_to_6_months', label: 'In 3 to 6 months' },
            { value: '6_to_12_months', label: 'In 6 to 12 months' },
            { value: 'flexible', label: 'I am flexible' },
          ],
        },
      ],
    },
    {
      id: 'budget',
      title: 'Do you have a budget in mind?',
      description:
        'This is optional. It helps us plan the conversation, and it is fine not to know yet.',
      fields: [
        {
          id: 'budget',
          type: 'single',
          label: 'Budget',
          required: false,
          options: [
            { value: 'under_10k', label: 'Under €10,000' },
            { value: '10k_25k', label: '€10,000 to €25,000' },
            { value: '25k_50k', label: '€25,000 to €50,000' },
            { value: '50k_100k', label: '€50,000 to €100,000' },
            { value: 'over_100k', label: 'Over €100,000' },
            { value: 'need_guidance', label: 'Not sure, I would like guidance' },
          ],
        },
      ],
    },
    {
      id: 'contact',
      title: 'How can we reach you?',
      description: 'We use these details only to reply to your enquiry.',
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
          label: 'Phone',
          help: 'We usually ring to talk the project through.',
          required: true,
          maxLength: 30,
          autoComplete: 'tel',
        },
      ],
    },
  ],
}

/** The version new enquiries are made with. */
export const currentEnquiryForm: FormDefinition = enquiryV1
