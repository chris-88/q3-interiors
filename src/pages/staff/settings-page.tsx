import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
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
  type StaffAvailability,
} from '@/api/staff-booking'
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
            <div key={day} className="grid grid-cols-[6.5rem_1fr_auto_1fr] items-center gap-2">
              <label className="flex items-center gap-2 text-sm" htmlFor={`day-${day}`}>
                <Checkbox
                  id={`day-${day}`}
                  checked={h !== null}
                  onCheckedChange={(checked) => setHours(day, checked ? ['09:00', '17:00'] : null)}
                />
                {name}
              </label>
              {h && (
                <>
                  <Input
                    type="time"
                    aria-label={`${name} start`}
                    value={h[0]}
                    onChange={(e) => setHours(day, [e.target.value, h[1]])}
                    className="h-10 min-w-0 text-base"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    type="time"
                    aria-label={`${name} end`}
                    value={h[1]}
                    onChange={(e) => setHours(day, [h[0], e.target.value])}
                    className="h-10 min-w-0 text-base"
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

export function SettingsPage() {
  const staff = useCurrentStaff()
  const availability = useStaffAvailability(staff.user_id)
  const types = useAppointmentTypes()
  return (
    <div className="flex flex-col gap-4">
      <ExceptionsBanner />
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <CalendarCard />
      <Card title="Availability" id="availability-heading">
        <p className="text-muted-foreground mb-3 text-sm">
          Placeholder values until confirmed with Q3 Interiors.
        </p>
        {availability.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : availability.isError ? (
          <Alert variant="destructive">
            <AlertDescription>Could not load availability.</AlertDescription>
          </Alert>
        ) : availability.data ? (
          <AvailabilityForm initial={availability.data} />
        ) : (
          <p className="text-muted-foreground text-sm">
            You do not take bookings. Availability is set up for the person who does.
          </p>
        )}
      </Card>
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
    </div>
  )
}
