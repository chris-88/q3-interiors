// The quote email's pages, through the `public-booking` function with the enquiry's access token.
// Reading the quote or its PDF records nothing; "Ask for a change" is a button that posts.
import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { call, InvalidLinkError } from './booking'

const documentSchema = z.object({
  number: z.string(),
  version: z.number(),
  sentOn: z.string(),
  validUntil: z.string(),
  customerName: z.string(),
  jobAddress: z.string().nullable(),
  jobLine: z.string().nullable(),
  business: z.object({
    legalName: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  included: z.array(z.string()),
  excluded: z.array(z.string()),
  note: z.string().nullable(),
  price: z.number(),
  depositPercent: z.number(),
  depositEur: z.number(),
  terms: z.string(),
  fontBase: z.string(),
})

const quoteSchema = z.object({
  number: z.string(),
  version: z.number(),
  current: z.boolean(),
  price: z.number(),
  depositPercent: z.number(),
  depositEur: z.number(),
  validUntil: z.string(),
  changeRequested: z.boolean(),
  hasPdf: z.boolean(),
  businessPhone: z.string().nullable().default(null),
  document: documentSchema,
})

export type CustomerQuote = z.infer<typeof quoteSchema>

export function useCustomerQuote(token: string, quoteId: string) {
  return useQuery({
    queryKey: ['customer-quote', token, quoteId],
    queryFn: () => call({ action: 'quote', token, quoteId }, quoteSchema),
    retry: (count, error) => !(error instanceof InvalidLinkError) && count < 2,
  })
}

/** Fetch the PDF and hand it to the browser as a download. */
export function useDownloadQuotePdf(token: string, quoteId: string) {
  return useMutation({
    mutationFn: async () => {
      const r = await call(
        { action: 'quote_pdf', token, quoteId },
        z.object({ filename: z.string(), pdf: z.string() }),
      )
      const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = r.filename
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    },
  })
}

export function useAskForChange(token: string, quoteId: string) {
  return useMutation({
    mutationFn: (text: string) =>
      call(
        { action: 'quote_change', token, quoteId, text },
        z.object({ status: z.literal('requested') }),
      ),
  })
}
