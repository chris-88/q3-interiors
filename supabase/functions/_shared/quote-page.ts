// The customer's "Get my quote" page: its staff-editable text blocks (Settings > Wording) and their
// defaults. Small on purpose: the customer site imports it, so it must not pull in the emails.

export const QUOTE_PAGE_WORDING = {
  quote_page_ask: {
    label: 'Estimate page: the ask',
    where: 'The page behind "Get my quote", under the estimate',
    default: 'If you’re happy with it, ask us for your quote.',
    max: 300,
  },
  quote_page_what: {
    label: 'Estimate page: what a quote is',
    where: 'The page behind "Get my quote", under "What a quote is"',
    default: 'One price for the work, in writing. It lists what’s included and what isn’t.',
    max: 300,
  },
  quote_page_steps: {
    label: 'Estimate page: what happens next',
    where:
      'The page behind "Get my quote", before and after the click, as a numbered list (one step per line)',
    default: [
      'We send your quote by email within 3 working days, with a PDF copy.',
      'If you want anything changed or added, tell us and we update the quote.',
      'A 10% deposit books your start date.',
      'We confirm your start date once the deposit is in.',
    ].join('\n'),
    max: 800,
  },
  quote_page_commit: {
    label: 'Estimate page: no commitment',
    where: 'The page behind "Get my quote", above the button',
    default: 'You don’t commit to anything until you accept the quote and pay the deposit.',
    max: 300,
  },
  quote_timing: {
    label: 'Estimate page: when the quote comes',
    where: 'After "Get my quote" is pressed, under the thanks (left out when empty)',
    default: 'You’ll have your quote within 3 working days.',
    max: 300,
    optional: true,
  },
} as const

export type QuotePageKey = keyof typeof QUOTE_PAGE_WORDING
export const QUOTE_PAGE_KEYS = Object.keys(QUOTE_PAGE_WORDING) as QuotePageKey[]
export type QuotePageText = Record<QuotePageKey, string>

/** Each block's saved text, else its default. An emptied optional block stays empty. */
export function quotePageText(saved: Record<string, string | undefined>): QuotePageText {
  const out = {} as QuotePageText
  for (const key of QUOTE_PAGE_KEYS) {
    const block = QUOTE_PAGE_WORDING[key]
    const value = saved[key]
    out[key] =
      value === undefined
        ? block.default
        : value.trim() || ('optional' in block && block.optional ? '' : block.default)
  }
  return out
}

/** The numbered steps: one per non-empty line, any typed "1." numbering removed. */
export function quoteSteps(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean)
}
