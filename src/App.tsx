import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'
import { PublicLayout } from '@/components/public-layout'
import { BookingPage } from '@/pages/booking-page'
import { ConfirmationPage } from '@/pages/confirmation-page'
import { EnquiryPage } from '@/pages/enquiry-page'
import { LandingPage } from '@/pages/landing-page'
import { PrivacyPage } from '@/pages/privacy-page'

const StaffListRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffListRoute })),
)
const StaffAppointmentsRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffAppointmentsRoute })),
)
const StaffSettingsRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffSettingsRoute })),
)
const StaffReportRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffReportRoute })),
)
const StaffPeopleRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffPeopleRoute })),
)
const StaffForgotRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffForgotRoute })),
)
const StaffSetPasswordRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffSetPasswordRoute })),
)
const StaffDetailRoute = lazy(() =>
  import('@/pages/staff/routes').then((m) => ({ default: m.StaffDetailRoute })),
)

function NotFound() {
  return (
    <PublicLayout>
      <h1 className="text-section text-ink font-bold">Page not found</h1>
      <p className="text-muted-foreground mt-2">
        <Link to="/" className="underline underline-offset-4">
          Go to the home page
        </Link>
      </p>
    </PublicLayout>
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
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/enquire" element={<EnquiryPage />} />
        <Route path="/enquire/sent" element={<ConfirmationPage />} />
        <Route path="/book/:token" element={<BookingPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/staff" element={<StaffListRoute />} />
        <Route path="/staff/enquiries/:id" element={<StaffDetailRoute />} />
        <Route path="/staff/appointments" element={<StaffAppointmentsRoute />} />
        <Route path="/staff/settings" element={<StaffSettingsRoute />} />
        <Route path="/staff/report" element={<StaffReportRoute />} />
        <Route path="/staff/settings/people" element={<StaffPeopleRoute />} />
        <Route path="/staff/forgot" element={<StaffForgotRoute />} />
        <Route path="/staff/set-password" element={<StaffSetPasswordRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
