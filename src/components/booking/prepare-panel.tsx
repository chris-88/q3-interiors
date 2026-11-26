import { useEffect, useId, useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { BookingApiError, type CustomerBooking } from '@/api/booking'
import { RateLimitedError } from '@/api/errors'
import {
  usePrepare,
  useRemovePhoto,
  useSavePrepare,
  useUploadPhoto,
  type PreparePatch,
  type PrepareState,
} from '@/api/prepare'
import { BackLink, ChoiceCards } from '@/components/journey/journey-parts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { prepareV1 } from '@/forms/prepare/v1'
import type { SingleChoiceField } from '@/forms/types'
import { ROUTE_COPY } from '@/lib/journey'
import { MAX_PHOTOS, PhotoReadError, preparePhoto } from '@/lib/photos'
import { cn } from '@/lib/utils'

/*
 * "Help us prepare (optional)", after booking. Every part saves on its own and can be changed
 * until the appointment: photos, a rough budget, when the work should start, access notes (site
 * visits) and the news-and-offers consent (unticked unless the customer ticks it).
 */

const budgetField = prepareV1.steps[0]?.fields.find((f) => f.id === 'budget') as SingleChoiceField
const timingField = prepareV1.steps[0]?.fields.find((f) => f.id === 'timing') as SingleChoiceField

type Upload = {
  id: string
  key: string
  file: File
  status: 'preparing' | 'uploading' | 'failed'
  error: string | null
  retryable: boolean
  prepared: { photo: Blob; thumb: Blob } | null
}

function uploadError(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof PhotoReadError)
    return {
      message:
        'We could not read this photo. Try another one, or a JPEG or PNG copy of it (some phones save photos in a format this browser cannot open).',
      retryable: false,
    }
  if (error instanceof RateLimitedError)
    return {
      message: 'We have had a lot of requests from your connection. Please try again later.',
      retryable: true,
    }
  if (error instanceof BookingApiError) {
    if (error.reason === 'photo_limit')
      return {
        message: `You have added the most photos we take (${MAX_PHOTOS}).`,
        retryable: false,
      }
    if (error.reason === 'closed')
      return {
        message: 'Photos can no longer be added: the appointment has started or is not booked.',
        retryable: false,
      }
    if (error.reason === 'invalid_photo')
      return { message: 'This file is not a photo we can take.', retryable: false }
  }
  return {
    message: 'The photo did not upload. Your booking is not affected.',
    retryable: true,
  }
}

/**
 * Screen hints under the prepare questions. Presentational, like the access-notes hint below: the
 * published form prepare@1 is not changed (a hint in it would need a new form version).
 */
const PREPARE_HINTS: Record<string, string> = {
  budget: 'This helps us suggest what fits. It isn’t a commitment.',
}

function SavedNote({ show }: { show: boolean }) {
  return (
    <p aria-live="polite" className="text-muted-foreground min-h-5 text-sm">
      {show ? 'Saved' : ''}
    </p>
  )
}

function Photos({ token, state }: { token: string; state: PrepareState }) {
  const inputId = useId()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const upload = useUploadPhoto(token)
  const remove = useRemovePhoto(token)
  const running = useRef(false)
  const open = state.window.open
  const room = state.max_photos - state.photos.length - uploads.length

  const patch = (id: string, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)))

  // One upload at a time: gentle on the connection and on the per-address limits.
  useEffect(() => {
    if (running.current) return
    const next = uploads.find((u) => u.status === 'preparing' || u.status === 'uploading')
    if (!next) return
    running.current = true
    void (async () => {
      try {
        const prepared = next.prepared ?? (await preparePhoto(next.file))
        patch(next.id, { prepared, status: 'uploading' })
        await upload.mutateAsync({ key: next.key, ...prepared })
        setUploads((list) => list.filter((u) => u.id !== next.id))
      } catch (error) {
        const { message, retryable } = uploadError(error)
        patch(next.id, { status: 'failed', error: message, retryable })
      } finally {
        running.current = false
        // Re-run for the next item.
        setUploads((list) => [...list])
      }
    })()
  }, [uploads, upload])

  const choose = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const chosen = [...files]
    const taken = chosen.slice(0, Math.max(0, room))
    setNotice(
      chosen.length > taken.length
        ? `Only ${MAX_PHOTOS} photos can be added. ${chosen.length - taken.length} were left out.`
        : null,
    )
    setUploads((list) => [
      ...list,
      ...taken.map((file) => ({
        id: crypto.randomUUID(),
        key: crypto.randomUUID(),
        file,
        status: 'preparing' as const,
        error: null,
        retryable: false,
        prepared: null,
      })),
    ])
  }

  return (
    <section aria-labelledby="photos-heading" className="flex flex-col gap-3">
      <h2 id="photos-heading" className="text-title text-ink font-medium">
        Photos
      </h2>
      <p className="text-ink">A photo from the doorway helps us see the whole room.</p>
      <p className="text-muted-foreground text-sm">
        Up to {MAX_PHOTOS} photos. We shrink them before sending and remove the location and camera
        details.
      </p>
      {(state.photos.length > 0 || uploads.length > 0) && (
        <ul aria-label="Your photos" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {state.photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-col gap-1">
              <img
                src={`data:image/jpeg;base64,${photo.thumb}`}
                alt={`Your upload ${index + 1}`}
                className="aspect-square w-full rounded-md border object-cover"
              />
              {open && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-12 text-base underline underline-offset-4"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(photo.id)}
                >
                  <X aria-hidden="true" />
                  Remove<span className="sr-only"> upload {index + 1}</span>
                </Button>
              )}
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.id} className="flex flex-col gap-1">
              <div
                className={cn(
                  'bg-soft flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border p-2 text-center text-sm',
                  u.status === 'failed' && 'border-destructive',
                )}
              >
                {u.status === 'failed' ? (
                  <p role="alert" className="text-destructive">
                    {u.error}
                  </p>
                ) : (
                  <>
                    <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />
                    <span>{u.status === 'preparing' ? 'Preparing…' : 'Uploading…'}</span>
                  </>
                )}
              </div>
              {u.status === 'failed' && (
                <div className="flex flex-col">
                  {u.retryable && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 text-base"
                      onClick={() => patch(u.id, { status: 'uploading', error: null })}
                    >
                      Try again
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-12 text-base underline underline-offset-4"
                    onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {remove.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>The photo was not removed. Please try again.</AlertDescription>
        </Alert>
      )}
      {notice && <output className="text-ink text-sm">{notice}</output>}
      {open && room > 0 && (
        <div>
          <label
            htmlFor={inputId}
            className="border-action text-ink has-[:focus-visible]:outline-action relative inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-md border px-4 py-3 text-base font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-solid"
          >
            <ImagePlus className="size-5" aria-hidden="true" />
            Add photos
            <input
              id={inputId}
              type="file"
              accept="image/*"
              multiple
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              onChange={(e) => {
                choose(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}
    </section>
  )
}

function Choice({
  token,
  field,
  value,
  open,
}: {
  token: string
  field: SingleChoiceField
  value: string | null
  open: boolean
}) {
  const save = useSavePrepare(token)
  const [saved, setSaved] = useState(false)
  // The choice shows at once; if the save fails it goes back to what is stored.
  const [local, setLocal] = useState<string | null | undefined>(undefined)
  const shown = local !== undefined && !save.isError ? local : value
  const set = (next: string) => {
    setLocal(next === '' ? null : next)
    save.mutate({ [field.id]: next } as PreparePatch, { onSuccess: () => setSaved(true) })
  }
  return (
    <div className="flex flex-col gap-2">
      <ChoiceCards
        name={`prepare-${field.id}`}
        legend={field.label}
        optional
        hint={PREPARE_HINTS[field.id]}
        options={field.options}
        value={shown}
        onChange={(v) => {
          setSaved(false)
          if (open) set(v)
        }}
      />
      {shown && open && (
        <button
          type="button"
          onClick={() => {
            setSaved(false)
            set('')
          }}
          className="text-muted-foreground inline-flex min-h-12 items-center self-start text-sm underline underline-offset-4"
        >
          Clear<span className="sr-only"> {field.label}</span>
        </button>
      )}
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          That was not saved. Please try again.
        </p>
      )}
      <SavedNote show={saved && !save.isPending} />
    </div>
  )
}

function AccessNotes({ token, initial, open }: { token: string; initial: string; open: boolean }) {
  const save = useSavePrepare(token)
  const [text, setText] = useState(initial)
  const [saved, setSaved] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="prepare-access" className="text-ink text-base font-medium">
        Anything we should know to get in?{' '}
        <span className="text-muted-foreground font-normal">(optional)</span>
      </label>
      <p id="prepare-access-help" className="text-muted-foreground text-sm">
        For example parking, a side entrance, or a dog in the garden.
      </p>
      <Textarea
        id="prepare-access"
        aria-describedby="prepare-access-help"
        rows={3}
        maxLength={500}
        value={text}
        disabled={!open}
        onChange={(e) => {
          setText(e.target.value)
          setSaved(false)
        }}
        className="text-base md:text-base"
      />
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          The notes were not saved. Please try again.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-12 text-base"
          disabled={!open || save.isPending}
          onClick={() => save.mutate({ access_notes: text }, { onSuccess: () => setSaved(true) })}
        >
          {save.isPending ? 'Saving…' : 'Save notes'}
        </Button>
        <SavedNote show={saved && !save.isPending} />
      </div>
    </div>
  )
}

function Marketing({ token, value, open }: { token: string; value: boolean; open: boolean }) {
  const save = useSavePrepare(token)
  const [saved, setSaved] = useState(false)
  const [local, setLocal] = useState<boolean | undefined>(undefined)
  const shown = local !== undefined && !save.isError ? local : value
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="prepare-marketing" className="flex min-h-12 items-start gap-3">
        <Checkbox
          id="prepare-marketing"
          checked={shown}
          disabled={!open || save.isPending}
          onCheckedChange={(checked) => {
            setSaved(false)
            setLocal(checked)
            save.mutate({ marketing_opt_in: checked }, { onSuccess: () => setSaved(true) })
          }}
          className="mt-1"
        />
        <span className="flex flex-col">
          <span className="text-ink text-base">
            Send me occasional news and offers from Q3 Interiors
          </span>
          <span className="text-muted-foreground text-sm">
            Optional. You can ask us to stop at any time.
          </span>
        </span>
      </label>
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          That was not saved. Please try again.
        </p>
      )}
      <SavedNote show={saved && !save.isPending} />
    </div>
  )
}

export function PreparePanel({
  token,
  booking,
  onBack,
}: {
  token: string
  booking: CustomerBooking
  onBack: () => void
}) {
  const state = usePrepare(token)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])

  return (
    <section className="flex flex-col">
      <BackLink onClick={onBack} label="Back to your booking" />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-section text-ink mt-2 font-medium break-words outline-none"
      >
        Help us prepare (optional)
      </h1>
      <p className="text-muted-foreground mt-2">
        Anything you add here goes to {booking.staffFirstName} before your{' '}
        {ROUTE_COPY[booking.type.mode].noun}. Each part saves on its own, and you can change it
        until then.
      </p>
      <div className="mt-8">
        {state.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : state.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>We could not load this page</AlertTitle>
            <AlertDescription>
              Check your connection and try again.
              <Button variant="outline" className="mt-2 h-12" onClick={() => void state.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-10">
            {!state.data.window.open && (
              <Alert>
                <AlertDescription>
                  Your appointment has started or is no longer booked, so nothing more can be added
                  here.
                </AlertDescription>
              </Alert>
            )}
            <Photos token={token} state={state.data} />
            <Choice
              token={token}
              field={budgetField}
              value={state.data.answers.budget ?? null}
              open={state.data.window.open}
            />
            <Choice
              token={token}
              field={timingField}
              value={state.data.answers.timing ?? null}
              open={state.data.window.open}
            />
            {booking.type.mode === 'on_site' && (
              <AccessNotes
                token={token}
                initial={state.data.access_notes ?? ''}
                open={state.data.window.open}
              />
            )}
            <Marketing
              token={token}
              value={state.data.marketing_opt_in}
              open={state.data.window.open}
            />
          </div>
        )}
      </div>
    </section>
  )
}
