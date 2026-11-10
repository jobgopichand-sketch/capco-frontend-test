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

import { accountAccessHref } from './-return-target'
import styles from './account-access.module.css'

const registrationEndpoint = '/api/v1/applicant-accounts'
const jsonApiMediaType = 'application/vnd.api+json'
const emailAttributePointer = '/data/attributes/email'
const passwordAttributePointer = '/data/attributes/password'

interface ApiError {
  detail?: string
  source?: { pointer?: string }
  title?: string
}

interface ApiErrorDocument {
  errors: ApiError[]
}

export interface CreateAccountFormProps {
  onNavigate?: (href: string) => void
  returnTo?: string
}

const passwordGuidance =
  'Use at least six characters, including one uppercase letter and one special character.'

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

export function CreateAccountForm({
  onNavigate,
  returnTo,
}: CreateAccountFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [emailError, setEmailError] = useState<string>()
  const [passwordError, setPasswordError] = useState<string>()
  const [passwordConfirmationError, setPasswordConfirmationError] =
    useState<string>()
  const [successMessage, setSuccessMessage] = useState<string>()
  const submissionInProgress = useRef(false)
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const passwordConfirmationInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (emailError) {
      emailInput.current?.focus()
    } else if (passwordError) {
      passwordInput.current?.focus()
    } else if (passwordConfirmationError) {
      passwordConfirmationInput.current?.focus()
    } else if (error) {
      document.getElementById('registration-error-summary')?.focus()
    }
  }, [emailError, passwordError, passwordConfirmationError, error])

  async function submit(): Promise<void> {
    if (submissionInProgress.current) {
      return
    }

    setError(undefined)
    setEmailError(undefined)
    setPasswordError(undefined)
    setPasswordConfirmationError(undefined)
    setSuccessMessage(undefined)

    const emailValidity = emailInput.current?.validity
    const emailIsValid = emailValidity?.valid ?? false
    const passwordIsValid =
      password.length >= 6 &&
      /[A-Z]/.test(password) &&
      /[^A-Za-z0-9]/.test(password)

    if (!emailIsValid) {
      setEmailError(
        emailValidity?.valueMissing
          ? 'Enter your email address.'
          : 'Enter a valid email address.',
      )
    }
    if (!passwordIsValid) {
      setPasswordError(
        password.length === 0 ? 'Enter a password.' : passwordGuidance,
      )
    }
    const passwordsMatch = password === passwordConfirmation
    if (passwordConfirmation.length === 0) {
      setPasswordConfirmationError('Confirm your password.')
    } else if (!passwordsMatch) {
      setPasswordConfirmationError('Passwords do not match.')
    }
    if (
      !emailIsValid ||
      !passwordIsValid ||
      passwordConfirmation.length === 0 ||
      !passwordsMatch
    ) {
      return
    }

    submissionInProgress.current = true
    setIsSubmitting(true)
    try {
      const response = await fetch(registrationEndpoint, {
        method: 'POST',
        headers: {
          Accept: jsonApiMediaType,
          'Content-Type': jsonApiMediaType,
        },
        body: JSON.stringify({
          data: {
            type: 'applicant-accounts',
            attributes: { email, password },
          },
        }),
      })

      if (response.status === 201) {
        setPassword('')
        setPasswordConfirmation('')
        setSuccessMessage('Your account has been created. You can now sign in.')
        return
      }

      if (response.status === 409) {
        setError(
          'An account already exists for this email address. Try signing in instead.',
        )
        return
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const retrySeconds =
          retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0
        setError(
          retrySeconds > 0
            ? `Too many attempts. Please try again in ${retrySeconds} seconds.`
            : 'Too many attempts. Please try again later.',
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
          'The service did not accept the registration request format. Please try again later.',
        )
        return
      }

      if (response.status === 400) {
        let body: unknown
        try {
          body = await response.json()
        } catch {
          setError('We could not validate your details. Please try again.')
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
                  .map((item) => apiErrorMessage(item, passwordGuidance))
                  .join(' ')
              : undefined,
          )
          if (unassignedErrors.length > 0) {
            setError(
              unassignedErrors
                .map((item) =>
                  apiErrorMessage(
                    item,
                    'We could not validate your details. Please try again.',
                  ),
                )
                .join(' '),
            )
          } else if (emailErrors.length === 0 && passwordErrors.length === 0) {
            setError('We could not validate your details. Please try again.')
          }
          return
        }
      }

      setError('We could not create your account. Please try again later.')
    } catch {
      setError(
        'We could not reach the service. Check your connection and try again.',
      )
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
            aria-labelledby="create-account-heading"
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
            spacing={3}
          >
            <Stack spacing={1}>
              <Typography
                component="h1"
                id="create-account-heading"
                variant="heading"
              >
                Create your account
              </Typography>
              <Typography tone="muted">
                Create credentials to begin your KYC application.
              </Typography>
            </Stack>
            {(error ??
            emailError ??
            passwordError ??
            passwordConfirmationError) ? (
              <Alert
                aria-live="assertive"
                id="registration-error-summary"
                role="alert"
                severity="error"
                tabIndex={-1}
              >
                {error ??
                  emailError ??
                  passwordError ??
                  passwordConfirmationError}
              </Alert>
            ) : null}
            {successMessage ? (
              <Alert aria-live="polite" role="status" severity="success">
                {successMessage}
              </Alert>
            ) : null}
            {isSubmitting ? (
              <Alert aria-live="polite" severity="info">
                Creating your account…
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
              }}
              required
              type="email"
              value={email}
            />
            <TextField
              autoComplete="new-password"
              disabled={isSubmitting}
              error={Boolean(passwordError)}
              fullWidth
              helperText={passwordError ?? passwordGuidance}
              id="applicant-password"
              inputRef={passwordInput}
              label="Password"
              name="password"
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordError(undefined)
              }}
              required
              type="password"
              value={password}
            />
            <TextField
              autoComplete="new-password"
              disabled={isSubmitting}
              error={Boolean(passwordConfirmationError)}
              fullWidth
              helperText={passwordConfirmationError}
              id="applicant-password-confirmation"
              inputRef={passwordConfirmationInput}
              label="Confirm password"
              name="passwordConfirmation"
              onChange={(event) => {
                setPasswordConfirmation(event.target.value)
                setPasswordConfirmationError(undefined)
              }}
              required
              type="password"
              value={passwordConfirmation}
            />
            <Button
              className={styles.submit}
              fullWidth
              isDisabled={isSubmitting}
              size="large"
              type="submit"
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
            <Typography
              className={styles.footer}
              align="center"
              variant="caption"
            >
              <span>Already have an account? </span>
              <Link
                href={accountAccessHref('/sign-in', returnTo)}
                onClick={(event) => {
                  if (onNavigate) {
                    event.preventDefault()
                    onNavigate(accountAccessHref('/sign-in', returnTo))
                  }
                }}
              >
                Sign in
              </Link>
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </main>
  )
}
