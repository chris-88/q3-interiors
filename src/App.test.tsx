import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import App from './App'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => window.sessionStorage.clear())

describe('App', () => {
  it('shows the landing page: guide heading, one action (repeated), how it works, no "Our work"', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Planning a home renovation?',
    )
    const actions = screen.getAllByRole('link', { name: 'Tell us about your project' })
    expect(actions.length).toBeGreaterThan(0)
    for (const a of actions) expect(a).toHaveAttribute('href', '/enquire')
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument()
    expect(screen.queryByText(/our work/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Q3 Interiors home' })).toHaveAttribute('href', '/')
    // The header is the full wordmark alone: decorative image, no visible name beside it.
    const home = screen.getByRole('link', { name: 'Q3 Interiors home' })
    expect(home).toHaveTextContent('')
    expect(home.querySelector('img')).toHaveAttribute('src', '/brand/q3-full-black.svg')
    expect(home.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByText(/does not commit you to a quote/)).toBeInTheDocument()
  })

  it('shows a visible, accessible error when a required question is skipped', async () => {
    renderAt('/enquire')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an option.')
  })

  it('asks the conditional question only when it applies', async () => {
    renderAt('/enquire')
    expect(screen.queryByLabelText('What kind of project?')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Something else' }))
    expect(await screen.findByLabelText('What kind of project?')).toBeInTheDocument()
  })

  it('does not show a confirmation without a saved enquiry', () => {
    renderAt('/enquire/sent')
    expect(screen.getByRole('heading', { name: 'No enquiry to show' })).toBeInTheDocument()
  })
})
