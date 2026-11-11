import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { server } from '../../test/server'

import {
  createCurrentApplication,
  loadApplicantForm,
  loadCurrentApplication,
  saveApplicantForm,
} from './-application-loading'

const currentEndpoint = '/api/v1/applicant-applications/current'
const applicationId = '00000000-0000-4000-8000-000000000001'
const formId = '00000000-0000-4000-8000-000000000002'

function applicationDocument() {
  return {
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
  }
}

afterEach(() => {
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
})

describe('application loading API', () => {
  it('loads the signed-in Applicant draft and maps its step progress', async () => {
    let requestAccept: string | null = null
    server.use(
      http.get(currentEndpoint, ({ request }) => {
        requestAccept = request.headers.get('Accept')
        return HttpResponse.json(applicationDocument())
      }),
    )

    await expect(loadCurrentApplication()).resolves.toEqual({
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
    expect(requestAccept).toBe('application/vnd.api+json')
  })

  it('treats a 204 as no draft and a 401 as an expired session', async () => {
    server.use(
      http.get(currentEndpoint, () => new HttpResponse(null, { status: 204 })),
    )
    await expect(loadCurrentApplication()).resolves.toEqual({ kind: 'none' })

    server.use(
      http.get(currentEndpoint, () => new HttpResponse(null, { status: 401 })),
    )
    await expect(loadCurrentApplication()).resolves.toEqual({
      kind: 'unauthenticated',
    })
  })

  it('returns actionable errors for failed or invalid current-application responses', async () => {
    server.use(
      http.get(currentEndpoint, () => new HttpResponse(null, { status: 503 })),
    )
    await expect(loadCurrentApplication()).resolves.toEqual({
      kind: 'error',
      message: 'We could not load your application. Please try again later.',
    })

    server.use(http.get(currentEndpoint, () => HttpResponse.json({ data: {} })))
    await expect(loadCurrentApplication()).resolves.toEqual({
      kind: 'error',
      message: 'The application response was invalid. Please try again later.',
    })
  })

  it('creates or retrieves a draft using the CSRF cookie and parses its location data', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    let requestMethod = ''
    let csrfHeader: string | null = null
    server.use(
      http.post('/api/v1/applicant-applications', ({ request }) => {
        requestMethod = request.method
        csrfHeader = request.headers.get('X-XSRF-TOKEN')
        return HttpResponse.json(applicationDocument(), { status: 201 })
      }),
    )

    await expect(createCurrentApplication()).resolves.toEqual({
      kind: 'created',
      application: {
        id: applicationId,
        currentStep: 'identity-and-address',
        progress: [
          { step: 'personal-details', state: 'complete' },
          { step: 'identity-and-address', state: 'current' },
        ],
      },
    })
    expect(requestMethod).toBe('POST')
    expect(csrfHeader).toBe('csrf-token')
  })

  it('loads all saved field answers and preserves the form version', async () => {
    const answers = {
      name: 'Ada Lovelace',
      dateOfBirth: '1815-12-10',
      country: 'United Kingdom',
      nationality: 'British',
      email: 'ada@example.com',
      phone: '+44123456789',
      consentConfirmed: true,
      documentType: 'Passport',
      documentNumber: '12345',
      documentCountry: 'United Kingdom',
      expiry: '2030-01-01',
      street: '1 Analytical Engine Way',
      city: 'London',
      postal: 'N1 1AA',
      residentialCountry: 'United Kingdom',
    }
    server.use(
      http.get(`/api/v1/applicant-applications/${applicationId}/form`, () =>
        HttpResponse.json({
          data: {
            type: 'applicant-application-forms',
            id: formId,
            attributes: {
              status: 'draft',
              currentStep: 'identity-and-address',
              steps: [
                { step: 'personal-details', state: 'complete' },
                { step: 'identity-and-address', state: 'current' },
              ],
              answers,
              documentEvidence: { present: true },
              version: 3,
            },
          },
        }),
      ),
    )

    await expect(loadApplicantForm(applicationId)).resolves.toEqual({
      kind: 'form',
      form: {
        id: formId,
        currentStep: 'identity-and-address',
        steps: [
          { step: 'personal-details', state: 'complete' },
          { step: 'identity-and-address', state: 'current' },
        ],
        answers,
        documentEvidencePresent: true,
        version: 3,
      },
    })
  })

  it('maps form loading authentication and missing-application responses', async () => {
    server.use(
      http.get(
        `/api/v1/applicant-applications/${applicationId}/form`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    )
    await expect(loadApplicantForm(applicationId)).resolves.toEqual({
      kind: 'unauthenticated',
    })

    server.use(
      http.get(
        `/api/v1/applicant-applications/${applicationId}/form`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    )
    await expect(loadApplicantForm(applicationId)).resolves.toEqual({
      kind: 'not-found',
    })
  })

  it('returns an error when the form endpoint fails or sends an invalid document', async () => {
    server.use(
      http.get(
        `/api/v1/applicant-applications/${applicationId}/form`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    )
    await expect(loadApplicantForm(applicationId)).resolves.toEqual({
      kind: 'error',
      message: 'We could not load your saved answers. Please try again later.',
    })

    server.use(
      http.get(`/api/v1/applicant-applications/${applicationId}/form`, () =>
        HttpResponse.json({ data: {} }),
      ),
    )
    await expect(loadApplicantForm(applicationId)).resolves.toEqual({
      kind: 'error',
      message: 'The saved form response was invalid. Please try again later.',
    })
  })

  it('saves only the selected step as JSON:API with the CSRF token and version', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    let requestContentType: string | null = null
    let requestAccept: string | null = null
    let requestCsrfToken: string | null = null
    let requestBody: unknown
    server.use(
      http.patch(
        `/api/v1/applicant-applications/${applicationId}/form`,
        async ({ request }) => {
          requestContentType = request.headers.get('Content-Type')
          requestAccept = request.headers.get('Accept')
          requestCsrfToken = request.headers.get('X-XSRF-TOKEN')
          requestBody = await request.json()
          return HttpResponse.json({
            data: {
              type: 'applicant-application-forms',
              id: applicationId,
              attributes: {
                status: 'draft',
                currentStep: 'personal-details',
                steps: [{ step: 'personal-details', state: 'current' }],
                answers: {
                  name: 'Ada Lovelace',
                  email: 'ada@example.com',
                  consentConfirmed: true,
                },
                documentEvidence: { present: false },
                version: 4,
              },
            },
          })
        },
      ),
    )

    await expect(
      saveApplicantForm({
        applicationId,
        formId: applicationId,
        step: 'personal-details',
        answers: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          consentConfirmed: true,
        },
        version: 3,
      }),
    ).resolves.toMatchObject({
      kind: 'saved',
      form: { version: 4 },
    })

    expect(requestContentType).toBe('application/vnd.api+json')
    expect(requestAccept).toBe('application/vnd.api+json')
    expect(requestCsrfToken).toBe('csrf-token')
    expect(requestBody).toEqual({
      data: {
        type: 'applicant-application-forms',
        id: applicationId,
        attributes: {
          step: 'personal-details',
          answers: {
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            consentConfirmed: true,
          },
          version: 3,
        },
      },
    })
  })

  it('does not send an authenticated save without a CSRF cookie', async () => {
    let requestReceived = false
    server.use(
      http.patch(`/api/v1/applicant-applications/${applicationId}/form`, () => {
        requestReceived = true
        return HttpResponse.json({})
      }),
    )

    await expect(
      saveApplicantForm({
        applicationId,
        formId: applicationId,
        step: 'personal-details',
        answers: { name: 'Ada Lovelace' },
      }),
    ).resolves.toMatchObject({ kind: 'error' })
    expect(requestReceived).toBe(false)
  })

  it('maps save conflicts and validation pointers into recoverable outcomes', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    server.use(
      http.patch(`/api/v1/applicant-applications/${applicationId}/form`, () =>
        HttpResponse.json(
          { errors: [{ detail: 'The draft changed in another session.' }] },
          { status: 409 },
        ),
      ),
    )
    await expect(
      saveApplicantForm({
        applicationId,
        formId,
        step: 'personal-details',
        answers: { name: 'Ada' },
        version: 2,
      }),
    ).resolves.toEqual({
      kind: 'conflict',
      message: 'The draft changed in another session.',
    })

    server.use(
      http.patch(`/api/v1/applicant-applications/${applicationId}/form`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                detail: 'Enter a valid email address.',
                source: { pointer: '/data/attributes/answers/email' },
              },
            ],
          },
          { status: 422 },
        ),
      ),
    )
    await expect(
      saveApplicantForm({
        applicationId,
        formId,
        step: 'personal-details',
        answers: { email: 'invalid' },
      }),
    ).resolves.toEqual({
      kind: 'validation-error',
      message: 'Some answers need attention before they can be saved.',
      fieldErrors: { email: 'Enter a valid email address.' },
    })
  })

  it('maps unauthorized and missing-form save responses without reporting success', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-token; path=/'
    server.use(
      http.patch(
        `/api/v1/applicant-applications/${applicationId}/form`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    )
    await expect(
      saveApplicantForm({
        applicationId,
        formId,
        step: 'personal-details',
        answers: { name: 'Ada' },
      }),
    ).resolves.toEqual({ kind: 'unauthenticated' })

    server.use(
      http.patch(
        `/api/v1/applicant-applications/${applicationId}/form`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    )
    await expect(
      saveApplicantForm({
        applicationId,
        formId,
        step: 'personal-details',
        answers: { name: 'Ada' },
      }),
    ).resolves.toEqual({ kind: 'not-found' })
  })
})
