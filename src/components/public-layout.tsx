import { useId, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { usePublicBusiness } from '@/api/business'
import { readEntry } from '@/lib/entry'
import { safeStorage } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { WEBSITE_URL } from '@/lib/website'

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
 * The form screens' footer: small Contact and Privacy links instead of the black panel. Contact
 * opens the confirmed business details in place; with none confirmed it is left out.
 */
function FormFooter() {
  const business = usePublicBusiness()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const phone = business.contact_phone
  const email = business.contact_email
  const hasContact = Boolean(phone || email)
  return (
    <footer className="border-rule border-t">
      <div className="max-w-form mx-auto w-full px-6 py-4">
        <nav aria-label="Help" className="flex flex-wrap items-center gap-x-6">
          {hasContact && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
              className="text-muted-foreground inline-flex min-h-12 items-center text-sm underline underline-offset-4"
            >
              Contact
            </button>
          )}
          <Link
            to="/privacy"
            className="text-muted-foreground inline-flex min-h-12 items-center text-sm underline underline-offset-4"
          >
            Privacy
          </Link>
        </nav>
        {hasContact && open && (
          <div id={panelId} className="text-ink flex flex-col gap-1 pb-2 text-sm">
            <p className="font-medium">{business.trading_name}</p>
            {phone && (
              <p>
                Phone:{' '}
                <a
                  className="underline underline-offset-4"
                  href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                >
                  {phone}
                </a>
              </p>
            )}
            {email && (
              <p>
                Email:{' '}
                <a className="underline underline-offset-4" href={`mailto:${email}`}>
                  {email}
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </footer>
  )
}

/**
 * Shell for customer-facing pages. `width="form"` (default) keeps a 640px reading column with
 * 24px side margins and the small Contact/Privacy footer (the journey's form screens);
 * `width="page"` lets the page lay out full-width sections itself, with the black footer (the
 * landing page); `width="prose"` is a reading page (privacy) with the black footer.
 */
export function PublicLayout({
  children,
  width = 'form',
}: {
  children: ReactNode
  width?: 'form' | 'page' | 'prose'
}) {
  const { pathname } = useLocation()
  // Visitors who came from the website get a quiet way back; everyone else sees no change.
  const [fromWebsite] = useState(() => readEntry(safeStorage('session')).fromWebsite)
  return (
    <div className="bg-background text-body text-foreground flex min-h-svh flex-col">
      <header className="border-rule border-b">
        <div className="max-w-page mx-auto flex w-full items-center justify-between gap-4 px-3 md:px-6">
          <HomeLink />
          {fromWebsite && (
            <a
              href={WEBSITE_URL}
              className="text-muted-foreground ms-auto inline-flex min-h-12 items-center text-sm underline underline-offset-4 md:order-last"
            >
              Back to q3interiors.ie
            </a>
          )}
          {pathname === '/' && (
            <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
              <Link
                to="/"
                state={{ section: 'how-it-works' }}
                className="text-primary inline-flex min-h-12 items-center text-base font-medium underline"
              >
                How it works
              </Link>
            </nav>
          )}
          {pathname === '/privacy' && (
            <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
              <Link to="/" className={cn(buttonVariants({ size: 'lg' }), 'h-12 px-6 text-base')}>
                Book a free call or visit
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main
        className={cn(
          'flex w-full flex-1 flex-col',
          width !== 'page' && 'max-w-form mx-auto px-6 pt-6 pb-12 md:pt-10',
        )}
      >
        {children}
      </main>
      {width === 'form' ? <FormFooter /> : <Footer />}
    </div>
  )
}
