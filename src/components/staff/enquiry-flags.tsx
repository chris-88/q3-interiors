import { ImagePlus, PhoneCall } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/**
 * What a form v2 enquiry asked for (a call or a site visit) and whether the customer asked us to
 * contact them instead of booking. v1 enquiries have no preference; the badge is left out.
 */
export function preferenceLabel(answers: Record<string, unknown>): string | null {
  const value = answers.appointment_preference
  if (value === 'phone') return 'Wants a call'
  if (value === 'on_site') return 'Wants a site visit'
  return null
}

export function EnquiryFlags({
  answers,
  contactRequestedAt,
  addedAfterBookingAt = null,
}: {
  answers: Record<string, unknown>
  contactRequestedAt: string | null
  /** The customer added photos, notes or answers after booking ("Help us prepare"). */
  addedAfterBookingAt?: string | null
}) {
  const preference = preferenceLabel(answers)
  if (!preference && !contactRequestedAt && !addedAfterBookingAt) return null
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {preference && <Badge variant="outline">{preference}</Badge>}
      {contactRequestedAt && (
        <Badge variant="destructive">
          <PhoneCall data-icon="inline-start" aria-hidden="true" />
          Contact request
        </Badge>
      )}
      {addedAfterBookingAt && (
        <Badge variant="secondary">
          <ImagePlus data-icon="inline-start" aria-hidden="true" />
          Added after booking
        </Badge>
      )}
    </span>
  )
}
