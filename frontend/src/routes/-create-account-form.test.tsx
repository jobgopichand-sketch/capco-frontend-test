import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '../test/server'

import { CreateAccountForm } from './-create-account-form'

const endpoint = '/api/v1/applicant-accounts'

async function enterValidCredentials() {
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Email address'),
    'applicant@example.com',
  )
  await user.type(screen.getByLabelText('Password'), 'Strong!1')
  await user.type(screen.getByLabelText('Confirm password'), 'Strong!1')
  return user
}

describe('CreateAccountForm API contract', () => {
  it('shows required-field errors and does not submit empty credentials', async () => {
    let requestReceived = false
    server.use(
      http.post(endpoint, () => {
        requestReceived = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    render(<CreateAccountForm />)

    fireEvent.submit(
      screen.getByRole('button', { name: 'Create account' }).closest('form')!,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter your email address.',
    )
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Email address'))
    expect(requestReceived).toBe(false)
  })

  it('rejects malformed email addresses before making a request', async () => {
    const user = userEvent.setup()
    let requestReceived = false
    server.use(
      http.post(endpoint, () => {
        requestReceived = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    render(<CreateAccountForm />)

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'Strong!1')
    await user.type(screen.getByLabelText('Confirm password'), 'Strong!1')
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create account' }).closest('form')!,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid email address.',
    )
    expect(requestReceived).toBe(false)
  })

  it('validates the documented password policy before making a request', async () => {
    const user = userEvent.setup()
    let requestReceived = false
    server.use(
      http.post(endpoint, () => {
        requestReceived = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    render(<CreateAccountForm />)

    await user.type(
      screen.getByLabelText('Email address'),
      'applicant@example.com',
    )
    await user.type(screen.getByLabelText('Password'), 'weak')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use at least six characters, including one uppercase letter and one special character.',
    )
    expect(requestReceived).toBe(false)
  })

  it('requires password confirmation to match before making a request', async () => {
    const user = userEvent.setup()
    let requestReceived = false
    server.use(
      http.post(endpoint, () => {
        requestReceived = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    render(<CreateAccountForm />)

    await user.type(
      screen.getByLabelText('Email address'),
      'applicant@example.com',
    )
    await user.type(screen.getByLabelText('Password'), 'Strong!1')
    await user.type(screen.getByLabelText('Confirm password'), 'Different!1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Passwords do not match.',
    )
    expect(document.activeElement).toBe(
      screen.getByLabelText('Confirm password'),
    )
    expect(requestReceived).toBe(false)
  })

  it('sends the JSON:API registration document and confirms account creation without signing in', async () => {
    let requestContentType: string | null = null
    let requestBody: unknown
    server.use(
      http.post(endpoint, async ({ request }) => {
        requestContentType = request.headers.get('Content-Type')
        requestBody = await request.json()
        return new HttpResponse(null, { status: 201 })
      }),
    )
    render(<CreateAccountForm />)
    await enterValidCredentials()
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    )

    expect(
      await screen.findByText(
        'Your account has been created. You can now sign in.',
      ),
    ).toBeInTheDocument()
    expect(requestContentType).toBe('application/vnd.api+json')
    expect(requestBody).toEqual({
      data: {
        type: 'applicant-accounts',
        attributes: {
          email: 'applicant@example.com',
          password: 'Strong!1',
        },
      },
    })
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Confirm password')).toHaveValue('')
  })

  it('announces pending state and submits only once while a request is in flight', async () => {
    let requestCount = 0
    let releaseResponse: (() => void) | undefined
    const responsePending = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    server.use(
      http.post(endpoint, async () => {
        requestCount += 1
        await responsePending
        return new HttpResponse(null, { status: 201 })
      }),
    )
    render(<CreateAccountForm />)
    await enterValidCredentials()

    const form = screen.getByRole('form', { name: 'Create your account' })
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => {
      expect(requestCount).toBe(1)
    })
    expect(form).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Creating your account',
    )
    expect(
      screen.getByRole('button', { name: 'Creating account…' }),
    ).toBeDisabled()
    expect(screen.getByLabelText('Email address')).toBeDisabled()

    await act(async () => {
      releaseResponse?.()
    })

    expect(
      await screen.findByText(
        'Your account has been created. You can now sign in.',
      ),
    ).toBeInTheDocument()
    expect(form).toHaveAttribute('aria-busy', 'false')
  })

  it('maps API validation errors to the related credential fields', async () => {
    server.use(
      http.post(endpoint, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: '400',
                code: 'validation-failed',
                detail: 'Use a different email address.',
                source: { pointer: '/data/attributes/email' },
              },
            ],
          },
          {
            status: 400,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        ),
      ),
    )
    render(<CreateAccountForm />)
    await enterValidCredentials()
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use a different email address.',
    )
  })

  it('provides specific feedback for duplicate accounts and rate limits', async () => {
    const user = userEvent.setup()
    let status = 409
    let includeRetryAfter = true
    server.use(
      http.post(endpoint, () =>
        status === 409
          ? HttpResponse.json({ errors: [] }, { status })
          : HttpResponse.json(
              { errors: [] },
              {
                status,
                headers: includeRetryAfter ? { 'Retry-After': '30' } : {},
              },
            ),
      ),
    )
    render(<CreateAccountForm />)
    await enterValidCredentials()
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(
      await screen.findByText(
        'An account already exists for this email address. Try signing in instead.',
      ),
    ).toBeInTheDocument()

    status = 429
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(
      await screen.findByText(
        'Too many attempts. Please try again in 30 seconds.',
      ),
    ).toBeInTheDocument()

    includeRetryAfter = false
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(
      await screen.findByText('Too many attempts. Please try again later.'),
    ).toBeInTheDocument()
  })

  it('maps multiple attribute errors and reports errors without a field pointer', async () => {
    server.use(
      http.post(endpoint, () =>
        HttpResponse.json(
          {
            errors: [
              {
                detail: 'Use a different email address.',
                source: { pointer: '/data/attributes/email' },
              },
              {
                title: 'Email format rejected',
                source: { pointer: '/data/attributes/email' },
              },
              {
                detail: 'Password was rejected.',
                source: { pointer: '/data/attributes/password' },
              },
              {
                detail: 'The request document was malformed.',
              },
            ],
          },
          { status: 400 },
        ),
      ),
    )
    render(<CreateAccountForm />)
    await enterValidCredentials()
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request document was malformed.',
    )
    expect(screen.getByLabelText('Email address')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(
      screen.getByText('Use a different email address. Email format rejected'),
    ).toBeInTheDocument()
    expect(screen.getByText('Password was rejected.')).toBeInTheDocument()
  })

  it('explains documented media errors and unexpected server responses', async () => {
    const user = userEvent.setup()
    let status = 406
    server.use(
      http.post(endpoint, () =>
        status === 400
          ? new HttpResponse('not-json', { status })
          : HttpResponse.json({ errors: [] }, { status }),
      ),
    )
    render(<CreateAccountForm />)
    await enterValidCredentials()

    const cases = [
      [
        406,
        'The service could not provide the required response format. Please try again later.',
      ],
      [
        415,
        'The service did not accept the registration request format. Please try again later.',
      ],
      [503, 'We could not create your account. Please try again later.'],
      [400, 'We could not validate your details. Please try again.'],
    ] as const

    for (const [responseStatus, message] of cases) {
      status = responseStatus
      await user.click(screen.getByRole('button', { name: 'Create account' }))
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(message)
      })
    }
  })

  it('shows a useful message when the registration request cannot reach the service', async () => {
    server.use(http.post(endpoint, () => HttpResponse.error()))
    render(<CreateAccountForm />)
    await enterValidCredentials()
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create account' }).closest('form')!,
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          'We could not reach the service. Check your connection and try again.',
        ),
      ).toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByRole('alert'))
  })
})
