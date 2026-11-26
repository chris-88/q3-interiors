import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router'
import './index.css'
import { DataShapeError } from './lib/tolerant'

/*
 * Two builds from one codebase, chosen at build time (VITE_SURFACE): the customer site
 * (book.q3interiors.ie) and the staff console (staff.q3interiors.ie). The flag is replaced with a
 * literal, so the other surface's branch, and its whole module graph, is left out of the bundle.
 * (The one read of import.meta.env outside src/lib/env.ts: it must be a literal at build time.)
 */
const STAFF = import.meta.env.VITE_SURFACE === 'staff'
const App = STAFF ? lazy(() => import('./StaffApp.tsx')) : lazy(() => import('./App.tsx'))

// Customer site: read campaign tags and a website link's entry parameters from the arrival
// address, and tidy it, before the router reads it (src/customer-boot.ts). The staff build skips
// it entirely.
const ready: Promise<void> = STAFF
  ? Promise.resolve()
  : import('./customer-boot.ts').then(
      (m) => m.bootCustomer(),
      () => undefined, // never block the page on it
    )

// Data this build cannot read will not read better on a retry: fail at once (the staff console
// then checks for a newer build); other failures keep TanStack's default three retries.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, error) => !(error instanceof DataShapeError) && count < 3 },
  },
})

void ready.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <Suspense fallback={null}>
            <App />
          </Suspense>
        </HashRouter>
      </QueryClientProvider>
    </StrictMode>,
  ),
)
