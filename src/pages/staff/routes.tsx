import { StaffArea } from '@/components/staff/staff-layout'
import { EnquiryDetailPage } from './enquiry-detail-page'
import { EnquiryTaskPage } from './enquiry-task-page'
import { EnquiryListPage } from './enquiry-list-page'
import { AppointmentsPage } from './appointments-page'
import { ReportPage } from './report-page'
import { SettingsPage } from './settings-page'
import { PeoplePage } from './people-page'
import { AdPage, AdsPage } from './ads-pages'
import { ChecklistPage } from './checklist-page'
import { BookingRulesPage } from './booking-rules-page'
import { CampaignsPage } from './campaigns-page'
import { WordingPage } from './wording-page'
import { BusinessPage } from './business-page'
// oxlint-disable-next-line react/only-export-components
export {
  ForgotPasswordPage as StaffForgotRoute,
  SetPasswordPage as StaffSetPasswordRoute,
} from './account-pages'

// Loaded lazily from App so customers never download the staff workspace.

export function StaffListRoute() {
  return (
    <StaffArea>
      <EnquiryListPage />
    </StaffArea>
  )
}

export function StaffDetailRoute() {
  return (
    <StaffArea>
      <EnquiryDetailPage />
    </StaffArea>
  )
}

export function StaffTaskRoute() {
  return (
    <StaffArea>
      <EnquiryTaskPage />
    </StaffArea>
  )
}

export function StaffAppointmentsRoute() {
  return (
    <StaffArea>
      <AppointmentsPage />
    </StaffArea>
  )
}

export function StaffSettingsRoute() {
  return (
    <StaffArea>
      <SettingsPage />
    </StaffArea>
  )
}

export function StaffReportRoute() {
  return (
    <StaffArea>
      <ReportPage />
    </StaffArea>
  )
}

export function StaffPeopleRoute() {
  return (
    <StaffArea>
      <PeoplePage />
    </StaffArea>
  )
}

export function StaffBusinessRoute() {
  return (
    <StaffArea>
      <BusinessPage />
    </StaffArea>
  )
}

export function StaffWordingRoute() {
  return (
    <StaffArea>
      <WordingPage />
    </StaffArea>
  )
}

export function StaffCampaignsRoute() {
  return (
    <StaffArea>
      <CampaignsPage />
    </StaffArea>
  )
}

export function StaffBookingRulesRoute() {
  return (
    <StaffArea>
      <BookingRulesPage />
    </StaffArea>
  )
}

export function StaffChecklistRoute() {
  return (
    <StaffArea>
      <ChecklistPage />
    </StaffArea>
  )
}

export function StaffAdsRoute() {
  return (
    <StaffArea>
      <AdsPage />
    </StaffArea>
  )
}

export function StaffAdRoute() {
  return (
    <StaffArea>
      <AdPage />
    </StaffArea>
  )
}
