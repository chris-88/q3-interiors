import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { initAttribution } from './lib/attribution'
import { safeStorage } from './lib/storage'

// Read campaign tags from the arrival URL before anything navigates.
initAttribution(safeStorage('local'))

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
)
