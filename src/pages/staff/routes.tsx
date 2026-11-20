import { StaffArea } from '@/components/staff/staff-layout'
import { EnquiryDetailPage } from './enquiry-detail-page'
import { EnquiryListPage } from './enquiry-list-page'

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
