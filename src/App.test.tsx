import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the name and a button', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Q3 Interiors' })).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
