import { BOOKING_STATE_LABELS, type BookingState } from '@/api/staff-booking'
import { Badge } from '@/components/ui/badge'
import type { Open } from '@/lib/tolerant'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive'

const VARIANTS: Record<BookingState, Variant> = {
  reserved: 'secondary',
  calendar_pending: 'secondary',
  confirmed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
}

/** A state added by a newer release shows as its raw value in an outline badge. */
export function BookingStateBadge({ state }: { state: Open<BookingState> }) {
  return (
    <Badge variant={(VARIANTS as Record<string, Variant>)[state] ?? 'outline'}>
      {(BOOKING_STATE_LABELS as Record<string, string>)[state] ?? state}
    </Badge>
  )
}
