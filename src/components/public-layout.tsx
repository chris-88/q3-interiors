import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { usePublicBusiness } from '@/api/business'
import { cn } from '@/lib/utils'

/**
 * Home link per the brand guide (v2.0): the full wordmark only, about 144px wide on phones (the
 * guide's minimum for a legible name) and 160px from 768px, inside a link at least 48px high. The
 * link is named "Q3 Interiors home" and the image is decorative.
 */
function HomeLink() {
  return (
    <Link
      to="/"
      aria-label="Q3 Interiors home"
      className="inline-flex min-h-12 items-center rounded-sm p-2 md:p-3"
    >
      <img
        src="/brand/q3-full-black.svg"
        width={160}
        height={61}
        alt=""
        className="block h-auto w-36 md:w-40"
      />
    </Link>
  )
}

function Footer() {
  const business = usePublicBusiness()
  const contact = [business.contact_phone, business.contact_email].filter((v): v is string =>
    Boolean(v),
  )
  return (
    <footer className="on-panel bg-panel text-on-panel">
      <div className="max-w-page mx-auto flex w-full flex-col gap-8 px-5 py-12 md:flex-row md:items-start md:gap-16 md:px-10">
        {/* The white wordmark on the black panel, at the header's displayed width. */}
        <img
          src="/brand/q3-full-white.svg"
          width={160}
          height={61}
          alt="Q3 Interiors"
          className="block h-[61px] w-40 shrink-0 self-start"
        />
        <div className="flex max-w-prose flex-col gap-3 text-sm leading-relaxed">
          {contact.length > 0 && <p>Contact: {contact.join(' · ')}</p>}
          {business.service_area && <p>We work in {business.service_area}.</p>}
          <p>
            We use the details you give us only to reply to your enquiry. We only send news or
            offers if you ask us to.
          </p>
          <p>
            <Link to="/privacy" className="text-on-panel underline">
              How we use your details
            </Link>
          </p>
        </div>
      </div>
    </footer>
  )
}

/**
 * Shell for customer-facing pages. `width="form"` (default) keeps a 640px reading column;
 * `width="page"` lets the page lay out full-width sections itself (the landing page).
 */
export function PublicLayout({
  children,
  width = 'form',
}: {
  children: ReactNode
  width?: 'form' | 'page'
}) {
  const { pathname } = useLocation()
  // The header's enquiry action is for browsing pages, not the journey itself.
  const showAction = pathname === '/' || pathname === '/privacy'
  return (
    <div className="bg-background text-body text-foreground flex min-h-svh flex-col">
      <header className="border-rule border-b">
        <div className="max-w-page mx-auto flex w-full items-center justify-between gap-4 px-3 md:px-6">
          <HomeLink />
          {showAction && (
            <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
              <Link
                to="/"
                state={{ section: 'how-it-works' }}
                className="text-primary inline-flex min-h-12 items-center text-base font-medium underline"
              >
                How it works
              </Link>
              <Link
                to="/enquire"
                className={cn(buttonVariants({ size: 'lg' }), 'h-12 px-6 text-base')}
              >
                Tell us about your project
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main
        className={cn(
          'flex w-full flex-1 flex-col',
          width === 'form' && 'max-w-form mx-auto px-5 pt-8 pb-16 md:pt-12',
        )}
      >
        {children}
      </main>
      <Footer />
    </div>
  )
}
