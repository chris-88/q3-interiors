import { useState } from 'react'
import { useAppointmentTypes, useBookingSettings } from '@/api/staff-booking'
import {
  LIMIT_BOUNDS,
  limitProblem,
  useLimits,
  useSaveLimits,
  type LimitKey,
  type Limits,
} from '@/api/limits'
import { AdminOnly, BackToSettings, SettingsCard } from '@/components/staff/settings-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { BookingSettingsForm, TypeForm } from './settings-page'

function LimitsForm({ initial }: { initial: Limits }) {
  const [value, setValue] = useState<Record<LimitKey, string>>(() => ({
    enquiry_limit_per_hour: String(initial.enquiry_limit_per_hour),
    booking_write_limit_per_hour: String(initial.booking_write_limit_per_hour),
    booking_read_limit_per_hour: String(initial.booking_read_limit_per_hour),
  }))
  const save = useSaveLimits()
  const keys = Object.keys(LIMIT_BOUNDS) as LimitKey[]
  const problems = Object.fromEntries(
    keys.map((k) => [k, limitProblem(k, Number(value[k]))]),
  ) as Record<LimitKey, string | null>
  const valid = keys.every((k) => problems[k] === null)
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        save.mutate(Object.fromEntries(keys.map((k) => [k, Number(value[k])])) as Limits)
      }}
    >
      <p className="text-muted-foreground text-sm">
        These protect the site from floods of requests. Change them only if real customers are being
        turned away.
      </p>
      {keys.map((k) => {
        const id = `limit-${k}`
        const b = LIMIT_BOUNDS[k]
        return (
          <div key={k} className="flex flex-col gap-1">
            <label htmlFor={id} className="font-medium">
              {b.label}
            </label>
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={b.min}
              max={b.max}
              className="h-12 w-40 text-base"
              value={value[k]}
              onChange={(e) => setValue((v) => ({ ...v, [k]: e.target.value }))}
              aria-invalid={problems[k] ? true : undefined}
              aria-describedby={`${id}-hint${problems[k] ? ` ${id}-error` : ''}`}
            />
            <p id={`${id}-hint`} className="text-muted-foreground text-sm">
              {b.hint} Between {b.min} and {b.max}.
            </p>
            {problems[k] && (
              <p id={`${id}-error`} className="text-destructive text-sm" role="alert">
                {problems[k]}
              </p>
            )}
          </div>
        )
      })}
      {save.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Not saved. Please try again.</AlertDescription>
        </Alert>
      )}
      {save.isSuccess && <output className="block text-sm">Saved.</output>}
      <Button type="submit" className="h-12 self-start px-6" disabled={!valid || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save limits'}
      </Button>
    </form>
  )
}

export function BookingRulesPage() {
  const settings = useBookingSettings()
  const types = useAppointmentTypes()
  const limits = useLimits()
  return (
    <AdminOnly>
      <div className="flex flex-col gap-4">
        <BackToSettings />
        <h1 className="text-section text-ink font-bold">Booking rules and data</h1>
        <SettingsCard title="Changes, reminders and keeping data" id="rules-heading">
          {settings.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : settings.isError || !settings.data ? (
            <Alert variant="destructive">
              <AlertDescription>Could not load these settings.</AlertDescription>
            </Alert>
          ) : (
            <BookingSettingsForm initial={settings.data} />
          )}
        </SettingsCard>
        <SettingsCard title="Appointment types" id="types-heading">
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
        </SettingsCard>
        <SettingsCard title="Advanced: request limits" id="limits-heading">
          {limits.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : limits.isError ? (
            <Alert variant="destructive">
              <AlertDescription>Could not load the limits.</AlertDescription>
            </Alert>
          ) : (
            <LimitsForm initial={limits.data} />
          )}
        </SettingsCard>
      </div>
    </AdminOnly>
  )
}
