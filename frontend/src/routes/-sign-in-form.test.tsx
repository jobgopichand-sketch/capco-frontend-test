import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { server } from '../test/server'

import { SignInForm } from './-sign-in-form'

const sessionEndpoint = '/api/v1/applicant-sessions'

async function enterValidCredentials() {
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('textbox', { name: 'Email address' }),
    'applicant@example.com',
  )
  await user.type(screen.getByLabelText('Password'), 'Secret!1')
  return user
}

describe('SignInForm', () => {
  it('renders a named form with required email and password fields', () => {
    render(<SignInForm onSuccess={vi.fn()} />)

    const form = screen.getByRole('form', { name: 'Welcome back' })
    const email = screen.getByRole('textbox', { name: 'Email address' })
    const password = screen.getByLabelText('Password')

    expect(form).toContainElement(email)
    expect(form).toContainElement(password)
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toBeRequired()
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toBeRequired()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows required-field errors and does not continue with empty credentials', async () => {
    const onSuccess = vi.fn()
    render(<SignInForm onSuccess={onSuccess} />)

    fireEvent.submit(screen.getByRole('form', { name: 'Welcome back' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter your email address.',
    )
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Email address' }),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('requires a password when the email is present', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<SignInForm onSuccess={onSuccess} />)

    await user.type(
      screen.getByRole('textbox', { name: 'Email address' }),
      'applicant@example.com',
    )
    fireEvent.submit(screen.getByRole('form', { name: 'Welcome back' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter your password.',
    )
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Password'))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('submits credentials using the JSON:API session request contract', async () => {
    let requestContentType: string | null = null
    let requestAccept: string | null = null
    let requestBody: unknown
    server.use(
      http.post(sessionEndpoint, async ({ request }) => {
        requestContentType = request.headers.get('Content-Type')
        requestAccept = request.headers.get('Accept')
        requestBody = await request.json()
        return HttpResponse.json(
          {
            data: {
              type: 'applicant-sessions',
              id: 'public-session-id',
              attributes: { href: '/applications/identity-and-address' },
            },
          },
          {
            status: 201,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        )
      }),
    )
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(
      <SignInForm onSuccess={onSuccess} returnTo="/applications/current" />,
    )

    await user.type(
      screen.getByRole('textbox', { name: 'Email address' }),
      'applicant@example.com',
    )
    await user.type(screen.getByLabelText('Password'), 'Secret!1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        '/applications/identity-and-address',
      )
    })
    expect(requestContentType).toBe('application/vnd.api+json')
    expect(requestAccept).toBe('application/vnd.api+json')
    expect(requestBody).toEqual({
      data: {
        type: 'applicant-sessions',
        attributes: {
          email: 'applicant@example.com',
          password: 'Secret!1',
        },
      },
    })
  })

  it('rejects malformed or unsafe successful session responses', async () => {
    let responseBody: Record<string, unknown> = { data: {} }
    server.use(
      http.post(sessionEndpoint, () =>
        HttpResponse.json(responseBody, { status: 201 }),
      ),
    )
    render(<SignInForm onSuccess={vi.fn()} />)
    const user = await enterValidCredentials()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sign-in response was invalid. Please try again.',
    )

    responseBody = {
      data: {
        attributes: { href: 'https://example.com/applications/current' },
      },
    }
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sign-in response contained an invalid destination.',
    )
  })

  it('uses the same generic message for invalid credentials and keeps the email', async () => {
    let detail = 'Invalid email or password'
    server.use(
      http.post(sessionEndpoint, () =>
        HttpResponse.json(
          { errors: [{ detail }] },
          {
            status: 401,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        ),
      ),
    )
    render(<SignInForm onSuccess={vi.fn()} />)
    const user = await enterValidCredentials()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password is incorrect. Please try again.',
    )
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveValue(
      'applicant@example.com',
    )

    detail = 'No account exists for this email'
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password is incorrect. Please try again.',
    )
    expect(screen.queryByText(/account exists/i)).not.toBeInTheDocument()
  })

  it('announces pending state, prevents duplicate submissions, and restores retry after failure', async () => {
    let requestCount = 0
    let releaseResponse: (() => void) | undefined
    const pendingResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    server.use(
      http.post(sessionEndpoint, async () => {
        requestCount += 1
        await pendingResponse
        return HttpResponse.json({ errors: [] }, { status: 401 })
      }),
    )
    render(<SignInForm onSuccess={vi.fn()} />)
    await enterValidCredentials()

    const form = screen.getByRole('form', { name: 'Welcome back' })
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => {
      expect(requestCount).toBe(1)
    })
    expect(form).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Signing in')
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
    expect(screen.getByLabelText('Password')).toBeDisabled()

    await act(async () => {
      releaseResponse?.()
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email or password is incorrect. Please try again.',
    )
    expect(document.activeElement).toBe(screen.getByRole('alert'))
    expect(form).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveValue(
      'applicant@example.com',
    )
  })

  it('maps malformed credential responses to fields or a form-level error', async () => {
    let body: {
      errors: Array<{ detail: string; source?: { pointer?: string } }>
    } = {
      errors: [
        {
          detail: 'Enter a valid email address.',
          source: { pointer: '/data/attributes/email' },
        },
        {
          detail: 'Enter your password.',
          source: { pointer: '/data/attributes/password' },
        },
      ],
    }
    server.use(
      http.post(sessionEndpoint, () =>
        HttpResponse.json(body, { status: 400 }),
      ),
    )
    render(<SignInForm onSuccess={vi.fn()} />)
    const user = await enterValidCredentials()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid email address.',
    )
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveValue(
      'applicant@example.com',
    )

    body = { errors: [{ detail: 'The request document was malformed.' }] }
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request document was malformed.',
    )
  })

  it('shows rate-limit guidance with and without Retry-After', async () => {
    let retryAfter: string | null = '45'
    server.use(
      http.post(sessionEndpoint, () =>
        HttpResponse.json(
          { errors: [] },
          {
            status: 429,
            headers: retryAfter ? { 'Retry-After': retryAfter } : {},
          },
        ),
      ),
    )
    render(<SignInForm onSuccess={vi.fn()} />)
    const user = await enterValidCredentials()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many sign-in attempts. Please try again in 45 seconds.',
    )

    retryAfter = null
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many sign-in attempts. Please try again later.',
    )
  })

  it('shows useful feedback for network, malformed, and unexpected responses', async () => {
    let mode: 'network' | 'malformed' | 'unexpected' = 'network'
    server.use(
      http.post(sessionEndpoint, () => {
        if (mode === 'network') {
          return HttpResponse.error()
        }
        if (mode === 'malformed') {
          return new HttpResponse('not-json', { status: 400 })
        }
        return HttpResponse.json({ errors: [] }, { status: 503 })
      }),
    )
    render(<SignInForm onSuccess={vi.fn()} />)
    const user = await enterValidCredentials()
    const email = screen.getByRole('textbox', { name: 'Email address' })

    const cases = [
      [
        'network',
        'We could not reach the service. Check your connection and try again.',
      ],
      [
        'malformed',
        'The sign-in details could not be validated. Please try again.',
      ],
      [
        'unexpected',
        'We could not sign you in due to a service issue. Please try again later.',
      ],
    ] as const
    for (const [nextMode, message] of cases) {
      mode = nextMode
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(email).toHaveValue('applicant@example.com')
    }
  })

  it('preserves the applicant journey destination in the create-account link', () => {
    const onNavigate = vi.fn()
    const returnTo = '/applications/current'
    render(
      <SignInForm
        onNavigate={onNavigate}
        onSuccess={vi.fn()}
        returnTo={returnTo}
      />,
    )

    const createAccountLink = screen.getByRole('link', {
      name: 'Create account',
    })
    expect(createAccountLink).toHaveAttribute(
      'href',
      '/create-account?returnTo=%2Fapplications%2Fcurrent',
    )

    fireEvent.click(createAccountLink)
    expect(onNavigate).toHaveBeenCalledWith(
      '/create-account?returnTo=%2Fapplications%2Fcurrent',
    )
  })
})
