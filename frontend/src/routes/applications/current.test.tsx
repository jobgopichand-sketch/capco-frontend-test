import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

import { server } from '../../test/server'

import { CurrentApplicationJourneyView } from './current'

const applicationId = '00000000-0000-4000-8000-000000000001'

function LocationOutput() {
  const location = useLocation()
  return <output aria-label="Current path">{location.pathname}</output>
}

function renderJourney(
  loaderData:
    | { kind: 'none' }
    | {
        kind: 'draft'
        application: {
          id: string
          currentStep: 'personal-details' | 'identity-and-address'
          progress: Array<{
            step: 'personal-details' | 'identity-and-address'
            state: 'not-started' | 'current' | 'complete'
          }>
        }
      },
) {
  return render(
    <MemoryRouter>
      <CurrentApplicationJourneyView loaderData={loaderData} />
      <LocationOutput />
    </MemoryRouter>,
  )
}

describe('current application route flow', () => {
  it('creates a draft when none exists and navigates to its current step', async () => {
    const user = userEvent.setup()
    let requestMethod = ''
    server.use(
      http.post('/api/v1/applicant-applications', ({ request }) => {
        requestMethod = request.method
        return HttpResponse.json(
          {
            data: {
              type: 'applicant-applications',
              id: applicationId,
              attributes: {
                status: 'draft',
                currentStep: 'identity-and-address',
                href: `/applications/${applicationId}/identity-and-address`,
                progress: [
                  { step: 'personal-details', state: 'complete' },
                  { step: 'identity-and-address', state: 'current' },
                ],
              },
            },
          },
          { status: 201 },
        )
      }),
    )
    renderJourney({ kind: 'none' })

    await user.click(screen.getByRole('button', { name: 'Start application' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Current path')).toHaveTextContent(
        `/applications/${applicationId}/identity-and-address`,
      )
    })
    expect(requestMethod).toBe('POST')
  })

  it('resumes an existing draft at the API-reported current step', async () => {
    const user = userEvent.setup()
    renderJourney({
      kind: 'draft',
      application: {
        id: applicationId,
        currentStep: 'identity-and-address',
        progress: [
          { step: 'personal-details', state: 'complete' },
          { step: 'identity-and-address', state: 'current' },
        ],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Resume application' }))

    expect(screen.getByLabelText('Current path')).toHaveTextContent(
      `/applications/${applicationId}/identity-and-address`,
    )
  })

  it('prevents duplicate starts while the draft-creation request is pending', async () => {
    const user = userEvent.setup()
    let finishRequest: ((response: Response) => void) | undefined
    server.use(
      http.post(
        '/api/v1/applicant-applications',
        () =>
          new Promise((resolve) => {
            finishRequest = (response) => resolve(response)
          }),
      ),
    )
    renderJourney({ kind: 'none' })

    await user.click(screen.getByRole('button', { name: 'Start application' }))

    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    expect(screen.getByText('Starting your application…')).toBeInTheDocument()

    finishRequest?.(
      HttpResponse.json(
        {
          data: {
            type: 'applicant-applications',
            id: applicationId,
            attributes: {
              status: 'draft',
              currentStep: 'personal-details',
              href: `/applications/${applicationId}/personal-details`,
              progress: [
                { step: 'personal-details', state: 'current' },
                { step: 'identity-and-address', state: 'not-started' },
              ],
            },
          },
        },
        { status: 201 },
      ),
    )
    await waitFor(() => {
      expect(screen.getByLabelText('Current path')).toHaveTextContent(
        `/applications/${applicationId}/personal-details`,
      )
    })
  })

  it('shows a sign-in route when draft creation reports an expired session', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(
        '/api/v1/applicant-applications',
        () => new HttpResponse(null, { status: 401 }),
      ),
    )
    renderJourney({ kind: 'none' })

    await user.click(screen.getByRole('button', { name: 'Start application' }))

    expect(
      await screen.findByRole('heading', {
        name: 'Sign in to access your application',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Fapplications%2Fcurrent',
    )
  })

  it('keeps the start action available and reports API failures without navigating', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(
        '/api/v1/applicant-applications',
        () => new HttpResponse(null, { status: 503 }),
      ),
    )
    renderJourney({ kind: 'none' })

    await user.click(screen.getByRole('button', { name: 'Start application' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not start your application. Please try again later.',
    )
    expect(
      screen.getByRole('button', { name: 'Start application' }),
    ).toBeEnabled()
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/')
  })
})
