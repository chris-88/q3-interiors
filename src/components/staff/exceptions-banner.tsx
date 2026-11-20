import { TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useExceptions } from '@/api/staff-booking'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** Everything that needs a person, at the top of the staff pages. Silent when all is well. */
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
  if (exceptions.data.length === 0) return null
  return (
    <section aria-labelledby="attention-heading" className="mb-6">
      <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
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
