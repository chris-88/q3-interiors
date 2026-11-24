import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ApiError } from '@/api/errors'
import {
  WEEKDAYS,
  useAppointmentTypes,
  useCalendarAction,
  useCalendarConnection,
  useStaffAvailability,
  useUpdateAppointmentType,
  useUpdateAvailability,
  type AppointmentTypeSettings,
  type BookingSettings,
  useBookingSettings,
  useUpdateBookingSettings,
  useRetentionPreview,
  type StaffAvailability,
} from '@/api/staff-booking'
import { useBookablePerson } from '@/api/staff-accounts'
import { ExceptionsBanner } from '@/components/staff/exceptions-banner'
import { useCurrentStaff } from '@/components/staff/staff-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'

function Card({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="bg-background rounded-xl border p-4">
      <h2 id={id} className="text-base font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

const CALLBACK_MESSAGES: Record<string, string> = {
  denied: 'Google sign-in was cancelled.',
  scopes:
    'Both calendar permissions are needed (see your availability, and create events). Connect again and leave both ticked.',
  expired: 'The connection attempt expired. Please try again.',
  no_refresh_token: 'Google did not grant offline access. Please try again.',
  not_configured: 'Google sign-in is not set up on the server yet.',
}

function CalendarCard() {
  const staff = useCurrentStaff()
  const connection = useCalendarConnection(staff.user_id)
  const action = useCalendarAction(staff.user_id)
  const [params, setParams] = useSearchParams()
  const callback = params.get('calendar')
  const reason = params.get('reason') ?? ''

  const connect = () =>
    action.mutate('start', {
      onSuccess: (result) => {
        if (result.url) window.location.assign(result.url)
      },
    })

  return (
    <Card title="Google Calendar" id="calendar-heading">
      {callback === 'connected' && (
        <Alert className="mb-3">
          <AlertDescription>Google Calendar connected.</AlertDescription>
        </Alert>
      )}
      {callback === 'error' && (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>Not connected</AlertTitle>
          <AlertDescription>
            {CALLBACK_MESSAGES[reason] ??
              'Something went wrong while connecting. Please try again.'}
          </AlertDescription>
        </Alert>
      )}
      {connection.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : connection.isError ? (
        <Alert variant="destructive">
          <AlertDescription>Could not load the calendar connection.</AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {connection.data?.status === 'connected' ? (
              <Badge>Connected</Badge>
            ) : (
              <Badge variant="destructive">
                {connection.data ? 'Disconnected' : 'Not connected'}
              </Badge>
            )}
            {connection.data?.google_email && (
              <span className="text-muted-foreground text-sm">{connection.data.google_email}</span>
            )}
          </div>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {connection.data?.connected_at && (
              <div>
                <dt className="text-muted-foreground">Connected</dt>
                <dd>{formatDateTime(connection.data.connected_at)}</dd>
              </div>
            )}
            {connection.data?.last_success_at && (
              <div>
                <dt className="text-muted-foreground">Last event created</dt>
                <dd>{formatDateTime(connection.data.last_success_at)}</dd>
              </div>
            )}
            {connection.data?.last_error && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">
                  Last problem
                  {connection.data.last_error_at
                    ? ` (${formatDateTime(connection.data.last_error_at)})`
                    : ''}
                </dt>
                <dd className="break-words">{connection.data.last_error}</dd>
              </div>
            )}
          </dl>
          <p className="text-muted-foreground text-sm">
            Bookings check this calendar for busy times and add each appointment to it. Customers
            are never invited from Google; they get our own confirmation email.
          </p>
          {action.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {action.error instanceof ApiError && action.error.code === 'not_configured'
                  ? 'Google sign-in is not set up on the server yet (missing OAuth client).'
                  : action.error.message}
              </AlertDescription>
            </Alert>
          )}
          {action.isSuccess && action.variables === 'test' && (
            <Alert>
              <AlertDescription>
                {action.data.status === 'ok'
                  ? 'The calendar answered normally.'
                  : 'The calendar is not connected.'}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-10" onClick={connect} disabled={action.isPending}>
              {connection.data?.status === 'connected' ? 'Reconnect' : 'Connect Google Calendar'}
            </Button>
            {connection.data?.status === 'connected' && (
              <>
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() => action.mutate('test')}
                  disabled={action.isPending}
                >
                  Test connection
                </Button>
                <Button
                  variant="ghost"
                  className="h-10"
                  disabled={action.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Disconnect Google Calendar? Customers will not be able to book until it is reconnected.',
                      )
                    ) {
                      action.mutate('disconnect')
                    }
                  }}
                >
                  Disconnect
                </Button>
              </>
            )}
          </div>
          {callback && (
            <button
              type="button"
              className="text-muted-foreground self-start text-xs underline underline-offset-4"
              onClick={() => setParams({})}
            >
              Dismiss message
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  id: string
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  hint?: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className="h-10 text-base"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
    </Field>
  )
}

function AvailabilityForm({ initial }: { initial: StaffAvailability }) {
  const [value, setValue] = useState(initial)
  const update = useUpdateAvailability()
  const hours = (day: string) => value.working_hours[day]?.[0] ?? null
  const setHours = (day: string, next: [string, string] | null) =>
    setValue((v) => {
      const working_hours = { ...v.working_hours }
      if (next) working_hours[day] = [next]
      else delete working_hours[day]
      return { ...v, working_hours }
    })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(value)
      }}
      className="flex flex-col gap-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Working hours (Irish time)</legend>
        {WEEKDAYS.map(([day, name]) => {
          const h = hours(day)
          return (
            <div key={day} className="grid grid-cols-[4.5rem_1fr_auto_1fr] items-center gap-2">
              <label className="flex items-center gap-2 text-sm" htmlFor={`day-${day}`}>
                <Checkbox
                  id={`day-${day}`}
                  checked={h !== null}
                  onCheckedChange={(checked) => setHours(day, checked ? ['09:00', '17:00'] : null)}
                />
                <span aria-hidden="true">{name.slice(0, 3)}</span>
                <span className="sr-only">{name}</span>
              </label>
              {h && (
                <>
                  <Input
                    type="time"
                    aria-label={`${name} start`}
                    value={h[0]}
                    onChange={(e) => setHours(day, [e.target.value, h[1]])}
                    className="h-10 min-w-0 px-2 text-base tabular-nums [&::-webkit-calendar-picker-indicator]:ml-1 [&::-webkit-calendar-picker-indicator]:w-3.5"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    type="time"
                    aria-label={`${name} end`}
                    value={h[1]}
                    onChange={(e) => setHours(day, [h[0], e.target.value])}
                    className="h-10 min-w-0 px-2 text-base tabular-nums [&::-webkit-calendar-picker-indicator]:ml-1 [&::-webkit-calendar-picker-indicator]:w-3.5"
                  />
                </>
              )}
            </div>
          )
        })}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id="notice"
          label="Minimum notice (hours)"
          value={Math.round(value.min_notice_minutes / 60)}
          onChange={(n) => setValue((v) => ({ ...v, min_notice_minutes: n * 60 }))}
          min={0}
          max={336}
        />
        <NumberField
          id="horizon"
          label="Book up to (days ahead)"
          value={value.horizon_days}
          onChange={(n) => setValue((v) => ({ ...v, horizon_days: n }))}
          min={1}
          max={120}
        />
        <NumberField
          id="limit"
          label="Visits per day"
          value={value.daily_visit_limit}
          onChange={(n) => setValue((v) => ({ ...v, daily_visit_limit: n }))}
          min={0}
          max={20}
          hint="On-site visits only"
        />
      </div>
      {update.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Not saved. Check the values (times as HH:MM, end after start).
          </AlertDescription>
        </Alert>
      )}
      {update.isSuccess && (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Saved.
        </p>
      )}
      <Button type="submit" className="h-10 self-start px-4" disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Save availability'}
      </Button>
    </form>
  )
}

function TypeForm({ initial }: { initial: AppointmentTypeSettings }) {
  const [value, setValue] = useState(initial)
  const update = useUpdateAppointmentType()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(value)
      }}
      className="flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{value.label}</h3>
        <label className="flex items-center gap-2 text-sm" htmlFor={`active-${value.id}`}>
          <Checkbox
            id={`active-${value.id}`}
            checked={value.active}
            onCheckedChange={(checked) => setValue((v) => ({ ...v, active: checked }))}
          />
          Offered
        </label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <NumberField
          id={`duration-${value.id}`}
          label="Minutes"
          value={value.duration_minutes}
          onChange={(n) => setValue((v) => ({ ...v, duration_minutes: n }))}
          min={5}
          max={480}
        />
        <NumberField
          id={`before-${value.id}`}
          label="Buffer before"
          value={value.buffer_before_minutes}
          onChange={(n) => setValue((v) => ({ ...v, buffer_before_minutes: n }))}
          min={0}
          max={240}
        />
        <NumberField
          id={`after-${value.id}`}
          label="Buffer after"
          value={value.buffer_after_minutes}
          onChange={(n) => setValue((v) => ({ ...v, buffer_after_minutes: n }))}
          min={0}
          max={240}
        />
      </div>
      {update.isError && (
        <Alert variant="destructive">
          <AlertDescription>Not saved. Check the values.</AlertDescription>
        </Alert>
      )}
      <Button
        type="submit"
        variant="outline"
        className="h-10 self-start px-4"
        disabled={update.isPending}
      >
        {update.isPending ? 'Saving…' : update.isSuccess ? 'Saved' : 'Save'}
      </Button>
    </form>
  )
}

function RetentionField({
  value,
  onChange,
}: {
  value: number | null
  onChange: (months: number | null) => void
}) {
  const preview = useRetentionPreview(value)
  return (
    <Field>
      <FieldLabel htmlFor="retention">Delete enquiries after (months)</FieldLabel>
      <Input
        id="retention"
        type="number"
        inputMode="numeric"
        min={1}
        max={120}
        placeholder="Off"
        value={value ?? ''}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10)
          onChange(Number.isFinite(n) && n > 0 ? n : null)
        }}
        className="h-10 text-base"
        aria-describedby="retention-hint retention-preview"
      />
      <p id="retention-hint" className="text-muted-foreground text-xs">
        Empty means off: nothing is deleted automatically. When set, a daily job deletes enquiries
        older than this, with their bookings, history, emails and calendar events, except enquiries
        marked won. It cannot be undone.
      </p>
      <p id="retention-preview" className="text-sm" aria-live="polite">
        {value === null
          ? 'Retention is off.'
          : preview.isPending
            ? 'Counting…'
            : preview.isError
              ? 'Could not count.'
              : `With ${value} months, the next run would delete ${preview.data} enquir${preview.data === 1 ? 'y' : 'ies'}.`}
      </p>
    </Field>
  )
}

function BookingSettingsForm({ initial }: { initial: BookingSettings }) {
  const [value, setValue] = useState(initial)
  const update = useUpdateBookingSettings()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(value)
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id="cutoff"
          label="Online changes until (hours before)"
          value={Math.round(value.change_cutoff_minutes / 60)}
          onChange={(n) => setValue((v) => ({ ...v, change_cutoff_minutes: n * 60 }))}
          min={0}
          max={168}
          hint="Inside this, customers are asked to ring"
        />
        <NumberField
          id="lead"
          label="Reminder (hours before)"
          value={Math.round(value.reminder_lead_minutes / 60)}
          onChange={(n) => setValue((v) => ({ ...v, reminder_lead_minutes: Math.max(n, 1) * 60 }))}
          min={1}
          max={168}
          hint="One email; none if booked later than this"
        />
      </div>
      <Field>
        <FieldLabel htmlFor="business-phone">Phone customers ring for changes</FieldLabel>
        <Input
          id="business-phone"
          type="tel"
          inputMode="tel"
          value={value.business_phone ?? ''}
          onChange={(e) => setValue((v) => ({ ...v, business_phone: e.target.value || null }))}
          className="h-10 text-base"
          aria-describedby="business-phone-hint"
        />
        <p id="business-phone-hint" className="text-muted-foreground text-xs">
          Empty until confirmed; customers are then asked to reply to their email instead.
        </p>
      </Field>
      <RetentionField
        value={value.retention_months}
        onChange={(months) => setValue((v) => ({ ...v, retention_months: months }))}
      />
      {update.isError && (
        <Alert variant="destructive">
          <AlertDescription>Not saved. Check the values.</AlertDescription>
        </Alert>
      )}
      {update.isSuccess && (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Saved. A new reminder time applies to bookings made or moved from now on.
        </p>
      )}
      <Button type="submit" className="h-10 self-start px-4" disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}

const SETUP_LINKS: { to: string; label: string; hint: string }[] = [
  {
    to: '/staff/settings/people',
    label: 'People',
    hint: 'Add staff, switch accounts off, who takes bookings',
  },
]

function SetupLinks() {
  return (
    <nav aria-labelledby="setup-heading" className="bg-background rounded-md border p-4">
      <h2 id="setup-heading" className="text-base font-bold">
        Set-up (admins)
      </h2>
      <ul className="mt-2 flex flex-col">
        {SETUP_LINKS.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              className="hover:bg-muted flex min-h-12 flex-col justify-center rounded-md px-2 py-2"
            >
              <span className="text-primary font-medium underline">{l.label}</span>
              <span className="text-muted-foreground text-sm">{l.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function SettingsPage() {
  const staff = useCurrentStaff()
  const isAdmin = staff.role === 'admin'
  const bookable = useBookablePerson()
  // Admins edit the hours of whoever takes bookings; staff edit their own.
  const hoursFor = isAdmin ? (bookable.data ?? undefined) : staff.user_id
  const availability = useStaffAvailability(hoursFor)
  const types = useAppointmentTypes()
  const bookingSettings = useBookingSettings()
  return (
    <div className="flex flex-col gap-4">
      <ExceptionsBanner />
      <h1 className="text-section text-ink font-bold">Settings</h1>
      {isAdmin && <SetupLinks />}
      <CalendarCard />
      <Card title="Hours for bookings" id="availability-heading">
        {availability.isPending && hoursFor !== undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : availability.isError ? (
          <Alert variant="destructive">
            <AlertDescription>Could not load the hours.</AlertDescription>
          </Alert>
        ) : availability.data ? (
          <>
            <p className="text-muted-foreground mb-3 text-sm">
              {hoursFor === staff.user_id
                ? 'Your hours: customers can book inside these times.'
                : 'The hours of the person who takes bookings (see People).'}
            </p>
            <AvailabilityForm key={availability.data.staff_user_id} initial={availability.data} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            You do not take bookings, so there are no hours to set here.
          </p>
        )}
      </Card>
      {isAdmin && (
        <Card title="Changes and reminders" id="changes-heading">
          {bookingSettings.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : bookingSettings.isError || !bookingSettings.data ? (
            <Alert variant="destructive">
              <AlertDescription>Could not load these settings.</AlertDescription>
            </Alert>
          ) : (
            <BookingSettingsForm initial={bookingSettings.data} />
          )}
        </Card>
      )}
      {isAdmin && (
        <Card title="Appointment types" id="types-heading">
          {types.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : types.isError ? (
            <Alert variant="destructive">
              <AlertDescription>Could not load appointment types.</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              {types.data.map((t) => (
                <TypeForm key={t.id} initial={t} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
