import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  accountErrorMessage,
  newStaffSchema,
  useAccountAction,
  useBookablePerson,
  useCalendarConnections,
  useSetBookablePerson,
  useStaffList,
  type NewStaffInput,
  type StaffRow,
} from '@/api/staff-accounts'
import { toApiError } from '@/api/errors'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { AdminOnly, BackToSettings, SettingsCard } from '@/components/staff/settings-ui'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

function useConnected() {
  const connections = useCalendarConnections()
  return (userId: string) => {
    const row = connections.data?.find((c) => c.staff_user_id === userId)
    return row?.status === 'connected' ? (row.google_email ?? 'connected') : null
  }
}

function WhoTakesBookings({ people }: { people: StaffRow[] }) {
  const bookable = useBookablePerson()
  const save = useSetBookablePerson()
  const connected = useConnected()
  const [picked, setChoice] = useState<string | null>(null)
  const current = bookable.data ?? null
  const choice = picked ?? current
  const active = people.filter((p) => p.active)
  const chosen = active.find((p) => p.user_id === choice)

  return (
    <SettingsCard title="Who takes bookings" id="bookable-heading">
      <p className="text-muted-foreground text-sm">
        New bookings go to this person and their Google Calendar. Appointments already booked stay
        with the person and calendar they were booked with.
      </p>
      {bookable.isPending ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : (
        <fieldset className="mt-3 flex min-w-0 flex-col gap-1">
          <legend className="sr-only">Who takes bookings</legend>
          {active.map((p) => (
            <label
              key={p.user_id}
              className="border-edge has-[:checked]:border-action has-[:checked]:bg-soft flex min-h-12 items-center gap-3 rounded-md border px-3 py-2"
            >
              <input
                type="radio"
                name="bookable"
                className="size-5"
                checked={choice === p.user_id}
                onChange={() => setChoice(p.user_id)}
              />
              <span className="flex min-w-0 flex-col">
                {p.display_name}
                {current === p.user_id ? ' (takes bookings now)' : ''}
                <small className="text-muted-foreground text-sm">
                  {connected(p.user_id)
                    ? 'Google Calendar connected'
                    : 'No Google Calendar connected'}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {chosen && !connected(chosen.user_id) && (
        <Alert className="mt-3">
          <AlertTitle>{chosen.display_name} has not connected a Google Calendar</AlertTitle>
          <AlertDescription>
            Until they connect one (Settings, signed in as them), customers cannot book online and
            are offered a call back instead.
          </AlertDescription>
        </Alert>
      )}
      {save.isError && (
        <Alert variant="destructive" role="alert" className="mt-3">
          <AlertDescription>That did not save. Please try again.</AlertDescription>
        </Alert>
      )}
      {save.isSuccess && choice === current && (
        <output className="mt-3 block text-sm">
          Saved. New bookings go to {chosen?.display_name}.
        </output>
      )}
      <Button
        className="mt-3 h-12 px-6"
        disabled={!choice || choice === current || save.isPending}
        onClick={() => choice && save.mutate(choice)}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
    </SettingsCard>
  )
}

function PersonRow({
  person,
  isMe,
  takesBookings,
}: {
  person: StaffRow
  isMe: boolean
  takesBookings: boolean
}) {
  const action = useAccountAction()
  const [confirmOff, setConfirmOff] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const connected = useConnected()
  const run = (input: Parameters<typeof action.mutate>[0], done: string) =>
    action.mutate(input, {
      onSuccess: () => {
        setNotice(done)
        setConfirmOff(false)
      },
    })

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{person.display_name}</span>
        <Badge variant={person.role === 'admin' ? 'default' : 'secondary'}>
          {person.role === 'admin' ? 'Admin' : 'Staff'}
        </Badge>
        {!person.active && <Badge variant="outline">Switched off</Badge>}
        {takesBookings && <Badge variant="outline">Takes bookings</Badge>}
        {isMe && <span className="text-muted-foreground text-sm">(you)</span>}
      </div>
      <span className="text-muted-foreground text-sm break-all">{person.email}</span>
      <span className="text-muted-foreground text-sm">
        {connected(person.user_id) ? 'Google Calendar connected' : 'No Google Calendar connected'}
      </span>
      {notice && <output className="block text-sm">{notice}</output>}
      {action.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{accountErrorMessage(action.error)}</AlertDescription>
        </Alert>
      )}
      {confirmOff ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm">
            Switch off {person.display_name}? They will be signed out and cannot sign in or see
            anything until switched back on. Their appointments and history stay.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              className="h-12"
              disabled={action.isPending}
              onClick={() =>
                run(
                  { action: 'set_active', userId: person.user_id, active: false },
                  `${person.display_name} is switched off.`,
                )
              }
            >
              Yes, switch off
            </Button>
            <Button variant="outline" className="h-12" onClick={() => setConfirmOff(false)}>
              Keep them on
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {person.active ? (
            <>
              <Button
                variant="outline"
                className="h-12"
                disabled={action.isPending}
                onClick={() =>
                  run(
                    { action: 'send_reset', userId: person.user_id },
                    `Password link sent to ${person.display_name}.`,
                  )
                }
              >
                Send password link
              </Button>
              {!isMe && (
                <Button
                  variant="outline"
                  className="h-12"
                  disabled={action.isPending}
                  onClick={() =>
                    run(
                      {
                        action: 'set_role',
                        userId: person.user_id,
                        role: person.role === 'admin' ? 'staff' : 'admin',
                      },
                      person.role === 'admin'
                        ? `${person.display_name} is now staff.`
                        : `${person.display_name} is now an admin.`,
                    )
                  }
                >
                  {person.role === 'admin' ? 'Make staff' : 'Make admin'}
                </Button>
              )}
              {!isMe && (
                <Button
                  variant="ghost"
                  className="text-destructive h-12"
                  onClick={() => setConfirmOff(true)}
                >
                  Switch off…
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="outline"
              className="h-12"
              disabled={action.isPending}
              onClick={() =>
                run(
                  { action: 'set_active', userId: person.user_id, active: true },
                  `${person.display_name} is switched on again.`,
                )
              }
            >
              Switch back on
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function AddPerson() {
  const action = useAccountAction()
  const [added, setAdded] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewStaffInput>({
    resolver: zodResolver(newStaffSchema),
    defaultValues: { role: 'staff' },
  })
  return (
    <SettingsCard title="Add a person" id="add-heading">
      <form
        noValidate
        onSubmit={handleSubmit((v) =>
          action.mutate(
            { action: 'add', ...v },
            {
              onSuccess: () => {
                setAdded(v.name)
                reset({ name: '', email: '', role: 'staff' })
              },
            },
          ),
        )}
      >
        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="new-name">Name</FieldLabel>
            <Input
              id="new-name"
              autoComplete="off"
              className="h-12 text-base"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'new-name-error' : undefined}
              {...register('name')}
            />
            {errors.name && <FieldError id="new-name-error">{errors.name.message}</FieldError>}
          </Field>
          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="new-email">Email</FieldLabel>
            <Input
              id="new-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              className="h-12 text-base"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={`new-email-hint${errors.email ? ' new-email-error' : ''}`}
              {...register('email')}
            />
            <FieldDescription id="new-email-hint">
              We email them a link to choose their own password.
            </FieldDescription>
            {errors.email && <FieldError id="new-email-error">{errors.email.message}</FieldError>}
          </Field>
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">What can they do?</legend>
            <label className="border-edge has-[:checked]:border-action has-[:checked]:bg-soft flex min-h-12 items-start gap-3 rounded-md border px-3 py-2">
              <input type="radio" value="staff" className="mt-1 size-5" {...register('role')} />
              <span>
                <span className="font-medium">Staff</span>
                <span className="text-muted-foreground block text-sm">
                  Enquiries, appointments and outcomes, and their own calendar and hours.
                </span>
              </span>
            </label>
            <label className="border-edge has-[:checked]:border-action has-[:checked]:bg-soft flex min-h-12 items-start gap-3 rounded-md border px-3 py-2">
              <input type="radio" value="admin" className="mt-1 size-5" {...register('role')} />
              <span>
                <span className="font-medium">Admin</span>
                <span className="text-muted-foreground block text-sm">
                  Everything staff can do, plus people, business details, wording, campaigns and
                  settings.
                </span>
              </span>
            </label>
          </fieldset>
          {action.isError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{accountErrorMessage(action.error)}</AlertDescription>
            </Alert>
          )}
          {added && action.isSuccess && (
            <output className="block text-sm">
              Added {added}. We have emailed them a link to choose a password.
            </output>
          )}
          <Button
            type="submit"
            size="lg"
            className="h-12 px-6 text-base"
            disabled={action.isPending}
          >
            {action.isPending ? 'Adding…' : 'Add and send the email'}
          </Button>
        </FieldGroup>
      </form>
    </SettingsCard>
  )
}

export function PeoplePage() {
  const me = useCurrentStaff()
  const people = useStaffList()
  const bookable = useBookablePerson()
  return (
    <AdminOnly>
      <div className="flex flex-col gap-4">
        <BackToSettings />
        <h1 className="text-section text-ink font-medium">People</h1>
        {people.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : people.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              Could not load the team. {toApiError(people.error).message ? 'Please try again.' : ''}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <WhoTakesBookings people={people.data} />
            <SettingsCard title="The team" id="team-heading">
              <ul className="flex flex-col gap-2">
                {people.data.map((p) => (
                  <PersonRow
                    key={p.user_id}
                    person={p}
                    isMe={p.user_id === me.user_id}
                    takesBookings={bookable.data === p.user_id}
                  />
                ))}
              </ul>
            </SettingsCard>
            <AddPerson />
          </>
        )}
      </div>
    </AdminOnly>
  )
}
