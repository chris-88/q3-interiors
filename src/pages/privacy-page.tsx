import type { ReactNode } from 'react'
import { PublicLayout } from '@/components/public-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { contactLine, usePublicBusiness } from '@/api/business'

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-title text-ink font-medium">{title}</h2>
      <div className="text-muted-foreground mt-2 flex flex-col gap-3 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

/**
 * PLACEHOLDER WORDING. The structure follows what this system actually does; the text must be
 * reviewed by Q3 Interiors before the pilot. Legal details come from Business details (an admin
 * edits them in Settings); anything not filled in is left out rather than shown as a gap. The
 * "Draft" marker goes once an admin marks the notice reviewed (go-live checklist).
 */
export function PrivacyPage() {
  const business = usePublicBusiness()
  const name = business.trading_name
  const requests = business.privacy_contact ?? business.contact_email
  return (
    <PublicLayout width="prose">
      <h1 className="text-section text-ink font-medium">How we use your details</h1>
      {!business.privacy_reviewed && (
        <Alert className="mt-4">
          <AlertTitle>Draft</AlertTitle>
          <AlertDescription>
            This notice is a draft and will be finalised by {name} before we take enquiries from the
            public.
          </AlertDescription>
        </Alert>
      )}

      <Part title="Who we are">
        <p>
          {business.legal_name ? `${business.legal_name}, trading as ${name},` : name} is
          responsible for your details.
          {business.postal_address ? ` Our address is ${business.postal_address}.` : ''}
        </p>
      </Part>

      <Part title="What we collect">
        <ul className="list-disc pl-5">
          <li>
            Your answers in the enquiry form: the project, the area or Eircode, and whether you want
            a call or a visit. After booking you may add a rough budget and when you would like the
            work to start.
          </li>
          <li>
            Photos you choose to add after booking. We use them only to prepare for your call or
            visit and the estimate. We shrink them and remove the location and camera details before
            they are stored, and they are deleted with your enquiry.
          </li>
          <li>Your name, email address and phone number.</li>
          <li>If you book a visit, the property address and any access notes.</li>
          <li>The appointment you choose, and any changes or cancellations.</li>
          <li>
            The campaign tags in the link you followed (for example which advert), and whether a
            click identifier was present. We do not keep the identifier itself.
          </li>
          <li>
            A one-way, keyed scramble of your network address, kept for at most 24 hours, so we can
            stop the same address sending too many enquiries. We do not store the address itself.
          </li>
          <li>Whether you asked to hear about news and offers.</li>
          <li>
            We count visits to this site and which advert they came from, without personal details
            or cookies: each browser tab gets a random number that is forgotten when the tab closes.
            Visit counts are deleted after 13 months.
          </li>
        </ul>
      </Part>

      <Part title="Why we use it">
        <p>
          To reply to your enquiry, arrange and confirm a call or visit, remind you of it, and give
          you an estimate. We also count how many enquiries each campaign brings in, without
          identifying you, to decide where to advertise. We only send news or offers if you asked
          for them.
        </p>
      </Part>

      <Part title="Who handles it for us">
        <ul className="list-disc pl-5">
          <li>Our database runs on our own server in Ireland.</li>
          <li>
            Google Calendar holds the appointment (time, your name, phone, and the address for a
            visit) so the person coming can see it.
          </li>
          <li>Resend sends our emails to you.</li>
          <li>Cloudflare carries traffic between your browser and our server.</li>
          <li>GitHub Pages serves this website&apos;s pages (it does not receive your answers).</li>
        </ul>
        <p>
          We do not use advertising pixels or tracking cookies, and we do not sell your details.
        </p>
      </Part>

      <Part title="How long we keep it">
        <p>
          {business.retention_months
            ? `We delete an enquiry ${business.retention_months} months after it comes in, unless you become a customer.`
            : 'We keep enquiries while we are dealing with them and for a limited time afterwards.'}{' '}
          Any photos you added are deleted with the enquiry. If you become a customer we keep what
          we need for the job and our records.
        </p>
      </Part>

      <Part title="Your rights">
        <p>
          You can ask for a copy of your details, ask us to correct them, or ask us to delete them.
          {requests
            ? `Contact us at ${requests} and quote your reference if you have one.`
            : contactLine(business)
              ? `Contact us on ${contactLine(business) ?? ''} and quote your reference if you have one.`
              : 'Reply to any email we have sent you and quote your reference.'}{' '}
          You can also complain to the Data Protection Commission (dataprotection.ie).
        </p>
      </Part>
    </PublicLayout>
  )
}
