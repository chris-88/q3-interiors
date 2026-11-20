import { createContext, useContext, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, NavLink } from 'react-router'
import {
  signInSchema,
  useSession,
  useSignIn,
  useSignOut,
  useStaffMember,
  type SignInInput,
  type StaffMember,
} from '@/api/auth'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const StaffContext = createContext<StaffMember | null>(null)

/** The signed-in staff member. Only valid inside <StaffArea>. */
// oxlint-disable-next-line react/only-export-components
export function useCurrentStaff(): StaffMember {
  const staff = useContext(StaffContext)
  if (!staff) throw new Error('useCurrentStaff outside StaffArea')
  return staff
}

function Shell({ children, staff }: { children: ReactNode; staff?: StaffMember }) {
  const signOut = useSignOut()
  return (
    <div className="bg-muted/40 text-foreground min-h-svh">
      <header className="bg-background border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link
            to="/staff"
            className="focus-visible:ring-ring/50 text-sm font-semibold tracking-tight focus-visible:rounded-sm focus-visible:ring-3 focus-visible:outline-none"
          >
            Q3 Interiors <span className="text-muted-foreground font-normal">Staff</span>
          </Link>
          {staff && (
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground hidden text-sm sm:inline">
                {staff.display_name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => signOut.mutate()}
                disabled={signOut.isPending}
              >
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      {staff && (
        <nav aria-label="Staff" className="bg-background border-b">
          <ul className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2">
            {[
              ['/staff', 'Enquiries'],
              ['/staff/appointments', 'Appointments'],
              ['/staff/settings', 'Settings'],
            ].map(([to, label]) => (
              <li key={to}>
                <NavLink
                  to={to ?? '/staff'}
                  end
                  className={({ isActive }) =>
                    `focus-visible:ring-ring/50 inline-flex h-11 items-center border-b-2 px-3 text-sm focus-visible:ring-3 focus-visible:outline-none ${
                      isActive
                        ? 'border-foreground text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground border-transparent'
                    }`
                  }
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  )
}

function SignInForm() {
  const signIn = useSignIn()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) })

  return (
    <div className="bg-background mx-auto max-w-sm rounded-xl border p-6">
      <h1 className="text-xl font-semibold tracking-tight">Staff sign in</h1>
      <form noValidate className="mt-6" onSubmit={handleSubmit((values) => signIn.mutate(values))}>
        <FieldGroup>
          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              className="h-11 text-base"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email && <FieldError id="email-error">{errors.email.message}</FieldError>}
          </Field>
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              className="h-11 text-base"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            {errors.password && (
              <FieldError id="password-error">{errors.password.message}</FieldError>
            )}
          </Field>
          {signIn.isError && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Could not sign in</AlertTitle>
              <AlertDescription>
                {signIn.error.message === 'Invalid login credentials'
                  ? 'That email and password do not match.'
                  : 'Something went wrong. Try again in a moment.'}
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="lg" className="h-11 text-base" disabled={signIn.isPending}>
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </FieldGroup>
      </form>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

/**
 * Staff-only area. Shows sign-in to visitors, a refusal to signed-in users who are not on the
 * staff allowlist, and the page to staff. RLS enforces the same rule on the server.
 */
export function StaffArea({ children }: { children: ReactNode }) {
  const session = useSession()
  const userId = session.status === 'ready' ? session.session?.user.id : undefined
  const staff = useStaffMember(userId)
  const signOut = useSignOut()

  if (session.status === 'loading') {
    return (
      <Shell>
        <Loading />
      </Shell>
    )
  }
  if (!session.session) {
    return (
      <Shell>
        <SignInForm />
      </Shell>
    )
  }
  if (staff.isPending) {
    return (
      <Shell>
        <Loading />
      </Shell>
    )
  }
  if (staff.isError) {
    return (
      <Shell>
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not check your access</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void staff.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </Shell>
    )
  }
  if (!staff.data) {
    return (
      <Shell>
        <div className="bg-background mx-auto max-w-sm rounded-xl border p-6">
          <h1 className="text-xl font-semibold tracking-tight">No staff access</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            You are signed in, but this account is not set up as Q3 Interiors staff.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        </div>
      </Shell>
    )
  }
  return (
    <StaffContext.Provider value={staff.data}>
      <Shell staff={staff.data}>{children}</Shell>
    </StaffContext.Provider>
  )
}
