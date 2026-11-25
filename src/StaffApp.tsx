import { useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router'
import { StaffPublicShell } from '@/components/staff/staff-layout'
import {
  StaffAdRoute,
  StaffAdsRoute,
  StaffAppointmentsRoute,
  StaffBookingRulesRoute,
  StaffBusinessRoute,
  StaffCampaignsRoute,
  StaffChecklistRoute,
  StaffDetailRoute,
  StaffForgotRoute,
  StaffListRoute,
  StaffPeopleRoute,
  StaffReportRoute,
  StaffSetPasswordRoute,
  StaffSettingsRoute,
  StaffWordingRoute,
} from '@/pages/staff/routes'
import { unprefixedStaffPath } from './staff-redirect'
import { startStaffPwa } from './staff-pwa'

// Service worker, update notice, install prompt (staff build only).
startStaffPwa()

/** Old `/staff/...` links on this host land on the same screen without the prefix. */
function Unprefix() {
  const { pathname, search } = useLocation()
  return <Navigate to={unprefixedStaffPath(pathname, search)} replace />
}

function NotFound() {
  useEffect(() => {
    document.title = 'Page not found · Q3 Interiors Staff'
  }, [])
  return (
    <StaffPublicShell>
      <h1 className="text-section text-ink font-medium">Page not found</h1>
      <p className="text-muted-foreground mt-2">
        <Link to="/" className="underline underline-offset-4">
          Go to enquiries
        </Link>
      </p>
    </StaffPublicShell>
  )
}

/** The staff console (staff.q3interiors.ie): built with VITE_SURFACE=staff, no customer pages. */
export default function StaffApp() {
  return (
    <Routes>
      <Route path="/" element={<StaffListRoute />} />
      <Route path="/enquiries" element={<StaffListRoute />} />
      <Route path="/enquiries/:id" element={<StaffDetailRoute />} />
      <Route path="/appointments" element={<StaffAppointmentsRoute />} />
      <Route path="/ads" element={<StaffAdsRoute />} />
      <Route path="/ads/:id" element={<StaffAdRoute />} />
      <Route path="/report" element={<StaffReportRoute />} />
      <Route path="/settings" element={<StaffSettingsRoute />} />
      <Route path="/settings/people" element={<StaffPeopleRoute />} />
      <Route path="/settings/checklist" element={<StaffChecklistRoute />} />
      <Route path="/settings/booking" element={<StaffBookingRulesRoute />} />
      <Route path="/settings/campaigns" element={<StaffCampaignsRoute />} />
      <Route path="/settings/wording" element={<StaffWordingRoute />} />
      <Route path="/settings/business" element={<StaffBusinessRoute />} />
      <Route path="/forgot" element={<StaffForgotRoute />} />
      <Route path="/set-password" element={<StaffSetPasswordRoute />} />
      <Route path="/staff/*" element={<Unprefix />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
