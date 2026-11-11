import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from '@kyc/ui'
import { useRef, useState } from 'react'
import { useNavigate, useRevalidator } from 'react-router'

import {
  loadApplicantForm,
  saveApplicantForm,
  type ApplicantAnswers,
  type ApplicantForm,
  type ApplicantStep,
} from '../-application-loading'
import styles from '../../application-step.module.css'

import type { Route } from './+types/$step'

export function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  if (params.step === 'review') return { kind: 'review' as const }
  if (
    params.step !== 'personal-details' &&
    params.step !== 'identity-and-address'
  ) {
    return { kind: 'invalid-step' as const }
  }
  const step: ApplicantStep =
    params.step === 'personal-details'
      ? 'personal-details'
      : 'identity-and-address'
  return loadApplicantForm(params.applicationId, request.signal).then(
    (result) => (result.kind === 'form' ? { ...result, step } : result),
  )
}

const fields = {
  'personal-details': [
    { key: 'name', label: 'Name' },
    { key: 'dateOfBirth', label: 'Date of birth' },
    { key: 'country', label: 'Country' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
  ],
  'identity-and-address': [
    { key: 'documentType', label: 'Document type' },
    { key: 'documentNumber', label: 'Document number' },
    { key: 'documentCountry', label: 'Document country' },
    { key: 'expiry', label: 'Expiry' },
    { key: 'street', label: 'Street' },
    { key: 'city', label: 'City' },
    { key: 'postal', label: 'Postal code' },
    { key: 'residentialCountry', label: 'Residential country' },
  ],
} as const satisfies Record<
  ApplicantStep,
  ReadonlyArray<{ key: keyof ApplicantAnswers; label: string }>
>

export default function CurrentApplicationStepPage({
  params,
  loaderData,
}: Route.ComponentProps) {
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const [reloadRevision, setReloadRevision] = useState(0)

  if (loaderData.kind === 'review') {
    return (
      <main className={styles.reviewPage}>
        <Card className={styles.reviewCard}>
          <CardContent>
            <Stack spacing={2}>
              <Typography component="h1" variant="heading">
                Review application
              </Typography>
              <Typography>Your application is ready for review.</Typography>
              <label>
                <input type="checkbox" /> I confirm the information is complete
                and accurate.
              </label>
              <Button
                onClick={() =>
                  void navigate(
                    `/applications/${params.applicationId}/submitted`,
                  )
                }
              >
                Submit
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void navigate(
                    `/applications/${params.applicationId}/identity-and-address`,
                  )
                }
              >
                Return to form
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (loaderData.kind === 'unauthenticated') {
    return (
      <LoadError
        message="Your session may have expired. Sign in to continue."
        signIn
      />
    )
  }
  if (loaderData.kind === 'not-found') {
    return (
      <LoadError message="This application is no longer available. Return to your applications and try again." />
    )
  }
  if (loaderData.kind === 'error') {
    return <LoadError message={loaderData.message} canRetry />
  }
  if (loaderData.kind === 'invalid-step') {
    return <LoadError message="This application step is not available." />
  }

  return (
    <ApplicantApplicationFormStep
      key={`${loaderData.form.id}:${params.step}:${reloadRevision}`}
      applicationId={params.applicationId}
      form={loaderData.form}
      onReload={() => {
        setReloadRevision((current) => current + 1)
        revalidator.revalidate()
      }}
      step={loaderData.step}
    />
  )
}

function LoadError({
  message,
  canRetry = false,
  signIn = false,
}: {
  message: string
  canRetry?: boolean
  signIn?: boolean
}) {
  const revalidator = useRevalidator()

  return (
    <main className={styles.page}>
      <Box component="div" className={styles.stepContent}>
        <Stack spacing={2}>
          <Typography component="h1" variant="heading">
            Application unavailable
          </Typography>
          <Alert role="alert" severity="error">
            {message}
          </Alert>
          {signIn ? (
            <Link href="/sign-in?returnTo=%2Fapplications%2Fcurrent">
              Sign in
            </Link>
          ) : null}
          {canRetry ? (
            <Button
              isDisabled={revalidator.state !== 'idle'}
              onClick={() => revalidator.revalidate()}
            >
              Retry
            </Button>
          ) : null}
        </Stack>
      </Box>
    </main>
  )
}

export function ApplicantApplicationFormStep({
  applicationId,
  form,
  onReload,
  step,
}: {
  applicationId: string
  form: ApplicantForm
  onReload?: () => void
  step: ApplicantStep
}) {
  const navigate = useNavigate()
  const [answers, setAnswers] = useState<ApplicantAnswers>(form.answers)
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [saveFieldErrors, setSaveFieldErrors] = useState<
    Partial<Record<keyof ApplicantAnswers, string>>
  >({})
  const [saveConflict, setSaveConflict] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [version, setVersion] = useState(form.version)
  const saveInProgress = useRef(false)

  async function saveAnswers(continueAfterSave = false): Promise<void> {
    if (saveInProgress.current) return

    saveInProgress.current = true
    setIsSaving(true)
    setSaved(false)
    setSaveError(undefined)
    setSaveFieldErrors({})
    setSaveConflict(false)
    setSessionExpired(false)

    const stepAnswers: Partial<ApplicantAnswers> = {}
    for (const { key } of fields[step]) {
      Object.assign(stepAnswers, { [key]: answers[key] })
    }
    if (step === 'personal-details') {
      stepAnswers.consentConfirmed = answers.consentConfirmed === true
    }

    try {
      const result = await saveApplicantForm({
        applicationId,
        formId: form.id,
        step,
        answers: stepAnswers,
        version,
      })

      if (result.kind === 'saved') {
        setAnswers(result.form.answers)
        setVersion(result.form.version)
        setSaved(true)
        if (continueAfterSave) {
          void navigate(
            step === 'personal-details'
              ? `/applications/${applicationId}/identity-and-address`
              : `/applications/${applicationId}/review`,
          )
        }
      } else if (result.kind === 'unauthenticated') {
        setSaveError('Your session expired. Sign in again before saving.')
        setSessionExpired(true)
      } else if (result.kind === 'not-found') {
        setSaveError('This application is no longer available.')
      } else if (result.kind === 'conflict') {
        setSaveError(result.message)
        setSaveConflict(true)
      } else if (result.kind === 'validation-error') {
        setSaveError(result.message)
        setSaveFieldErrors(result.fieldErrors)
      } else {
        setSaveError(result.message)
      }
    } finally {
      saveInProgress.current = false
      setIsSaving(false)
    }
  }

  function answerValue(key: keyof ApplicantAnswers): string {
    const value = answers[key]
    return typeof value === 'string' ? value : ''
  }

  function updateAnswer(key: keyof ApplicantAnswers, value: string) {
    setSaved(false)
    setSaveFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setAnswers((current) => ({ ...current, [key]: value }))
  }

  return (
    <main className={styles.page}>
      <Box component="div" className={styles.stepContent}>
        <Stack spacing={3}>
          <Typography component="p" variant="eyebrow" tone="accent">
            STEP {step === 'personal-details' ? '1' : '2'} OF 2
          </Typography>
          <Typography component="h1" variant="heading">
            {step === 'personal-details'
              ? 'Personal details'
              : 'Identity and address'}
          </Typography>
          <Typography tone="muted">
            Complete this form as part of the frontend implementation exercise.
          </Typography>
          <Stack
            component="form"
            aria-busy={isSaving}
            className={styles.stepForm}
            onSubmit={(event) => {
              event.preventDefault()
              if (!event.currentTarget.reportValidity()) return
              void saveAnswers(true)
            }}
            spacing={2}
          >
            {fields[step].map(({ key, label }) => (
              <TextField
                disabled={isSaving}
                error={Boolean(saveFieldErrors[key])}
                helperText={saveFieldErrors[key]}
                key={key}
                label={`${label} (required)`}
                name={key}
                onChange={(event) => updateAnswer(key, event.target.value)}
                required
                value={answerValue(key)}
              />
            ))}
            {step === 'personal-details' ? (
              <label>
                <input
                  checked={answers.consentConfirmed === true}
                  disabled={isSaving}
                  name="consentConfirmed"
                  onChange={(event) => {
                    setSaved(false)
                    setSaveFieldErrors((current) => {
                      if (!current.consentConfirmed) return current
                      const next = { ...current }
                      delete next.consentConfirmed
                      return next
                    })
                    setAnswers((current) => ({
                      ...current,
                      consentConfirmed: event.target.checked,
                    }))
                  }}
                  required
                  type="checkbox"
                />{' '}
                I confirm these details are accurate and belong to me.
              </label>
            ) : null}
            {step === 'identity-and-address' && form.documentEvidencePresent ? (
              <Alert role="status" severity="success">
                Your identity document is already on file.
              </Alert>
            ) : null}
            {step === 'identity-and-address' &&
            !form.documentEvidencePresent ? (
              <>
                <label htmlFor="document-evidence">
                  Document evidence (required)
                </label>
                <input
                  id="document-evidence"
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={isSaving}
                  required
                />
              </>
            ) : null}
            {saveError ? (
              <>
                <Alert role="alert" severity="error">
                  {saveError}
                  {saveConflict
                    ? ' Your unsaved answers are still here. Reloading replaces them with the latest saved version.'
                    : null}
                </Alert>
                {sessionExpired ? (
                  <Link
                    href={`/sign-in?returnTo=${encodeURIComponent(
                      `/applications/${applicationId}/${step}`,
                    )}`}
                  >
                    Sign in to save your application
                  </Link>
                ) : null}
                {saveConflict && onReload ? (
                  <Button
                    isDisabled={isSaving}
                    onClick={onReload}
                    type="button"
                    variant="secondary"
                  >
                    Reload saved version
                  </Button>
                ) : null}
              </>
            ) : null}
            {saved ? (
              <Alert role="status" severity="success">
                Your progress has been saved.
              </Alert>
            ) : null}
            {isSaving ? (
              <Alert aria-live="polite" severity="info">
                Saving your progress…
              </Alert>
            ) : null}
            <Stack
              component="div"
              className={styles.formActions}
              direction="row"
              spacing={2}
            >
              <Button
                type="button"
                variant="quiet"
                isDisabled={isSaving}
                onClick={() =>
                  step === 'personal-details'
                    ? void navigate('/applications/current')
                    : void navigate(
                        `/applications/${applicationId}/personal-details`,
                      )
                }
              >
                Back
              </Button>
              <Button
                isDisabled={isSaving}
                onClick={() => void saveAnswers()}
                type="button"
              >
                Save
              </Button>
              <Button isDisabled={isSaving} type="submit">
                {step === 'personal-details' ? 'Continue' : 'Save and review'}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Box>
    </main>
  )
}
