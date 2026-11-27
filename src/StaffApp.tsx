import { useEffect, useRef } from 'react'
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
  StaffTaskRoute,
  StaffWordingRoute,
} from '@/pages/staff/routes'
import { useQueryClient } from '@tanstack/react-query'
import { DataShapeError, skippedSnapshot, subscribeSkipped } from '@/lib/tolerant'
import { unprefixedStaffPath } from './staff-redirect'
import { startStaffPwa } from './staff-pwa'
import {
  checkForNewerBuild,
  noteNavigation,
  noteSaved,
  onUnreadableData,
  startVersionWatch,
} from './staff-version'

// Service worker, update notice, install prompt (staff build only).
startStaffPwa()

/**
 * Watches for a newer build and for data this build cannot read (see staff-version.ts and
 * lib/tolerant.ts): a query that fails to parse, or a list with rows left out, checks for a
 * newer build first.
 */
function StaffWatch() {
  const queryClient = useQueryClient()
  const { pathname } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    noteNavigation()
  }, [pathname])
  useEffect(() => {
    startVersionWatch(() => queryClient.isMutating())
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        event.action.error instanceof DataShapeError
      )
        void onUnreadableData(event.action.error.where)
    })
    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') noteSaved()
    })
    const offSkipped = subscribeSkipped(() => {
      if (skippedSnapshot().length > 0) void checkForNewerBuild()
    })
    return () => {
      offQueries()
      offMutations()
      offSkipped()
    }
  }, [queryClient])
  return null
}

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
    <>
      <StaffWatch />
      <Routes>
        <Route path="/" element={<StaffListRoute />} />
        <Route path="/enquiries" element={<StaffListRoute />} />
        <Route path="/enquiries/:id" element={<StaffDetailRoute />} />
        <Route path="/enquiries/:id/:task" element={<StaffTaskRoute />} />
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
    </>
  )
}
