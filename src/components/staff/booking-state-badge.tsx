import { BOOKING_STATE_LABELS, type BookingState } from '@/api/staff-booking'
import { Badge } from '@/components/ui/badge'

const VARIANTS: Record<BookingState, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  reserved: 'secondary',
  calendar_pending: 'secondary',
  confirmed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
}

export function BookingStateBadge({ state }: { state: BookingState }) {
  return <Badge variant={VARIANTS[state]}>{BOOKING_STATE_LABELS[state]}</Badge>
}
