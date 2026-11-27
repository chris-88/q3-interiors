import { useState } from 'react'
import {
  useSetAttendance,
  useStaffCancel,
  useStaffMoveOptions,
  useStaffReschedule,
  type StaffBooking,
  type StaffSlot,
} from '@/api/staff-booking'
import { SlotPicker } from '@/components/booking/slot-picker'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatClock } from '@/lib/format'

const LIVE = new Set(['reserved', 'calendar_pending', 'confirmed'])

export function MovePanel({ booking, onDone }: { booking: StaffBooking; onDone: () => void }) {
  const options = useStaffMoveOptions(booking.id, true)
  const move = useStaffReschedule()
  const [slot, setSlot] = useState<StaffSlot | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const data = options.data
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-muted-foreground text-sm">
        Pick a new time (Irish time). The customer is emailed the new time and the Google event
        moves.
      </p>
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {options.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : options.isError || !data ? (
        <Alert variant="destructive">
          <AlertDescription>Could not load free times.</AlertDescription>
        </Alert>
      ) : data.status !== 'ok' ? (
        <p className="text-sm">The calendar is not available, so times cannot be checked.</p>
      ) : (
        <SlotPicker slots={data.slots} selected={slot} onSelect={setSlot} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-12"
          disabled={!slot || move.isPending}
          onClick={() =>
            slot &&
            move.mutate(
              { bookingId: booking.id, start: slot.start },
              {
                onSuccess: (r) => {
                  if (r.status === 'rescheduled') onDone()
                  else if (r.status === 'slot_unavailable') {
                    setSlot(null)
                    setMessage('That time has just gone; the booking is unchanged. Pick another.')
                  } else setMessage('The booking could not be moved; it is unchanged.')
                },
              },
            )
          }
        >
          {move.isPending ? 'Moving…' : slot ? `Move to ${formatClock(slot.start)}` : 'Move'}
        </Button>
        <Button variant="ghost" className="h-12" onClick={onDone} disabled={move.isPending}>
          Close
        </Button>
      </div>
      {move.isError && (
        <Alert variant="destructive">
          <AlertDescription>Not moved: {move.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function CancelPanel({ booking, onDone }: { booking: StaffBooking; onDone: () => void }) {
  const cancel = useStaffCancel()
  const [reason, setReason] = useState('')
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <Field>
        <FieldLabel htmlFor={`cancel-${booking.id}`}>Reason (shown in history)</FieldLabel>
        <Textarea
          id={`cancel-${booking.id}`}
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="text-base"
        />
      </Field>
      <p className="text-muted-foreground text-sm">
        The customer is emailed that it is cancelled, and the Google event is removed.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          className="h-12"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ bookingId: booking.id, reason }, { onSuccess: onDone })}
        >
          {cancel.isPending ? 'Cancelling…' : 'Cancel appointment'}
        </Button>
        <Button variant="ghost" className="h-12" onClick={onDone} disabled={cancel.isPending}>
          Keep it
        </Button>
      </div>
      {cancel.isError && (
        <Alert variant="destructive">
          <AlertDescription>Not cancelled: {cancel.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

/**
 * Move, cancel and attendance for one booking on the enquiry page. `moveCancel` and `attendance`
 * choose which controls show (the Next step card has Move and Cancel; past appointments keep
 * attendance).
 */
export function BookingActions({
  booking,
  moveCancel = true,
  attendance: showAttendance = true,
}: {
  booking: StaffBooking
  moveCancel?: boolean
  attendance?: boolean
}) {
  const [panel, setPanel] = useState<'none' | 'move' | 'cancel'>('none')
  const attendance = useSetAttendance()
  const [now] = useState(() => Date.now())
  const live = LIVE.has(booking.state)
  const started = Date.parse(booking.starts_at) <= now

  return (
    <div className="flex flex-col gap-2">
      {booking.calendar_mismatch && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertDescription className="text-current">
            {booking.calendar_mismatch}. The booking keeps its time here; fix the calendar or move
            the booking.
          </AlertDescription>
        </Alert>
      )}
      {showAttendance && booking.state === 'confirmed' && started && (
        <fieldset>
          <legend className="text-muted-foreground text-sm">Did it go ahead?</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['attended', 'no_show'] as const).map((value) => (
              <Button
                key={value}
                className="h-12 px-4"
                variant={booking.attendance === value ? 'default' : 'outline'}
                aria-pressed={booking.attendance === value}
                disabled={attendance.isPending}
                onClick={() => attendance.mutate({ bookingId: booking.id, attendance: value })}
              >
                {value === 'attended' ? 'Attended' : 'No-show'}
              </Button>
            ))}
          </div>
          {attendance.isError && (
            <p className="text-destructive mt-1 text-sm">Not saved: {attendance.error.message}</p>
          )}
        </fieldset>
      )}
      {moveCancel && live && !started && panel === 'none' && (
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" className="h-12 px-6" onClick={() => setPanel('move')}>
            Move
          </Button>
          <Button variant="outline" className="h-12 px-6" onClick={() => setPanel('cancel')}>
            Cancel
          </Button>
        </div>
      )}
      {panel === 'move' && <MovePanel booking={booking} onDone={() => setPanel('none')} />}
      {panel === 'cancel' && <CancelPanel booking={booking} onDone={() => setPanel('none')} />}
    </div>
  )
}
