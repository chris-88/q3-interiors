import { Badge } from '@/components/ui/badge'
import { NEEDS_ACTION, type Stage } from '@/lib/enquiry-stage'

/** The one stage an enquiry is at: filled when someone has to act, outlined otherwise. */
export function StageBadge({ stage }: { stage: Stage }) {
  const action = NEEDS_ACTION.has(stage.key)
  const quiet = stage.key === 'lost' || stage.key === 'closed'
  return (
    <Badge
      variant={action ? 'default' : 'outline'}
      className={`shrink-0 ${quiet ? 'text-muted-foreground' : ''}`}
    >
      {stage.label}
    </Badge>
  )
}
