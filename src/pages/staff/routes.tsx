import { StaffArea } from '@/components/staff/staff-layout'
import { EnquiryDetailPage } from './enquiry-detail-page'
import { EnquiryListPage } from './enquiry-list-page'
import { AppointmentsPage } from './appointments-page'
import { SettingsPage } from './settings-page'

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
