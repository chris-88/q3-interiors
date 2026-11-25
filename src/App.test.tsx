import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
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
  it('shows the landing page: the two free choices, how it works, no "Our work"', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Let’s talk about your renovation.',
    )
    const choices = screen.getByRole('navigation', { name: 'Book a free appointment' })
    const links = within(choices).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/enquire?type=phone',
      '/enquire?type=on_site',
    ])
    expect(links[0]).toHaveTextContent('Talk through your plans.')
    expect(links[1]).toHaveTextContent('Show us the space so we can measure up for an estimate.')
    expect(screen.getByText('Both are free.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument()
    expect(screen.queryByText(/our work/i)).not.toBeInTheDocument()
    // No landing photo is configured yet, and no empty slot stands in for one.
    expect(screen.queryAllByRole('img').filter((i) => i.getAttribute('alt'))).toHaveLength(1)
    // The header is the full wordmark alone: decorative image, no visible name beside it.
    const home = screen.getByRole('link', { name: 'Q3 Interiors home' })
    expect(home).toHaveAttribute('href', '/')
    expect(home).toHaveTextContent('')
    expect(home.querySelector('img')).toHaveAttribute('src', '/brand/q3-full-black.svg')
    expect(home.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByText(/does not commit you to a quote/)).toBeInTheDocument()
  })

  it('takes the landing choice into the Project screen', async () => {
    renderAt('/enquire?type=on_site')
    expect(screen.getByRole('heading', { name: 'What work are you planning?' })).toBeInTheDocument()
    expect(screen.getByText(/Site visit, free\./)).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Project')
  })

  it('sends a customer with no route chosen back to the landing page', () => {
    renderAt('/enquire')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('renovation')
  })

  it('shows a visible, accessible error when a required question is skipped', async () => {
    renderAt('/enquire?type=phone')
    await userEvent.click(screen.getByRole('button', { name: 'Continue to your details' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent)).toEqual(['Choose an option.', 'This is required.'])
  })

  it('reveals each follow-up in place, required only for "Something else"', async () => {
    renderAt('/enquire?type=phone')
    expect(screen.queryByLabelText(/Which rooms/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Kitchen' }))
    expect(
      screen.getByRole('group', {
        name: /Are you keeping the layout or changing it\? ?\(optional\)/,
      }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Several rooms' }))
    expect(screen.getByLabelText(/Which rooms are involved\? ?\(optional\)/)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Keeping it' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Something else' }))
    expect(screen.getByLabelText('What would you like us to look at?')).toBeRequired()
  })

  it('does not show a confirmation without a saved enquiry', () => {
    renderAt('/enquire/sent')
    expect(screen.getByRole('heading', { name: 'No enquiry to show' })).toBeInTheDocument()
  })
})
