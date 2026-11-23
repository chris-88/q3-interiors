import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { business } from '@/config/business'

/** Shell for customer-facing pages: a quiet wordmark, a narrow column, and a short footer. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <header className="mx-auto w-full max-w-xl px-5 pt-5">
        <Link
          to="/"
          className="focus-visible:ring-ring/50 text-sm font-semibold tracking-tight focus-visible:rounded-sm focus-visible:ring-3 focus-visible:outline-none"
        >
          {business.name}
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pt-6 pb-10">
        {children}
      </main>
      <footer className="text-muted-foreground mx-auto w-full max-w-xl px-5 pb-8 text-xs leading-relaxed">
        <p>
          We use the details you give us only to reply to your enquiry. We will only send you news
          or offers if you ask us to.{' '}
          <Link to="/privacy" className="underline underline-offset-4">
            How we use your details
          </Link>
        </p>
        {(business.contactEmail ?? business.contactPhone) && (
          <p className="mt-2">
            Contact: {[business.contactEmail, business.contactPhone].filter(Boolean).join(' · ')}
          </p>
        )}
      </footer>
    </div>
  )
}
