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
  it('shows the landing page with one enquiry action and the estimate disclaimer', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('renovation')
    expect(screen.getByRole('link', { name: 'Tell us about your project' })).toHaveAttribute(
      'href',
      '/enquire',
    )
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
