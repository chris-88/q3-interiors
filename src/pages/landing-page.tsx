import { useEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { minutesFor, usePublicAppointmentTypes } from '@/api/appointment-types'
import { PublicLayout } from '@/components/public-layout'
import { ROUTE_COPY, ROUTES, routeTitle, type Route } from '@/lib/journey'

/*
 * Landing page, enquiry form v2: the appointment choice comes first. Each choice starts its
 * route at once (`/#/enquire?type=…`); lengths come from the live appointment types. Campaign
 * tags on the landing URL are captured by `initAttribution` at load, as before.
 */

/**
 * A real Q3 project photo goes under the choices once one is approved (brand rule: no project
 * photography until approved photos exist). Set it here; while null nothing is shown, not even
 * an empty slot. `src` should be a file in `public/`.
 */
const LANDING_PHOTO: { src: string; alt: string; width: number; height: number } | null = null

const steps = [
  {
    title: 'Choose a call or a site visit',
    body: 'A phone call to talk through your plans, or a visit so we can see the space and measure up. Both are free.',
  },
  {
    title: 'Tell us about the project and pick a time',
    body: 'A few quick questions, then choose a time that suits you. There is no account to create.',
  },
  {
    title: 'Discuss the estimate',
    body: 'We give you an estimate: a price range for the work. When the scope is agreed and you want to go ahead, a full quote follows.',
  },
]

function RouteChoice({ route, minutes }: { route: Route; minutes: number | null }) {
  return (
    <Link
      to={`/enquire?type=${route}`}
      className="border-action bg-background hover:bg-soft flex min-h-12 items-center gap-4 rounded-md border-2 px-5 py-4 transition-colors duration-150 motion-reduce:transition-none"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-title text-ink font-medium">{routeTitle(route, minutes)}</span>
        <span className="text-muted-foreground">{ROUTE_COPY[route].blurb}</span>
      </span>
      <ArrowRight className="text-ink size-5 shrink-0" aria-hidden="true" />
    </Link>
  )
}

export function LandingPage() {
  const location = useLocation()
  const howRef = useRef<HTMLHeadingElement>(null)
  const types = usePublicAppointmentTypes()
  // A route with no active appointment type is left out, once we know (never both).
  const offered = ROUTES.filter((r) => !types.data || minutesFor(types.data, r) !== null)
  const routes = offered.length > 0 ? offered : ROUTES

  // "How it works" in the header links here with state; move to the section and its heading.
  useEffect(() => {
    if ((location.state as { section?: string } | null)?.section === 'how-it-works') {
      howRef.current?.scrollIntoView({ block: 'start' })
      howRef.current?.focus()
    }
  }, [location.state, location.key])

  return (
    <PublicLayout width="page">
      <section aria-labelledby="intro-heading" className="bg-soft">
        <div className="max-w-page mx-auto flex flex-col gap-6 px-6 py-10 md:px-10 md:py-20">
          <h1
            id="intro-heading"
            className="text-display text-ink max-w-prose font-medium break-words hyphens-auto"
          >
            Let’s talk about your renovation.
          </h1>
          <nav aria-label="Book a free appointment" className="max-w-form flex flex-col gap-3">
            {routes.map((route) => (
              <RouteChoice key={route} route={route} minutes={minutesFor(types.data, route)} />
            ))}
          </nav>
          <p className="text-body text-ink font-medium">Both are free.</p>
          {LANDING_PHOTO && (
            <img
              src={LANDING_PHOTO.src}
              alt={LANDING_PHOTO.alt}
              width={LANDING_PHOTO.width}
              height={LANDING_PHOTO.height}
              className="max-w-form h-auto w-full rounded-md"
            />
          )}
        </div>
      </section>

      <section aria-labelledby="how-it-works" className="bg-background">
        <div className="max-w-page mx-auto px-6 py-12 md:px-10 md:py-24">
          <h2
            id="how-it-works"
            ref={howRef}
            tabIndex={-1}
            className="text-section text-ink font-medium outline-none"
          >
            How it works
          </h2>
          <ol className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-12">
            {steps.map((step, index) => (
              <li key={step.title} className="flex max-w-prose min-w-0 gap-4 md:flex-col">
                <span
                  aria-hidden="true"
                  className="bg-action flex size-10 shrink-0 items-center justify-center rounded-full text-base font-medium text-white"
                >
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-title text-ink font-medium">{step.title}</h3>
                  <p className="text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="border-action bg-soft text-ink mt-10 max-w-prose border-l-4 px-4 py-3">
            A site visit is for us to assess and price the work. Booking one does not commit you to
            a quote, and it is not a start date.
          </p>
        </div>
      </section>
    </PublicLayout>
  )
}
