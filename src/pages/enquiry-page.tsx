import { useCallback, useEffect, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { minutesFor, usePublicAppointmentTypes } from '@/api/appointment-types'
import { ApiError } from '@/api/errors'
import { useSubmitEnquiry } from '@/api/submit'
import { countRouteChoice, currentVisitId } from '@/api/visits'
import { FormFieldInput, fieldDomId } from '@/components/enquiry/form-field'
import {
  BackLink,
  ChoiceCards,
  JourneyProgress,
  ScreenHeading,
} from '@/components/journey/journey-parts'
import { PublicLayout } from '@/components/public-layout'
import { TroubleMessage } from '@/components/trouble-message'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { currentEnquiryForm } from '@/forms/enquiry/v3'
import { cleanAnswers, findField, formatAnswer, validateFields, visibleFields } from '@/forms/logic'
import type { Answers, FormDefinition, FormField, SingleChoiceField } from '@/forms/types'
import { currentAttribution } from '@/lib/attribution'
import { rememberBookingAccess } from '@/lib/booking-access'
import {
  completeSubmission,
  definedAnswers,
  ensureIdempotencyKey,
  loadDraft,
  saveDraft,
  type Draft,
} from '@/lib/draft'
import { clearInspiration, readEntry, takePendingProjectType } from '@/lib/entry'
import { ROUTE_COPY, isRoute, otherRoute, recapLine, routeTitle } from '@/lib/journey'
import { safeStorage, type SafeStorage } from '@/lib/storage'
import { findProject, projectUrl } from '@/lib/website'

type Props = {
  form?: FormDefinition
  sessionStore?: SafeStorage
  localStore?: SafeStorage
}

/*
 * Enquiry form v2, screens 2 and 3 of the journey: Project, then Details. The route (call or
 * visit) was chosen on the landing page (`/#/enquire?type=phone|on_site`) and is the
 * `appointment_preference` answer. "Send enquiry & see times" saves the enquiry once and opens
 * the time screen (`/#/book/<token>`). Answers live in a sessionStorage draft, so Back, a reload
 * or a backgrounded in-app browser keep them.
 */

const PROJECT = 0
const DETAILS = 1

function focusField(id: string) {
  const container = document.querySelector(`[data-field="${id}"]`)
  const target =
    document.getElementById(fieldDomId(id)) ??
    container?.querySelector<HTMLElement>('input:checked') ??
    container?.querySelector<HTMLElement>('input, textarea')
  target?.focus()
}

function stepFields(form: FormDefinition, id: string): FormField[] {
  return form.steps.find((s) => s.id === id)?.fields ?? []
}

function field(form: FormDefinition, id: string): FormField {
  const found = findField(form, id)
  if (!found) throw new Error(`Form ${form.formId}@${form.version} has no field ${id}`)
  return found
}

export function EnquiryPage({ form = currentEnquiryForm, ...stores }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [{ sessionStore, localStore }] = useState(() => ({
    sessionStore: stores.sessionStore ?? safeStorage('session'),
    localStore: stores.localStore ?? safeStorage('local'),
  }))
  // What a website link brought (src/lib/entry.ts): a project to show as context and a project
  // type to pre-select (once; the customer can change it).
  const [entry] = useState(() => readEntry(sessionStore))
  const inspiration = findProject(entry.inspiration)
  // The landing choice arrives as ?type=; it starts (or switches) the route and the Project
  // screen. A draft from an older form version is discarded by loadDraft.
  const [initial] = useState<Draft>(() => {
    const draft = loadDraft(sessionStore, form.formId, form.version)
    const chosen = searchParams.get('type')
    const suggested = entry.pendingProjectType
    const answers =
      suggested && findField(form, 'project_type')
        ? { ...draft.answers, project_type: suggested }
        : draft.answers
    if (!isRoute(chosen)) return { ...draft, answers, step: Math.min(draft.step, DETAILS) }
    return {
      ...draft,
      step: PROJECT,
      answers: { ...answers, appointment_preference: chosen },
    }
  })
  const draftRef = useRef<Draft>(initial)
  const [step, setStep] = useState(initial.step)
  // Honeypot: people never see or reach this field; bots that fill every input do.
  const [trap, setTrap] = useState('')
  const submit = useSubmitEnquiry()
  const types = usePublicAppointmentTypes()

  const { control, getValues, setValue, setError, clearErrors, formState, subscribe } =
    useForm<Answers>({ defaultValues: initial.answers })
  const answers = useWatch({ control })

  const persist = useCallback(
    (patch: Partial<Draft>) => {
      draftRef.current = { ...draftRef.current, answers: definedAnswers(getValues()), ...patch }
      saveDraft(sessionStore, draftRef.current)
    },
    [getValues, sessionStore],
  )
  useEffect(
    () => subscribe({ formState: { values: true }, callback: () => persist({}) }),
    [subscribe, persist],
  )
  useEffect(() => persist({ step }), [persist, step])
  // The suggested project type is in the draft now; a reload keeps the customer's own choice.
  useEffect(() => {
    if (entry.pendingProjectType) takePendingProjectType(sessionStore)
  }, [entry.pendingProjectType, sessionStore])
  // Drop ?type= once it is in the draft, so a reload or Back does not restart the route.
  useEffect(() => {
    if (!searchParams.has('type')) return
    const chosen = searchParams.get('type')
    if (isRoute(chosen)) countRouteChoice(chosen)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const route = answers.appointment_preference
  if (!isRoute(route)) return <Navigate to="/" replace />

  const errorOf = (id: string) => formState.errors[id]?.message
  const minutes = minutesFor(types.data, route)

  const check = (stepId: string): boolean => {
    const values = getValues()
    const fields = stepFields(form, stepId)
    const errors = validateFields(fields, values)
    clearErrors()
    const invalid = visibleFields(fields, values).filter((f) => f.id in errors)
    for (const f of invalid) setError(f.id, { type: 'validate', message: errors[f.id] })
    const first = invalid[0]
    if (first) focusField(first.id)
    return !first
  }

  const switchRoute = () => {
    setValue('appointment_preference', otherRoute(route), { shouldDirty: true })
    clearErrors()
  }

  const send = () => {
    if (!check('project')) {
      setStep(PROJECT)
      return
    }
    if (!check('contact')) return
    const values = getValues()
    const { draft, key } = ensureIdempotencyKey(sessionStore, {
      ...draftRef.current,
      answers: definedAnswers(values),
    })
    draftRef.current = draft
    submit.mutate(
      {
        idempotencyKey: key,
        formId: form.formId,
        formVersion: form.version,
        answers: cleanAnswers(form, values),
        marketingOptIn: false,
        attribution: currentAttribution(localStore),
        trap,
        sessionId: currentVisitId(sessionStore),
        inspiration: inspiration?.slug ?? null,
      },
      {
        onSuccess: ({ reference, accessToken }) => {
          completeSubmission(sessionStore, reference)
          clearInspiration(sessionStore)
          if (!accessToken) {
            // The server saw a bot (honeypot): show the ordinary confirmation, nothing more.
            void navigate('/enquire/sent', { replace: true })
            return
          }
          rememberBookingAccess(localStore, { reference, token: accessToken })
          // Straight on to the time screen. The token is opaque; nothing personal in the URL.
          void navigate(`/book/${accessToken}`, { replace: true })
        },
      },
    )
  }

  const projectField = field(form, 'project_type') as SingleChoiceField
  const layoutField = field(form, 'kitchen_layout') as SingleChoiceField
  const text = (id: string, override?: Partial<FormField>) => (
    <FormFieldInput
      field={{ ...field(form, id), ...override } as FormField}
      control={control}
      error={errorOf(id)}
      onEdit={(fieldId) => clearErrors(fieldId)}
    />
  )
  const projectLabel =
    typeof answers.project_type === 'string'
      ? formatAnswer(projectField, answers.project_type)
      : null
  const location = typeof answers.location === 'string' ? answers.location.trim() : ''

  return (
    <PublicLayout>
      <JourneyProgress current={step === PROJECT ? 0 : 1} />
      <div className="mt-6 flex flex-col">
        <BackLink
          onClick={() => {
            clearErrors()
            if (step === PROJECT) void navigate('/')
            else setStep(PROJECT)
          }}
        />
        {step === PROJECT ? (
          <form
            noValidate
            className="mt-2 flex flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              if (check('project')) setStep(DETAILS)
            }}
          >
            <ScreenHeading focusKey="project">What work are you planning?</ScreenHeading>
            <p className="text-muted-foreground mt-2">
              {routeTitle(route, minutes)}, free.{' '}
              <button
                type="button"
                onClick={switchRoute}
                className="text-ink inline-flex min-h-12 items-center underline underline-offset-4"
              >
                Switch to a {ROUTE_COPY[otherRoute(route)].noun}
              </button>
            </p>
            {inspiration && (
              <aside
                aria-label="The project you were looking at"
                className="bg-soft text-ink mt-4 flex flex-col rounded-md px-4 pt-3"
              >
                <span className="text-muted-foreground text-sm">You were looking at</span>
                <span>
                  {inspiration.title}, {inspiration.location}
                </span>
                <a
                  href={projectUrl(inspiration.slug)}
                  className="inline-flex min-h-12 items-center self-start text-sm underline underline-offset-4"
                >
                  Back to the project
                </a>
              </aside>
            )}
            <div className="mt-6 flex flex-col gap-8">
              <Controller
                name="project_type"
                control={control}
                render={({ field: rhf }) => (
                  <ChoiceCards
                    name="project_type"
                    legend="Project type"
                    options={projectField.options}
                    value={typeof rhf.value === 'string' ? rhf.value : null}
                    onChange={(value) => {
                      rhf.onChange(value)
                      clearErrors('project_type')
                    }}
                    error={errorOf('project_type')}
                    reveal={(value) =>
                      value === 'kitchen' ? (
                        <Controller
                          name="kitchen_layout"
                          control={control}
                          render={({ field: layout }) => (
                            <ChoiceCards
                              name="kitchen_layout"
                              legend={layoutField.label}
                              legendClassName="font-normal"
                              optional
                              options={layoutField.options}
                              value={typeof layout.value === 'string' ? layout.value : null}
                              onChange={layout.onChange}
                            />
                          )}
                        />
                      ) : value === 'several_rooms' ? (
                        text('rooms_involved')
                      ) : value === 'other' ? (
                        text('project_type_other')
                      ) : null
                    }
                  />
                )}
              />
              {text('location')}
            </div>
            <Button
              type="submit"
              size="lg"
              className="mt-8 h-auto min-h-12 py-3 text-base whitespace-normal"
            >
              Continue to your details
            </Button>
          </form>
        ) : (
          <form
            noValidate
            className="mt-2 flex flex-col"
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            <ScreenHeading focusKey="details">How can we reach you?</ScreenHeading>
            <p className="bg-soft text-ink mt-4 flex flex-wrap items-center gap-x-3 rounded-md px-4 py-2">
              <span>{recapLine(route, projectLabel, location || null)}</span>
              <button
                type="button"
                onClick={() => {
                  submit.reset()
                  setStep(PROJECT)
                }}
                className="inline-flex min-h-12 items-center underline underline-offset-4"
              >
                Edit<span className="sr-only"> your project</span>
              </button>
            </p>
            <div className="mt-6 flex flex-col gap-8">
              {text('name')}
              {text('email', { help: 'We send your confirmation and the link to change it here.' })}
              {text('phone', { label: ROUTE_COPY[route].phoneLabel })}
              {route === 'on_site' && (
                <fieldset className="flex min-w-0 flex-col gap-6">
                  <legend className="text-title text-ink mb-2 font-medium">Visit address</legend>
                  {text('site_street')}
                  {text('site_unit')}
                  <p className="text-muted-foreground -mt-2 text-sm">
                    Town or Eircode: <span className="text-ink">{location}</span>{' '}
                    <button
                      type="button"
                      onClick={() => setStep(PROJECT)}
                      className="inline-flex min-h-12 items-center underline underline-offset-4"
                    >
                      Change<span className="sr-only"> the town or Eircode</span>
                    </button>
                  </p>
                </fieldset>
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -left-[10000px] h-px w-px overflow-hidden"
              >
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={trap}
                  onChange={(e) => setTrap(e.target.value)}
                />
              </div>
            </div>
            {submit.isError &&
              (submit.error instanceof ApiError && submit.error.code === '22023' ? (
                <Alert variant="destructive" className="mt-6" role="alert">
                  <AlertTitle>Your enquiry has not gone through</AlertTitle>
                  <AlertDescription>
                    One of the answers could not be accepted. Please check them and try again.
                  </AlertDescription>
                </Alert>
              ) : (
                <TroubleMessage
                  error={submit.error}
                  title="Your enquiry has not gone through"
                  keptNote="Your answers are still here."
                />
              ))}
            <Button
              type="submit"
              size="lg"
              className="mt-8 h-auto min-h-12 py-3 text-base whitespace-normal"
              disabled={submit.isPending}
            >
              {submit.isPending
                ? 'Sending…'
                : submit.isError
                  ? 'Try again'
                  : 'Send enquiry & see times'}
            </Button>
            <p className="text-muted-foreground mt-3 text-sm">
              <Link
                to="/privacy"
                className="inline-flex min-h-12 items-center underline underline-offset-4"
              >
                How we use your details
              </Link>
            </p>
          </form>
        )}
      </div>
    </PublicLayout>
  )
}
