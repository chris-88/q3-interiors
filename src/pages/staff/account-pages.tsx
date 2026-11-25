import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useSearchParams } from 'react-router'
import { z } from 'zod'
import {
  PASSWORD_MIN,
  accountErrorMessage,
  passwordSchema,
  useForgotPassword,
  useSetPassword,
  type PasswordInput,
} from '@/api/staff-accounts'
import { StaffPublicShell } from '@/components/staff/staff-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background mx-auto max-w-sm rounded-md border p-6">
      <h1 className="text-title text-ink font-medium">{title}</h1>
      <div className="mt-4">{children}</div>
    </div>
  )
}

const forgotSchema = z.object({
  email: z.string().trim().pipe(z.email('Enter your email address.')),
})

export function ForgotPasswordPage() {
  const forgot = useForgotPassword()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema) })

  return (
    <StaffPublicShell>
      <Panel title="Forgot your password?">
        {forgot.isSuccess ? (
          <div aria-live="polite">
            <p>
              If that address belongs to a staff account, we have emailed it a link to choose a new
              password. The link works once, within 24 hours.
            </p>
            <p className="text-muted-foreground mt-3 text-sm">
              Nothing arrived after a few minutes? Check your spam folder, or ask an admin to send a
              new link.
            </p>
            <Link
              to="/staff"
              className="text-primary mt-4 inline-flex min-h-12 items-center underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit((v) => forgot.mutate(v.email))}>
            <FieldGroup>
              <p className="text-muted-foreground text-sm">
                Enter the email address you sign in with. We will send you a link to choose a new
                password.
              </p>
              <Field data-invalid={errors.email ? true : undefined}>
                <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  className="h-12 text-base"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? 'forgot-email-error' : undefined}
                  {...register('email')}
                />
                {errors.email && (
                  <FieldError id="forgot-email-error">{errors.email.message}</FieldError>
                )}
              </Field>
              {forgot.isError && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{accountErrorMessage(forgot.error)}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                size="lg"
                className="h-12 text-base"
                disabled={forgot.isPending}
              >
                {forgot.isPending ? 'Sending…' : 'Send me a link'}
              </Button>
              <Link
                to="/staff"
                className="text-primary inline-flex min-h-12 items-center underline"
              >
                Back to sign in
              </Link>
            </FieldGroup>
          </form>
        )}
      </Panel>
    </StaffPublicShell>
  )
}

// A link is verified once per page load (React StrictMode runs effects twice in development).
const verified = new Map<string, Promise<boolean>>()

function verifyOnce(tokenHash: string): Promise<boolean> {
  let pending = verified.get(tokenHash)
  if (!pending) {
    pending = supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      .then(({ error }) => !error)
      .catch(() => false)
    verified.set(tokenHash, pending)
  }
  return pending
}

export function SetPasswordPage() {
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  const welcome = params.get('welcome') === '1'
  const [state, setState] = useState<'verifying' | 'ready' | 'invalid'>(
    tokenHash ? 'verifying' : 'invalid',
  )
  const setPassword = useSetPassword()
  const [show, setShow] = useState(false)
  const headingRef = useRef<HTMLDivElement>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PasswordInput>({ resolver: zodResolver(passwordSchema) })

  useEffect(() => {
    if (!tokenHash) return
    let live = true
    void verifyOnce(tokenHash).then((ok) => {
      // Take the single-use token out of the address bar and history either way.
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}#/staff/set-password${welcome ? '?welcome=1' : ''}`,
      )
      if (live) setState(ok ? 'ready' : 'invalid')
    })
    return () => {
      live = false
    }
  }, [tokenHash, welcome])

  useEffect(() => {
    if (setPassword.isSuccess) headingRef.current?.focus()
  }, [setPassword.isSuccess])

  const title = welcome ? 'Choose your password' : 'Choose a new password'

  if (state === 'verifying') {
    return (
      <StaffPublicShell>
        <Panel title={title}>
          <output className="block">Checking your link…</output>
        </Panel>
      </StaffPublicShell>
    )
  }
  if (state === 'invalid') {
    return (
      <StaffPublicShell>
        <Panel title="This link no longer works">
          <p>
            Links work once, within 24 hours. You can ask for a new one: enter your email address
            and we will send it straight away.
          </p>
          <Link
            to="/staff/forgot"
            className="bg-primary text-primary-foreground mt-4 inline-flex h-12 items-center rounded-md px-6 font-medium"
          >
            Send me a new link
          </Link>
        </Panel>
      </StaffPublicShell>
    )
  }
  if (setPassword.isSuccess) {
    return (
      <StaffPublicShell>
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          <Panel title="Password saved">
            <output className="block">
              You are signed in. Use this password next time you sign in.
            </output>
            <Link
              to="/staff"
              className="bg-primary text-primary-foreground mt-4 inline-flex h-12 items-center rounded-md px-6 font-medium"
            >
              Go to enquiries
            </Link>
          </Panel>
        </div>
      </StaffPublicShell>
    )
  }
  return (
    <StaffPublicShell>
      <Panel title={title}>
        <form noValidate onSubmit={handleSubmit((v) => setPassword.mutate(v.password))}>
          <FieldGroup>
            <Field data-invalid={errors.password ? true : undefined}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input
                id="new-password"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                className="h-12 text-base"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={`new-password-hint${errors.password ? ' new-password-error' : ''}`}
                {...register('password')}
              />
              <FieldDescription id="new-password-hint">
                At least {PASSWORD_MIN} characters. A few words in a row is easy to remember.
              </FieldDescription>
              {errors.password && (
                <FieldError id="new-password-error">{errors.password.message}</FieldError>
              )}
            </Field>
            <Field data-invalid={errors.confirm ? true : undefined}>
              <FieldLabel htmlFor="confirm-password">Type it again</FieldLabel>
              <Input
                id="confirm-password"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                className="h-12 text-base"
                aria-invalid={errors.confirm ? true : undefined}
                aria-describedby={errors.confirm ? 'confirm-password-error' : undefined}
                {...register('confirm')}
              />
              {errors.confirm && (
                <FieldError id="confirm-password-error">{errors.confirm.message}</FieldError>
              )}
            </Field>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="checkbox"
                className="size-5"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
              />
              Show the password
            </label>
            {setPassword.isError && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Not saved</AlertTitle>
                <AlertDescription>{accountErrorMessage(setPassword.error)}</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              size="lg"
              className="h-12 text-base"
              disabled={setPassword.isPending}
            >
              {setPassword.isPending ? 'Saving…' : 'Save password'}
            </Button>
          </FieldGroup>
        </form>
      </Panel>
    </StaffPublicShell>
  )
}
