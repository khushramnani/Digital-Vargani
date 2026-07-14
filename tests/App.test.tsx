import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/app/App'
import { strings } from '../src/lib/strings'

describe('App', () => {
  it('renders the app shell home route', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: strings.appName })).toBeInTheDocument()
    expect(screen.getByText(strings.appTagline)).toBeInTheDocument()
  })
})
