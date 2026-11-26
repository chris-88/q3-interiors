import { TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useExceptions } from '@/api/staff-booking'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const warn = 'border-amber-300 bg-amber-50 text-amber-950'

/**
 * System problems that need a person (calendar, failed bookings or emails), at the top of the
 * staff pages. Silent when all is well; one compact line when there is one.
 */
export function ExceptionsBanner() {
  const staff = useCurrentStaff()
  const exceptions = useExceptions(staff.user_id)
  if (exceptions.isPending) return null
  if (exceptions.isError) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertDescription>Could not check for problems that need attention.</AlertDescription>
      </Alert>
    )
  }
  const [only, ...rest] = exceptions.data
  if (!only) return null
  if (rest.length === 0) {
    return (
      <section aria-label="Needs attention" className="mb-4">
        <Link
          to={only.link}
          className={`${warn} flex min-h-12 items-center gap-2 rounded-md border px-3 py-2 text-sm`}
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">Needs attention:</span>{' '}
            <span className="underline underline-offset-4">{only.text}</span>
          </span>
        </Link>
      </section>
    )
  }
  return (
    <section aria-labelledby="attention-heading" className="mb-4">
      <Alert className={warn}>
        <TriangleAlert aria-hidden="true" />
        <AlertTitle id="attention-heading">Needs attention ({exceptions.data.length})</AlertTitle>
        <AlertDescription className="text-current">
          <ul className="mt-1 flex flex-col gap-2">
            {exceptions.data.map((item) => (
              <li key={item.id}>
                <Link to={item.link} className="underline underline-offset-4">
                  {item.text}
                </Link>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    </section>
  )
}
