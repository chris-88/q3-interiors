import { statusLabel, type EnquiryStatus } from '@/api/enquiries'
import type { Open } from '@/lib/tolerant'
import { Badge } from '@/components/ui/badge'

const VARIANTS: Record<EnquiryStatus, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  in_review: 'secondary',
  contacted: 'outline',
  unsuitable: 'outline',
}

export function StatusBadge({ status }: { status: Open<EnquiryStatus> }) {
  return (
    <Badge
      variant={
        (VARIANTS as Record<string, 'default' | 'secondary' | 'outline'>)[status] ?? 'outline'
      }
      className={status === 'unsuitable' ? 'text-muted-foreground' : ''}
    >
      {statusLabel(status)}
    </Badge>
  )
}
