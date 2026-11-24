import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '@/api/errors'
import { useSubmitEnquiry } from '@/api/submit'
import { FormFieldInput, fieldDomId } from '@/components/enquiry/form-field'
import { ReviewStep } from '@/components/enquiry/review-step'
import { PublicLayout } from '@/components/public-layout'
import { TroubleMessage } from '@/components/trouble-message'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Progress, ProgressLabel } from '@/components/ui/progress'
import { business } from '@/config/business'
import { currentEnquiryForm } from '@/forms/enquiry/v1'
import { allFields, cleanAnswers, validateFields, visibleFields } from '@/forms/logic'
import type { Answers, FormDefinition } from '@/forms/types'
import { currentAttribution } from '@/lib/attribution'
import {
  completeSubmission,
  definedAnswers,
  ensureIdempotencyKey,
  loadDraft,
  saveDraft,
  type Draft,
} from '@/lib/draft'
import { rememberBookingAccess } from '@/lib/booking-access'
import { safeStorage, type SafeStorage } from '@/lib/storage'

type Props = {
  form?: FormDefinition
  sessionStore?: SafeStorage
  localStore?: SafeStorage
}

function focusField(id: string) {
  const container = document.querySelector(`[data-field="${id}"]`)
  const target =
    document.getElementById(fieldDomId(id)) ??
    container?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
    container?.querySelector<HTMLElement>('[role="radio"], [role="checkbox"], input, textarea')
  target?.focus()
}

export function EnquiryPage({ form = currentEnquiryForm, ...stores }: Props) {
  const navigate = useNavigate()
  const [{ sessionStore, localStore }] = useState(() => ({
    sessionStore: stores.sessionStore ?? safeStorage('session'),
    localStore: stores.localStore ?? safeStorage('local'),
  }))
  const reviewIndex = form.steps.length
  const [initial] = useState(() => loadDraft(sessionStore, form.formId, form.version))
  const draftRef = useRef<Draft>(initial)
  const [step, setStep] = useState(() => Math.min(initial.step, reviewIndex))
  const [marketingOptIn, setMarketingOptIn] = useState(initial.marketingOptIn)
  const [returnToReview, setReturnToReview] = useState(false)
  // Honeypot: people never see or reach this field; bots that fill every input do.
  const [trap, setTrap] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  const submit = useSubmitEnquiry()

  const { control, getValues, setError, clearErrors, formState, subscribe } = useForm<Answers>({
    defaultValues: initial.answers,
  })
  const answers = useWatch({ control })

  const persist = useCallback(
    (patch: Partial<Draft>) => {
      draftRef.current = {
        ...draftRef.current,
        answers: definedAnswers(getValues()),
        ...patch,
      }
      saveDraft(sessionStore, draftRef.current)
    },
    [getValues, sessionStore],
  )

  useEffect(() => {
    return subscribe({ formState: { values: true }, callback: () => persist({}) })
  }, [subscribe, persist])

  useEffect(() => {
    persist({ step, marketingOptIn })
  }, [persist, step, marketingOptIn])

  // Move focus to the new step's heading so keyboard and screen reader users start at the top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    window.scrollTo({ top: 0 })
    headingRef.current?.focus()
  }, [step])

  const stepHasQuestions = useCallback(
    (index: number) => {
      const s = form.steps[index]
      return s !== undefined && visibleFields(s.fields, getValues()).length > 0
    },
    [form, getValues],
  )

  const showErrors = (errors: Record<string, string>) => {
    clearErrors()
    for (const [id, message] of Object.entries(errors)) setError(id, { type: 'validate', message })
  }

  const goNext = () => {
    const current = form.steps[step]
    if (!current) return
    const errors = validateFields(current.fields, getValues())
    const first = visibleFields(current.fields, getValues()).find((f) => f.id in errors)
    if (first) {
      showErrors(errors)
      focusField(first.id)
      return
    }
    clearErrors()
    if (returnToReview) {
      setReturnToReview(false)
      setStep(reviewIndex)
      return
    }
    let next = step + 1
    while (next < reviewIndex && !stepHasQuestions(next)) next += 1
    setStep(next)
  }

  const goBack = () => {
    let previous = step - 1
    while (previous > 0 && !stepHasQuestions(previous)) previous -= 1
    setReturnToReview(false)
    clearErrors()
    if (previous < 0) {
      void navigate('/')
      return
    }
    setStep(previous)
  }

  const editStep = (index: number) => {
    submit.reset()
    setReturnToReview(true)
    setStep(index)
  }

  const send = () => {
    const values = getValues()
    const errors = validateFields(allFields(form), values)
    const firstStep = form.steps.findIndex((s) =>
      visibleFields(s.fields, values).some((f) => f.id in errors),
    )
    if (firstStep !== -1) {
      setReturnToReview(true)
      setStep(firstStep)
      showErrors(errors)
      return
    }
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
        marketingOptIn,
        attribution: currentAttribution(localStore),
        trap,
      },
      {
        onSuccess: ({ reference, accessToken }) => {
          completeSubmission(sessionStore, reference)
          if (!accessToken) {
            // The server saw a bot (honeypot): show the ordinary confirmation, nothing more.
            void navigate('/enquire/sent', { replace: true })
            return
          }
          rememberBookingAccess(localStore, { reference, token: accessToken })
          // Straight on to scheduling. The token is opaque; nothing personal goes in the URL.
          void navigate(`/book/${accessToken}`, { replace: true })
        },
      },
    )
  }

  const total = reviewIndex + 1
  const current = form.steps[step]
  const isReview = step === reviewIndex
  const isContactStep = current?.fields.some((f) => f.type === 'email') ?? false
  const errorMessage = (id: string) => formState.errors[id]?.message
  const stepFields = useMemo(
    () => (current ? visibleFields(current.fields, answers) : []),
    [current, answers],
  )

  return (
    <PublicLayout>
      <Progress value={((step + 1) / total) * 100} className="mb-8 gap-2">
        <ProgressLabel className="text-muted-foreground font-normal">
          {isReview ? 'Review your enquiry' : `Step ${step + 1} of ${total}`}
        </ProgressLabel>
      </Progress>

      {isReview ? (
        <>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-section text-ink font-bold outline-none"
          >
            Review your enquiry
          </h1>
          <p className="text-muted-foreground mt-2">You can change anything before you send it.</p>
          <ReviewStep
            form={form}
            answers={answers}
            marketingOptIn={marketingOptIn}
            onEdit={editStep}
            className="mt-6"
          />
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
          <p className="text-muted-foreground mt-6 text-sm">
            Read{' '}
            <Link to="/privacy" className="underline underline-offset-4">
              how we use your details
            </Link>
            .
          </p>
          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 text-base"
              onClick={goBack}
              disabled={submit.isPending}
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-12 text-base sm:px-6"
              onClick={send}
              disabled={submit.isPending}
            >
              {submit.isPending ? 'Sending…' : submit.isError ? 'Try again' : 'Send enquiry'}
            </Button>
          </div>
        </>
      ) : current ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            goNext()
          }}
        >
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-section text-ink font-bold text-balance outline-none"
          >
            {current.title}
          </h1>
          {current.description && (
            <p className="text-muted-foreground mt-2">{current.description}</p>
          )}
          <FieldGroup className="mt-6 gap-8">
            {stepFields.map((field) => (
              <FormFieldInput
                key={field.id}
                field={field}
                control={control}
                error={errorMessage(field.id)}
                onEdit={(id) => clearErrors(id)}
              />
            ))}
            {isContactStep && (
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
            )}
            {isContactStep && (
              <FieldLabel htmlFor="marketing-opt-in" className="w-full">
                <Field orientation="horizontal" className="items-start">
                  <Checkbox
                    id="marketing-opt-in"
                    checked={marketingOptIn}
                    onCheckedChange={(checked) => setMarketingOptIn(checked)}
                    className="mt-0.5"
                  />
                  <FieldContent>
                    <span className="text-base font-normal">
                      Send me occasional news and offers from {business.name}
                    </span>
                    <FieldDescription>
                      Optional. You can ask us to stop at any time.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            )}
          </FieldGroup>
          <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 text-base"
              onClick={goBack}
            >
              Back
            </Button>
            <Button type="submit" size="lg" className="h-12 text-base sm:px-6">
              {returnToReview
                ? 'Save and review'
                : step === reviewIndex - 1
                  ? 'Review your enquiry'
                  : 'Continue'}
            </Button>
          </div>
        </form>
      ) : null}
    </PublicLayout>
  )
}
