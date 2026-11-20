import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { PublicLayout } from '@/components/public-layout'
import { buttonVariants } from '@/components/ui/button'
import { business } from '@/config/business'
import { cn } from '@/lib/utils'

const steps = [
  {
    title: 'Tell us about your project',
    body: 'A few questions about the work, where it is and when you would like it done. It takes two or three minutes and there is no account to create.',
  },
  {
    title: 'We get in touch',
    body: 'We will contact you to talk it through. Where it makes sense, we arrange a visit to see the space, take measurements and give you an estimated range.',
  },
  {
    title: 'A full quote, if you want one',
    body: 'If the estimate suits you, we prepare a detailed quote for the work.',
  },
]

export function LandingPage() {
  return (
    <PublicLayout>
      <section className="flex flex-col gap-5">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
          Planning a renovation? Tell us what you have in mind.
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {business.name} carries out home renovations that involve several trades.
          {business.serviceArea ? ` We work in ${business.serviceArea}.` : ''}
        </p>
        <Link
          to="/enquire"
          className={cn(buttonVariants({ size: 'lg' }), 'h-12 w-full text-base sm:w-auto sm:px-6')}
        >
          Tell us about your project
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </section>

      <section aria-labelledby="next-heading" className="mt-12">
        <h2 id="next-heading" className="text-lg font-semibold tracking-tight">
          What happens next
        </h2>
        <ol className="mt-5 flex flex-col gap-6">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="font-medium">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="bg-muted text-muted-foreground mt-8 rounded-lg px-4 py-3 text-sm leading-relaxed">
          An estimate visit is for us to assess and price the work. Booking one does not commit you
          to a quote, and it is not a start date.
        </p>
      </section>
    </PublicLayout>
  )
}
