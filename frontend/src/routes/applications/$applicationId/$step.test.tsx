import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { server } from '../../../test/server'

import { ApplicantApplicationFormStep } from './$step'

const applicationId = '00000000-0000-4000-8000-000000000001'
const formId = '00000000-0000-4000-8000-000000000002'

afterEach(() => {
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
})

function renderStep(
  step: 'personal-details' | 'identity-and-address',
  answers: Record<string, string | boolean | null>,
) {
  return render(
    <MemoryRouter>
      <ApplicantApplicationFormStep
        applicationId={applicationId}
        step={step}
        form={{
          id: formId,
          currentStep: step,
          steps: [{ step, state: 'current' }],
          answers,
          documentEvidencePresent: step === 'identity-and-address',
          version: 2,
        }}
      />
    </MemoryRouter>,
  )
}

function LocationOutput() {
  const location = useLocation()
  return <output aria-label="Current path">{location.pathname}</output>
}

describe('saved application form loading', () => {
  it('hydrates previously saved personal details into their form fields', () => {
    renderStep('personal-details', {
      name: 'Ada Lovelace',
      dateOfBirth: '1815-12-10',
      country: 'United Kingdom',
      nationality: 'British',
      email: 'ada@example.com',
      phone: '+44123456789',
      consentConfirmed: true,
    })

    expect(screen.getByLabelText('Name (required)')).toHaveValue('Ada Lovelace')
    expect(screen.getByLabelText('Date of birth (required)')).toHaveValue(
      '1815-12-10',
    )
    expect(screen.getByLabelText('Country (required)')).toHaveValue(
      'United Kingdom',
    )
    expect(screen.getByLabelText('Nationality (required)')).toHaveValue(
      'British',
    )
    expect(screen.getByLabelText('Email (required)')).toHaveValue(
      'ada@example.com',
    )
    expect(screen.getByLabelText('Phone (required)')).toHaveValue(
      '+44123456789',
    )
    expect(
      screen.getByRole('checkbox', {
        name: 'I confirm these details are accurate and belong to me.',
      }),
    ).toBeChecked()
  })

  it('renders omitted and null saved values as empty fields and unchecked consent', () => {
    renderStep('personal-details', {
      name: null,
      email: 'ada@example.com',
    })

    expect(screen.getByLabelText('Name (required)')).toHaveValue('')
    expect(screen.getByLabelText('Date of birth (required)')).toHaveValue('')
    expect(screen.getByLabelText('Country (required)')).toHaveValue('')
    expect(screen.getByLabelText('Nationality (required)')).toHaveValue('')
    expect(screen.getByLabelText('Email (required)')).toHaveValue(
      'ada@example.com',
    )
    expect(screen.getByLabelText('Phone (required)')).toHaveValue('')
    expect(
      screen.getByRole('checkbox', {
        name: 'I confirm these details are accurate and belong to me.',
      }),
    ).not.toBeChecked()
  })

  it('hydrates saved identity and address fields into the second step', () => {
    renderStep('identity-and-address', {
      documentType: 'Passport',
      documentNumber: '12345',
      documentCountry: 'United Kingdom',
      expiry: '2030-01-01',
      street: '1 Analytical Engine Way',
      city: 'London',
      postal: 'N1 1AA',
      residentialCountry: 'United Kingdom',
    })

    expect(screen.getByLabelText('Document type (required)')).toHaveValue(
      'Passport',
    )
    expect(screen.getByLabelText('Document number (required)')).toHaveValue(
      '12345',
    )
    expect(screen.getByLabelText('Document country (required)')).toHaveValue(
      'United Kingdom',
    )
    expect(screen.getByLabelText('Expiry (required)')).toHaveValue('2030-01-01')
    expect(screen.getByLabelText('Street (required)')).toHaveValue(
      '1 Analytical Engine Way',
    )
    expect(screen.getByLabelText('City (required)')).toHaveValue('London')
    expect(screen.getByLabelText('Postal code (required)')).toHaveValue(
      'N1 1AA',
    )
    expect(screen.getByLabelText('Residential country (required)')).toHaveValue(
      'United Kingdom',
    )
    expect(
      screen.getByText('Your identity document is already on file.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Document evidence (required)'),
    ).not.toBeInTheDocument()
  })

  it('saves entered answers explicitly and shows success only after API confirmation', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    let requestBody: unknown
    server.use(
      http.patch(
        `/api/v1/applicant-applications/${applicationId}/form`,
        async ({ request }) => {
          requestBody = await request.json()
          return HttpResponse.json({
            data: {
              type: 'applicant-application-forms',
              id: formId,
              attributes: {
                status: 'draft',
                currentStep: 'personal-details',
                steps: [{ step: 'personal-details', state: 'current' }],
                answers: {
                  name: 'Ada Lovelace',
                  dateOfBirth: '',
                  country: '',
                  nationality: '',
                  email: '',
                  phone: '',
                  consentConfirmed: false,
                },
                documentEvidence: { present: false },
                version: 5,
              },
            },
          })
        },
      ),
    )
    renderStep('personal-details', {
      name: '',
      dateOfBirth: '',
      country: '',
      nationality: '',
      email: '',
      phone: '',
      consentConfirmed: false,
      documentType: 'must not be included',
    })

    await user.type(screen.getByLabelText('Name (required)'), 'Ada Lovelace')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your progress has been saved.',
    )
    expect(requestBody).toEqual({
      data: {
        type: 'applicant-application-forms',
        id: formId,
        attributes: {
          step: 'personal-details',
          answers: {
            name: 'Ada Lovelace',
            dateOfBirth: '',
            country: '',
            nationality: '',
            email: '',
            phone: '',
            consentConfirmed: false,
          },
          version: 2,
        },
      },
    })
  })

  it('saves successfully before Continue navigates to the next step', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    let requestReceived = false
    server.use(
      http.patch(`/api/v1/applicant-applications/${applicationId}/form`, () => {
        requestReceived = true
        return HttpResponse.json({
          data: {
            type: 'applicant-application-forms',
            id: formId,
            attributes: {
              status: 'draft',
              currentStep: 'personal-details',
              steps: [{ step: 'personal-details', state: 'current' }],
              answers: {
                name: 'Ada',
                dateOfBirth: '1815-12-10',
                country: 'UK',
                nationality: 'British',
                email: 'ada@example.com',
                phone: '123',
                consentConfirmed: true,
              },
              documentEvidence: { present: false },
              version: 3,
            },
          },
        })
      }),
    )
    render(
      <MemoryRouter>
        <ApplicantApplicationFormStep
          applicationId={applicationId}
          step="personal-details"
          form={{
            id: formId,
            currentStep: 'personal-details',
            steps: [{ step: 'personal-details', state: 'current' }],
            answers: {
              name: 'Ada',
              dateOfBirth: '1815-12-10',
              country: 'UK',
              nationality: 'British',
              email: 'ada@example.com',
              phone: '123',
              consentConfirmed: true,
            },
            documentEvidencePresent: false,
            version: 2,
          }}
        />
        <LocationOutput />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Current path')).toHaveTextContent(
        `/applications/${applicationId}/identity-and-address`,
      ),
    )
    expect(requestReceived).toBe(true)
  })

  it('preserves entered values and offers retry after a save failure', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    let responseStatus = 503
    server.use(
      http.patch(`/api/v1/applicant-applications/${applicationId}/form`, () =>
        responseStatus === 503
          ? HttpResponse.json({ errors: [] }, { status: responseStatus })
          : HttpResponse.json({
              data: {
                type: 'applicant-application-forms',
                id: formId,
                attributes: {
                  status: 'draft',
                  currentStep: 'personal-details',
                  steps: [{ step: 'personal-details', state: 'current' }],
                  answers: { name: 'Ada Lovelace' },
                  documentEvidence: { present: false },
                  version: 3,
                },
              },
            }),
      ),
    )
    renderStep('personal-details', { name: '' })
    const nameField = screen.getByLabelText('Name (required)')
    await user.type(nameField, 'Ada Lovelace')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not save your answers. Please try again later.',
    )
    expect(nameField).toHaveValue('Ada Lovelace')
    expect(
      screen.queryByText('Your progress has been saved.'),
    ).not.toBeInTheDocument()

    responseStatus = 200
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your progress has been saved.',
    )
    expect(nameField).toHaveValue('Ada Lovelace')
  })

  it('preserves answers and links back to the form when the session expires', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    server.use(
      http.patch(
        `/api/v1/applicant-applications/${applicationId}/form`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    )
    renderStep('personal-details', { name: 'Ada Lovelace' })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session expired. Sign in again before saving.',
    )
    expect(
      screen.getByRole('link', { name: 'Sign in to save your application' }),
    ).toHaveAttribute(
      'href',
      `/sign-in?returnTo=${encodeURIComponent(
        `/applications/${applicationId}/personal-details`,
      )}`,
    )
    expect(screen.getByLabelText('Name (required)')).toHaveValue('Ada Lovelace')
    expect(
      screen.queryByText('Your progress has been saved.'),
    ).not.toBeInTheDocument()
  })

  it('shows field-level validation details and keeps the entered answer', async () => {
    const user = userEvent.setup()
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    server.use(
      http.patch(`/api/v1/applicant-applications/${applicationId}/form`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                detail: 'Name must contain at least two characters.',
                source: {
                  pointer: '/data/attributes/answers/name',
                },
              },
            ],
          },
          { status: 422 },
        ),
      ),
    )
    renderStep('personal-details', { name: 'A' })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('Name must contain at least two characters.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name (required)')).toHaveValue('A')
    expect(
      screen.queryByText('Your progress has been saved.'),
    ).not.toBeInTheDocument()
  })

  it('offers an explicit reload after a version conflict without discarding answers first', async () => {
    const user = userEvent.setup()
    const onReload = vi.fn()
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    server.use(
      http.patch(`/api/v1/applicant-applications/${applicationId}/form`, () =>
        HttpResponse.json(
          { errors: [{ detail: 'The form was updated in another session.' }] },
          { status: 409 },
        ),
      ),
    )
    render(
      <MemoryRouter>
        <ApplicantApplicationFormStep
          applicationId={applicationId}
          form={{
            id: formId,
            currentStep: 'personal-details',
            steps: [{ step: 'personal-details', state: 'current' }],
            answers: { name: 'My unsaved answer' },
            documentEvidencePresent: false,
            version: 2,
          }}
          onReload={onReload}
          step="personal-details"
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The form was updated in another session.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reloading replaces them with the latest saved version.',
    )
    expect(screen.getByLabelText('Name (required)')).toHaveValue(
      'My unsaved answer',
    )
    await user.click(
      screen.getByRole('button', { name: 'Reload saved version' }),
    )
    expect(onReload).toHaveBeenCalledOnce()
  })
})
