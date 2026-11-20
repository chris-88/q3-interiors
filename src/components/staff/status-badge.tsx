import { STATUS_LABELS, type EnquiryStatus } from '@/api/enquiries'
import { Badge } from '@/components/ui/badge'

const VARIANTS: Record<EnquiryStatus, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  in_review: 'secondary',
  contacted: 'outline',
  unsuitable: 'outline',
}

export function StatusBadge({ status }: { status: EnquiryStatus }) {
  return (
    <Badge
      variant={VARIANTS[status]}
      className={status === 'unsuitable' ? 'text-muted-foreground' : ''}
    >
      {STATUS_LABELS[status]}
    </Badge>
  )
}
