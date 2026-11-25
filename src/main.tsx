import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router'
import './index.css'
import { initAttribution } from './lib/attribution'
import { safeStorage } from './lib/storage'

/*
 * Two builds from one codebase, chosen at build time (VITE_SURFACE): the customer site
 * (book.q3interiors.ie) and the staff console (staff.q3interiors.ie). The flag is replaced with a
 * literal, so the other surface's branch, and its whole module graph, is left out of the bundle.
 * (The one read of import.meta.env outside src/lib/env.ts: it must be a literal at build time.)
 */
const STAFF = import.meta.env.VITE_SURFACE === 'staff'
const App = STAFF ? lazy(() => import('./StaffApp.tsx')) : lazy(() => import('./App.tsx'))

// Read campaign tags from the arrival URL before anything navigates (customer site only).
if (!STAFF) initAttribution(safeStorage('local'))

const queryClient = new QueryClient()

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
)
