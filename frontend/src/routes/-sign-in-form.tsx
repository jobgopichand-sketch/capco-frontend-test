import {
  Alert,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from '@kyc/ui'
import { useEffect, useRef, useState } from 'react'

import { accountAccessHref, isSafeJourneyPath } from './-return-target'
import styles from './account-access.module.css'

const sessionEndpoint = '/api/v1/applicant-sessions'
const jsonApiMediaType = 'application/vnd.api+json'
const emailAttributePointer = '/data/attributes/email'
const passwordAttributePointer = '/data/attributes/password'

interface ApplicantSessionDocument {
  data: {
    attributes: {
      href: string
    }
  }
}

interface ApiError {
  detail?: string
  source?: { pointer?: string }
  title?: string
}

interface ApiErrorDocument {
  errors: ApiError[]
}

export interface SignInFormProps {
  onNavigate?: (href: string) => void
  returnTo?: string
  onSuccess: (href: string) => void
}

function isApplicantSessionDocument(
  value: unknown,
): value is ApplicantSessionDocument {
  if (typeof value !== 'object' || value === null || !('data' in value)) {
    return false
  }
  const { data } = value
  if (typeof data !== 'object' || data === null || !('attributes' in data)) {
    return false
  }
  const { attributes } = data
  return (
    typeof attributes === 'object' &&
    attributes !== null &&
    'href' in attributes &&
    typeof attributes.href === 'string'
  )
}

function isApiErrorDocument(value: unknown): value is ApiErrorDocument {
  if (typeof value !== 'object' || value === null || !('errors' in value)) {
    return false
  }
  const { errors } = value
  return (
    Array.isArray(errors) &&
    errors.every(
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        (error.detail === undefined || typeof error.detail === 'string') &&
        (error.title === undefined || typeof error.title === 'string') &&
        (error.source === undefined ||
          (typeof error.source === 'object' &&
            error.source !== null &&
            (error.source.pointer === undefined ||
              typeof error.source.pointer === 'string'))),
    )
  )
}

function apiErrorMessage(error: ApiError, fallback: string): string {
  return error.detail ?? error.title ?? fallback
}

export function SignInForm({
  onNavigate,
  returnTo,
  onSuccess,
}: SignInFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [emailError, setEmailError] = useState<string>()
  const [passwordError, setPasswordError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submissionInProgress = useRef(false)
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (emailError) {
      emailInput.current?.focus()
    } else if (passwordError) {
      passwordInput.current?.focus()
    } else if (error) {
      document.getElementById('sign-in-error-summary')?.focus()
    }
  }, [emailError, passwordError, error])

  async function submit(): Promise<void> {
    if (submissionInProgress.current) {
      return
    }

    setError(undefined)
    setEmailError(undefined)
    setPasswordError(undefined)

    const emailValidity = emailInput.current?.validity
    const emailIsValid = emailValidity?.valid ?? false
    const passwordIsPresent = password.length > 0

    if (!emailIsValid) {
      setEmailError(
        emailValidity?.valueMissing
          ? 'Enter your email address.'
          : 'Enter a valid email address.',
      )
    }
    if (!passwordIsPresent) {
      setPasswordError('Enter your password.')
    }
    if (!emailIsValid || !passwordIsPresent) {
      return
    }

    submissionInProgress.current = true
    setIsSubmitting(true)
    try {
      let response: Response
      try {
        response = await fetch(sessionEndpoint, {
          method: 'POST',
          headers: {
            Accept: jsonApiMediaType,
            'Content-Type': jsonApiMediaType,
          },
          body: JSON.stringify({
            data: {
              type: 'applicant-sessions',
              attributes: { email, password },
            },
          }),
        })
      } catch {
        setError(
          'We could not reach the service. Check your connection and try again.',
        )
        return
      }

      if (response.status === 401) {
        setError('Email or password is incorrect. Please try again.')
        return
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const retrySeconds =
          retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0
        setError(
          retrySeconds > 0
            ? `Too many sign-in attempts. Please try again in ${retrySeconds} seconds.`
            : 'Too many sign-in attempts. Please try again later.',
        )
        return
      }

      if (response.status === 406) {
        setError(
          'The service could not provide the required response format. Please try again later.',
        )
        return
      }

      if (response.status === 415) {
        setError(
          'The service did not accept the sign-in request format. Please try again later.',
        )
        return
      }

      if (response.status === 400) {
        let body: unknown
        try {
          body = await response.json()
        } catch {
          setError(
            'The sign-in details could not be validated. Please try again.',
          )
          return
        }

        if (isApiErrorDocument(body)) {
          const emailErrors = body.errors.filter(
            (item) => item.source?.pointer === emailAttributePointer,
          )
          const passwordErrors = body.errors.filter(
            (item) => item.source?.pointer === passwordAttributePointer,
          )
          const unassignedErrors = body.errors.filter(
            (item) =>
              item.source?.pointer !== emailAttributePointer &&
              item.source?.pointer !== passwordAttributePointer,
          )
          setEmailError(
            emailErrors.length > 0
              ? emailErrors
                  .map((item) =>
                    apiErrorMessage(item, 'Enter a valid email address.'),
                  )
                  .join(' ')
              : undefined,
          )
          setPasswordError(
            passwordErrors.length > 0
              ? passwordErrors
                  .map((item) => apiErrorMessage(item, 'Enter your password.'))
                  .join(' ')
              : undefined,
          )
          if (unassignedErrors.length > 0) {
            setError(
              unassignedErrors
                .map((item) =>
                  apiErrorMessage(
                    item,
                    'The sign-in details could not be validated. Please try again.',
                  ),
                )
                .join(' '),
            )
          } else if (emailErrors.length === 0 && passwordErrors.length === 0) {
            setError(
              'The sign-in details could not be validated. Please try again.',
            )
          }
          return
        }

        setError(
          'The sign-in details could not be validated. Please try again.',
        )
        return
      }

      if (response.status !== 201) {
        setError(
          'We could not sign you in due to a service issue. Please try again later.',
        )
        return
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        setError('The sign-in response was invalid. Please try again.')
        return
      }

      if (!isApplicantSessionDocument(body)) {
        setError('The sign-in response was invalid. Please try again.')
        return
      }

      if (!isSafeJourneyPath(body.data.attributes.href)) {
        setError('The sign-in response contained an invalid destination.')
        return
      }

      onSuccess(body.data.attributes.href)
    } finally {
      submissionInProgress.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <CardContent className={styles.cardContent}>
          <Stack
            component="form"
            aria-busy={isSubmitting}
            aria-labelledby="sign-in-heading"
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
            spacing={3}
          >
            <Stack spacing={1}>
              <Typography component="h1" id="sign-in-heading" variant="heading">
                Welcome back
              </Typography>
              <Typography tone="muted">
                Sign in to continue your KYC application.
              </Typography>
            </Stack>
            {(error ?? emailError ?? passwordError) ? (
              <Alert
                aria-live="assertive"
                id="sign-in-error-summary"
                role="alert"
                severity="error"
                tabIndex={-1}
              >
                {error ?? emailError ?? passwordError}
              </Alert>
            ) : null}
            {isSubmitting ? (
              <Alert aria-live="polite" severity="info">
                Signing in…
              </Alert>
            ) : null}
            <TextField
              autoComplete="email"
              disabled={isSubmitting}
              error={Boolean(emailError)}
              fullWidth
              helperText={emailError}
              id="applicant-email"
              inputRef={emailInput}
              label="Email address"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value)
                setEmailError(undefined)
                setError(undefined)
              }}
              required
              type="email"
              value={email}
            />
            <TextField
              autoComplete="current-password"
              disabled={isSubmitting}
              error={Boolean(passwordError)}
              fullWidth
              helperText={passwordError}
              id="applicant-password"
              inputRef={passwordInput}
              label="Password"
              name="password"
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordError(undefined)
                setError(undefined)
              }}
              required
              type="password"
              value={password}
            />
            <Button
              className={styles.submit}
              fullWidth
              isDisabled={isSubmitting}
              size="large"
              type="submit"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <Typography
              className={styles.footer}
              align="center"
              variant="caption"
            >
              <span>New to KYC? </span>
              <Link
                href={accountAccessHref('/create-account', returnTo)}
                onClick={(event) => {
                  if (onNavigate) {
                    event.preventDefault()
                    onNavigate(accountAccessHref('/create-account', returnTo))
                  }
                }}
              >
                Create account
              </Link>
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </main>
  )
}
