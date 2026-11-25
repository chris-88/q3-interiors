import { useEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { PublicLayout } from '@/components/public-layout'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/*
 * Landing page per the brand guide, section 4: a text-led introduction (no project photography
 * until approved photos exist, so no "Our work" section or link), how it works from the real
 * journey, and the action repeated at the end.
 */

const steps = [
  {
    title: 'Tell us about your project',
    body: 'Describe the work you have in mind, where it is and when you would like it done. It takes two or three minutes and there is no account to create.',
  },
  {
    title: 'Arrange a call or a site visit',
    body: 'Choose a time for a phone call to talk it through, or for us to visit, see the space and take measurements.',
  },
  {
    title: 'Discuss the estimate',
    body: 'We give you an estimate: a price range for the work. When the scope is agreed and you want to go ahead, a full quote follows.',
  },
]

function MainAction({ className }: { className?: string }) {
  return (
    <Link
      to="/enquire"
      className={cn(
        buttonVariants({ size: 'lg' }),
        'h-auto min-h-12 px-6 py-3 text-base whitespace-normal',
        className,
      )}
    >
      Tell us about your project
      <ArrowRight data-icon="inline-end" aria-hidden="true" />
    </Link>
  )
}

export function LandingPage() {
  const location = useLocation()
  const howRef = useRef<HTMLHeadingElement>(null)

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
        <div className="max-w-page mx-auto flex flex-col gap-6 px-5 py-12 md:px-10 md:py-24">
          <h1 id="intro-heading" className="text-display text-ink max-w-prose font-medium">
            Planning a home renovation?
          </h1>
          <p className="text-body text-ink max-w-prose">
            We coordinate the trades, visit your home and prepare an estimate for the work you have
            in mind.
          </p>
          <div>
            <MainAction />
          </div>
        </div>
      </section>

      <section aria-labelledby="how-it-works" className="bg-background">
        <div className="max-w-page mx-auto px-5 py-12 md:px-10 md:py-24">
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

      <section aria-labelledby="final-heading" className="border-rule bg-background border-t">
        <div className="max-w-page mx-auto flex flex-col items-start gap-6 px-5 py-12 md:px-10 md:py-16">
          <h2 id="final-heading" className="text-section text-ink font-medium">
            Ready to tell us about it?
          </h2>
          <MainAction />
        </div>
      </section>
    </PublicLayout>
  )
}
