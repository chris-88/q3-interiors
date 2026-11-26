import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

export type Place = {
  position: number
  total: number
  previous: string | null
  next: string | null
}

const step =
  'inline-flex min-h-12 items-center gap-1 px-2 text-sm underline-offset-4 hover:underline'

/** Previous / "3 of 12" / Next through the list the person came from. */
export function ListWalk({
  label,
  place,
  to,
}: {
  label: string
  place: Place
  to: (id: string) => string
}) {
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-2">
      {place.previous ? (
        <Link to={to(place.previous)} className={step}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          Previous
        </Link>
      ) : (
        <span className={`${step} text-muted-foreground`} aria-hidden="true">
          <ChevronLeft className="size-4" />
          Previous
        </span>
      )}
      <span className="text-muted-foreground text-sm">
        {place.position} of {place.total}
      </span>
      {place.next ? (
        <Link to={to(place.next)} className={step}>
          Next
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <span className={`${step} text-muted-foreground`} aria-hidden="true">
          Next
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  )
}
