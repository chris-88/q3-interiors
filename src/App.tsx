import { Suspense, useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { PublicLayout } from '@/components/public-layout'
import { BookingPage } from '@/pages/booking-page'
import { ConfirmationPage } from '@/pages/confirmation-page'
import { EnquiryPage } from '@/pages/enquiry-page'
import { EstimatePage } from '@/pages/estimate-page'
import { QuoteChangePage, QuoteDepositPage, QuotePage } from '@/pages/quote-page'
import { LandingPage } from '@/pages/landing-page'
import { PrivacyPage } from '@/pages/privacy-page'
import { countArrival } from '@/api/visits'
import { staffHostUrl } from './staff-redirect'

/** Counts this tab's arrival on the landing page or the form (once, never blocking). */
function VisitCounter() {
  const { pathname } = useLocation()
  useEffect(() => {
    const id = window.setTimeout(() => countArrival(pathname), 0)
    return () => window.clearTimeout(id)
  }, [pathname])
  return null
}

function NotFound() {
  return (
    <PublicLayout>
      <h1 className="text-section text-ink font-medium">Page not found</h1>
      <p className="text-muted-foreground mt-2">
        <Link to="/" className="underline underline-offset-4">
          Go to the home page
        </Link>
      </p>
    </PublicLayout>
  )
}

/**
 * The staff console lives on its own host. Old links here (including set-password links already
 * emailed) go to the same place there, query and all. The only staff code in the customer build.
 */
function ToStaffHost() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    window.location.replace(staffHostUrl(pathname, search))
  }, [pathname, search])
  return (
    <p className="text-muted-foreground p-6 text-sm" aria-live="polite">
      Opening the staff site…
    </p>
  )
}

function Loading() {
  return (
    <p className="text-muted-foreground p-6 text-sm" aria-busy="true">
      Loading…
    </p>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <VisitCounter />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/enquire" element={<EnquiryPage />} />
        <Route path="/enquire/sent" element={<ConfirmationPage />} />
        <Route path="/book/:token" element={<BookingPage />} />
        <Route path="/estimate/:token/:estimateId" element={<EstimatePage />} />
        <Route path="/quote/:token/:quoteId" element={<QuotePage />} />
        <Route path="/quote/:token/:quoteId/change" element={<QuoteChangePage />} />
        <Route path="/quote/:token/:quoteId/deposit" element={<QuoteDepositPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/staff/*" element={<ToStaffHost />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
