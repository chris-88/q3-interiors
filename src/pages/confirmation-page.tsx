import { useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { Link } from 'react-router'
import { PublicLayout } from '@/components/public-layout'
import { buttonVariants } from '@/components/ui/button'
import { contactLine, usePublicBusiness } from '@/api/business'
import { readBookingAccess } from '@/lib/booking-access'
import { readSubmittedReference } from '@/lib/draft'
import { safeStorage } from '@/lib/storage'

/** Shown only after `submit_enquiry` has returned a reference. */
export function ConfirmationPage() {
  const [reference] = useState(() => readSubmittedReference(safeStorage('session')))
  const [access] = useState(() => readBookingAccess(safeStorage('local')))
  const contact = contactLine(usePublicBusiness())

  if (!reference) {
    return (
      <PublicLayout>
        <h1 className="text-section text-ink font-medium">No enquiry to show</h1>
        <p className="text-muted-foreground mt-2">
          This page shows your reference after you send an enquiry. If you have not sent one yet,
          you can start now.
        </p>
        <Link to="/enquire" className={buttonVariants({ size: 'lg', className: 'mt-6 h-12' })}>
          Tell us about your project
        </Link>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <CircleCheck className="text-foreground size-8" aria-hidden="true" />
      <h1 className="text-section text-ink mt-4 font-medium">Enquiry received</h1>
      <p className="text-muted-foreground mt-2">
        Your reference is below. Keep it handy if you contact us about this project.
      </p>
      <p className="mt-6 rounded-xl border px-4 py-5 text-center">
        <span className="text-muted-foreground block text-sm">Reference</span>
        <span className="mt-1 block font-mono text-2xl font-semibold tracking-wider">
          {reference}
        </span>
      </p>

      <h2 className="text-title text-ink mt-10 font-medium">What happens next</h2>
      <ul className="text-muted-foreground mt-4 flex list-disc flex-col gap-3 pl-5">
        <li>We will read your enquiry and get in touch by phone or email to talk it through.</li>
        <li>
          If a visit makes sense, we will arrange a time to see the space, take measurements and
          give you an estimated range.
        </li>
        <li>
          A site visit is for us to assess and price the work. It does not commit you to a quote,
          and it is not a start date.
        </li>
      </ul>
      {contact && (
        <p className="text-muted-foreground mt-6 text-sm">
          Need to add something? Contact us on {contact} and quote your reference.
        </p>
      )}
      {access && access.reference === reference && (
        <Link
          to={`/book/${access.token}`}
          className={buttonVariants({ size: 'lg', className: 'mt-10 h-12' })}
        >
          Choose a time to talk
        </Link>
      )}
      <Link
        to="/"
        className={buttonVariants({ variant: 'outline', size: 'lg', className: 'mt-4 h-12' })}
      >
        Back to the home page
      </Link>
    </PublicLayout>
  )
}
