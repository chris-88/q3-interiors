import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router'
import { useCurrentStaff } from '@/components/staff/staff-layout'

export function SettingsCard({
  title,
  children,
  id,
}: {
  title: string
  children: ReactNode
  id: string
}) {
  return (
    <section aria-labelledby={id} className="bg-background rounded-md border p-4">
      <h2 id={id} className="text-base font-medium">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function BackToSettings() {
  return (
    <Link
      to="/settings"
      className="text-primary inline-flex min-h-12 items-center gap-1 text-sm underline"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Settings
    </Link>
  )
}

/** Admin screens. The database refuses the same changes from staff; this only explains it. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const me = useCurrentStaff()
  if (me.role !== 'admin') {
    return (
      <div className="flex flex-col gap-4">
        <BackToSettings />
        <div className="bg-background rounded-md border p-6">
          <h1 className="text-title text-ink font-medium">Admins only</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Only an admin can see and change this. Ask an admin if something here needs changing.
          </p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
