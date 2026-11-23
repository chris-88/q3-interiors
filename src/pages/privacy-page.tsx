import type { ReactNode } from 'react'
import { PublicLayout } from '@/components/public-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { business } from '@/config/business'

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground mt-2 flex flex-col gap-3 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function Missing({ what }: { what: string }) {
  return <em className="text-foreground">[{what} to be added]</em>
}

/**
 * PLACEHOLDER WORDING. The structure follows what this system actually does; the text must be
 * reviewed and replaced by Q3 Interiors before the pilot. Legal details come from
 * src/config/business.ts.
 */
export function PrivacyPage() {
  return (
    <PublicLayout>
      <h1 className="text-2xl font-semibold tracking-tight">How we use your details</h1>
      <Alert className="mt-4">
        <AlertTitle>Draft</AlertTitle>
        <AlertDescription>
          This notice is a draft and will be finalised by {business.name} before we take enquiries
          from the public.
        </AlertDescription>
      </Alert>

      <Part title="Who we are">
        <p>
          {business.legalName ?? <Missing what="Business legal name" />}, trading as {business.name}
          , is responsible for your details.{' '}
          {business.postalAddress ? (
            `Our address is ${business.postalAddress}.`
          ) : (
            <Missing what="Postal address" />
          )}
        </p>
      </Part>

      <Part title="What we collect">
        <ul className="list-disc pl-5">
          <li>
            Your answers in the enquiry form: the project, the area or Eircode, timing and budget.
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
          We keep enquiries while we are dealing with them and for a period afterwards that we are
          still deciding. <Missing what="Retention period" /> If you become a customer we keep what
          we need for the job and our records.
        </p>
      </Part>

      <Part title="Your rights">
        <p>
          You can ask for a copy of your details, ask us to correct them, or ask us to delete them.
          Contact us at {business.privacyContact ?? <Missing what="Privacy contact" />} and quote
          your reference if you have one. You can also complain to the Data Protection Commission
          (dataprotection.ie).
        </p>
      </Part>
    </PublicLayout>
  )
}
