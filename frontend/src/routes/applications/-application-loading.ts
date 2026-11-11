import { z } from 'zod'

const apiBase = '/api/v1/applicant-applications'
const jsonApiMediaType = 'application/vnd.api+json'

const applicationStepSchema = z.enum([
  'personal-details',
  'identity-and-address',
])

const currentApplicationSchema = z.object({
  data: z.object({
    type: z.literal('applicant-applications'),
    id: z.string().uuid(),
    attributes: z.object({
      currentStep: applicationStepSchema,
      progress: z.array(
        z.object({
          step: applicationStepSchema,
          state: z.enum(['not-started', 'current', 'complete']),
        }),
      ),
    }),
  }),
})

const answersSchema = z
  .object({
    name: z.string().nullable().optional(),
    dateOfBirth: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    nationality: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    consentConfirmed: z.boolean().nullable().optional(),
    documentType: z.string().nullable().optional(),
    documentNumber: z.string().nullable().optional(),
    documentCountry: z.string().nullable().optional(),
    expiry: z.string().nullable().optional(),
    street: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    postal: z.string().nullable().optional(),
    residentialCountry: z.string().nullable().optional(),
  })
  .partial()

const formDocumentSchema = z.object({
  data: z.object({
    type: z.literal('applicant-application-forms'),
    id: z.string().uuid(),
    attributes: z.object({
      status: z.literal('draft'),
      currentStep: applicationStepSchema,
      steps: z.array(
        z.object({
          step: applicationStepSchema,
          state: z.enum(['remaining', 'current', 'complete']),
        }),
      ),
      answers: answersSchema,
      documentEvidence: z.object({ present: z.boolean() }),
      version: z.number().int().nonnegative().optional(),
    }),
  }),
})

const apiErrorDocumentSchema = z.object({
  errors: z.array(
    z.object({
      detail: z.string().optional(),
      source: z.object({ pointer: z.string().optional() }).optional(),
      title: z.string().optional(),
    }),
  ),
})

export type ApplicantStep = z.infer<typeof applicationStepSchema>
export type ApplicantAnswers = z.infer<typeof answersSchema>

export interface CurrentApplication {
  id: string
  currentStep: ApplicantStep
  progress: Array<{
    step: ApplicantStep
    state: 'not-started' | 'current' | 'complete'
  }>
}

export interface ApplicantForm {
  id: string
  currentStep: ApplicantStep
  steps: Array<{
    step: ApplicantStep
    state: 'remaining' | 'current' | 'complete'
  }>
  answers: ApplicantAnswers
  documentEvidencePresent: boolean
  version?: number
}

export type CurrentApplicationResult =
  | { kind: 'draft'; application: CurrentApplication }
  | { kind: 'none' }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }

export type ApplicantFormResult =
  | { kind: 'form'; form: ApplicantForm }
  | { kind: 'unauthenticated' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }

export type CreateApplicationResult =
  | { kind: 'created'; application: CurrentApplication }
  | { kind: 'unauthenticated' }
  | { kind: 'error'; message: string }

export type SaveApplicantFormResult =
  | { kind: 'saved'; form: ApplicantForm }
  | { kind: 'unauthenticated' }
  | { kind: 'not-found' }
  | { kind: 'conflict'; message: string }
  | {
      kind: 'validation-error'
      message: string
      fieldErrors: Partial<Record<keyof ApplicantAnswers, string>>
    }
  | { kind: 'error'; message: string }

function parseFormDocument(body: unknown): ApplicantForm | undefined {
  const parsed = formDocumentSchema.safeParse(body)
  if (!parsed.success) return undefined

  return {
    id: parsed.data.data.id,
    currentStep: parsed.data.data.attributes.currentStep,
    steps: parsed.data.data.attributes.steps,
    answers: parsed.data.data.attributes.answers,
    documentEvidencePresent:
      parsed.data.data.attributes.documentEvidence.present,
    version: parsed.data.data.attributes.version,
  }
}

async function responseErrorDetails(
  response: Response,
  fallback: string,
): Promise<{
  message: string
  fieldErrors: Partial<Record<keyof ApplicantAnswers, string>>
}> {
  try {
    const body: unknown = await response.json()
    const parsed = apiErrorDocumentSchema.safeParse(body)
    if (parsed.success) {
      const fieldErrors: Partial<Record<keyof ApplicantAnswers, string>> = {}
      const unassignedMessages: string[] = []
      const details = parsed.data.errors
        .map((error) => {
          const message = error.detail ?? error.title
          const pointer = error.source?.pointer
          const key = pointer?.split('/').at(-1) as
            keyof ApplicantAnswers | undefined
          if (message && key && key in answersSchema.shape) {
            fieldErrors[key] = fieldErrors[key]
              ? `${fieldErrors[key]} ${message}`
              : message
          } else if (message) {
            unassignedMessages.push(message)
          }
          return message
        })
        .filter((detail): detail is string => Boolean(detail))
      if (details.length > 0) {
        return {
          message:
            unassignedMessages.join(' ') ||
            'Some answers need attention before they can be saved.',
          fieldErrors,
        }
      }
    }
  } catch {
    return { message: fallback, fieldErrors: {} }
  }
  return { message: fallback, fieldErrors: {} }
}

function csrfToken(): string | undefined {
  const tokenCookie = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
  if (!tokenCookie) return undefined

  try {
    return decodeURIComponent(tokenCookie.slice('XSRF-TOKEN='.length))
  } catch {
    return tokenCookie.slice('XSRF-TOKEN='.length)
  }
}

async function parseCurrentApplication(
  response: Response,
): Promise<CurrentApplication | undefined> {
  try {
    const body: unknown = await response.json()
    const parsed = currentApplicationSchema.safeParse(body)
    if (!parsed.success) return undefined
    return {
      id: parsed.data.data.id,
      currentStep: parsed.data.data.attributes.currentStep,
      progress: parsed.data.data.attributes.progress,
    }
  } catch {
    return undefined
  }
}

export async function loadCurrentApplication(
  signal?: AbortSignal,
): Promise<CurrentApplicationResult> {
  let response: Response
  try {
    response = await fetch(`${apiBase}/current`, {
      headers: { Accept: jsonApiMediaType },
      signal,
    })
  } catch {
    return {
      kind: 'error',
      message:
        'We could not load your application. Check your connection and try again.',
    }
  }

  if (response.status === 204) return { kind: 'none' }
  if (response.status === 401) return { kind: 'unauthenticated' }
  if (response.status !== 200) {
    return {
      kind: 'error',
      message: 'We could not load your application. Please try again later.',
    }
  }

  const application = await parseCurrentApplication(response)
  return application
    ? { kind: 'draft', application }
    : {
        kind: 'error',
        message:
          'The application response was invalid. Please try again later.',
      }
}

export async function createCurrentApplication(): Promise<CreateApplicationResult> {
  const headers = new Headers({
    Accept: jsonApiMediaType,
  })
  const token = csrfToken()
  if (token) headers.set('X-XSRF-TOKEN', token)

  let response: Response
  try {
    response = await fetch(apiBase, { method: 'POST', headers })
  } catch {
    return {
      kind: 'error',
      message:
        'We could not start your application. Check your connection and try again.',
    }
  }

  if (response.status === 401) return { kind: 'unauthenticated' }
  if (response.status !== 200 && response.status !== 201) {
    return {
      kind: 'error',
      message: 'We could not start your application. Please try again later.',
    }
  }

  const application = await parseCurrentApplication(response)
  return application
    ? { kind: 'created', application }
    : {
        kind: 'error',
        message:
          'The application response was invalid. Please try again later.',
      }
}

export async function loadApplicantForm(
  applicationId: string,
  signal?: AbortSignal,
): Promise<ApplicantFormResult> {
  let response: Response
  try {
    response = await fetch(
      `${apiBase}/${encodeURIComponent(applicationId)}/form`,
      {
        headers: { Accept: jsonApiMediaType },
        signal,
      },
    )
  } catch {
    return {
      kind: 'error',
      message:
        'We could not load your saved answers. Check your connection and try again.',
    }
  }

  if (response.status === 401) return { kind: 'unauthenticated' }
  if (response.status === 404) return { kind: 'not-found' }
  if (response.status !== 200) {
    return {
      kind: 'error',
      message: 'We could not load your saved answers. Please try again later.',
    }
  }

  try {
    const body: unknown = await response.json()
    const form = parseFormDocument(body)
    if (form) return { kind: 'form', form }
  } catch {
    // The response body is handled as an invalid API document below.
  }

  return {
    kind: 'error',
    message: 'The saved form response was invalid. Please try again later.',
  }
}

export async function saveApplicantForm({
  applicationId,
  formId,
  step,
  answers,
  version,
}: {
  applicationId: string
  formId: string
  step: ApplicantStep
  answers: Partial<ApplicantAnswers>
  version?: number
}): Promise<SaveApplicantFormResult> {
  const token = csrfToken()
  if (!token) {
    return {
      kind: 'error',
      message:
        'Your security token is missing. Refresh the page and sign in again before saving.',
    }
  }

  let response: Response
  try {
    response = await fetch(
      `${apiBase}/${encodeURIComponent(applicationId)}/form`,
      {
        method: 'PATCH',
        headers: {
          Accept: jsonApiMediaType,
          'Content-Type': jsonApiMediaType,
          'X-XSRF-TOKEN': token,
        },
        body: JSON.stringify({
          data: {
            type: 'applicant-application-forms',
            id: formId,
            attributes: {
              step,
              answers,
              ...(version === undefined ? {} : { version }),
            },
          },
        }),
      },
    )
  } catch {
    return {
      kind: 'error',
      message:
        'We could not save your answers. Check your connection and try again.',
    }
  }

  if (response.status === 401) return { kind: 'unauthenticated' }
  if (response.status === 404) return { kind: 'not-found' }
  if (response.status === 409) {
    const error = await responseErrorDetails(
      response,
      'Your saved form has changed. Reload it before trying again.',
    )
    return {
      kind: 'conflict',
      message: error.message,
    }
  }
  if (response.status === 400 || response.status === 422) {
    const error = await responseErrorDetails(
      response,
      'The answers could not be saved. Check them and try again.',
    )
    return {
      kind: 'validation-error',
      ...error,
    }
  }
  if (response.status !== 200) {
    return {
      kind: 'error',
      message: (
        await responseErrorDetails(
          response,
          'We could not save your answers. Please try again later.',
        )
      ).message,
    }
  }

  try {
    const body: unknown = await response.json()
    const form = parseFormDocument(body)
    if (form) return { kind: 'saved', form }
  } catch {
    return {
      kind: 'error',
      message:
        'The save response was invalid. Your answers may not have been saved.',
    }
  }

  return {
    kind: 'error',
    message:
      'The save response was invalid. Your answers may not have been saved.',
  }
}
