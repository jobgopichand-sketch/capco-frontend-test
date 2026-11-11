import { Alert, Button, Link, Stack, Typography } from '@kyc/ui'
import { useState } from 'react'
import { useNavigate, useRevalidator } from 'react-router'

import {
  ApplicantJourneyPresentation,
  type ApplicantJourneyPresentationFixture,
} from './-applicant-journey-presentation'
import {
  createCurrentApplication,
  loadCurrentApplication,
  type CurrentApplication,
  type CurrentApplicationResult,
} from './-application-loading'

import type { Route } from './+types/current'

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  return loadCurrentApplication(request.signal)
}

export default function CurrentApplicationJourneyPage({
  loaderData,
}: Route.ComponentProps) {
  return <CurrentApplicationJourneyView loaderData={loaderData} />
}

export function CurrentApplicationJourneyView({
  loaderData,
}: {
  loaderData: CurrentApplicationResult
}) {
  const navigate = useNavigate()
  const [isStarting, setIsStarting] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [needsSignIn, setNeedsSignIn] = useState(false)

  if (loaderData.kind === 'unauthenticated' || needsSignIn) {
    return (
      <Stack spacing={2}>
        <Typography component="h1" variant="heading">
          Sign in to access your application
        </Typography>
        <Typography>
          Your session may have expired. Sign in to continue.
        </Typography>
        <Link href="/sign-in?returnTo=%2Fapplications%2Fcurrent">Sign in</Link>
      </Stack>
    )
  }

  if (loaderData.kind === 'error') {
    return <CurrentApplicationLoadError message={loaderData.message} />
  }

  const existingApplication =
    loaderData.kind === 'draft' ? loaderData.application : undefined
  const fixture = presentationFixture(existingApplication)

  async function continueJourney(): Promise<void> {
    setActionError(undefined)
    if (existingApplication) {
      void navigate(
        `/applications/${existingApplication.id}/${existingApplication.currentStep}`,
      )
      return
    }

    setIsStarting(true)
    const result = await createCurrentApplication()
    setIsStarting(false)
    if (result.kind === 'unauthenticated') {
      setNeedsSignIn(true)
    } else if (result.kind === 'error') {
      setActionError(result.message)
    } else {
      void navigate(
        `/applications/${result.application.id}/${result.application.currentStep}`,
      )
    }
  }

  return (
    <Stack spacing={2}>
      {actionError ? (
        <Alert role="alert" severity="error">
          {actionError}
        </Alert>
      ) : null}
      {isStarting ? (
        <Alert aria-live="polite" severity="info">
          Starting your application…
        </Alert>
      ) : null}
      <ApplicantJourneyPresentation
        {...fixture}
        isPrimaryActionDisabled={isStarting}
        onPrimaryAction={() => void continueJourney()}
        primaryActionLabel={isStarting ? 'Starting…' : undefined}
      />
    </Stack>
  )
}

function CurrentApplicationLoadError({ message }: { message: string }) {
  const revalidator = useRevalidator()
  return (
    <Stack spacing={2}>
      <Alert role="alert" severity="error">
        {message}
      </Alert>
      <Button
        isDisabled={revalidator.state !== 'idle'}
        onClick={() => revalidator.revalidate()}
      >
        Retry
      </Button>
    </Stack>
  )
}

function presentationFixture(
  application?: CurrentApplication,
): ApplicantJourneyPresentationFixture {
  if (!application) {
    return {
      entryState: 'start',
      progress: [
        { step: 'personal-details', state: 'current' },
        { step: 'identity-and-address', state: 'remaining' },
      ],
    }
  }

  const steps = ['personal-details', 'identity-and-address'] as const
  return {
    entryState: 'resume',
    progress: steps.map((step) => {
      const progress = application.progress.find((item) => item.step === step)
      let state: ApplicantJourneyPresentationFixture['progress'][number]['state']
      if (progress?.state === 'complete') {
        state = 'complete'
      } else if (step === application.currentStep) {
        state = 'current'
      } else {
        state = 'remaining'
      }
      return { step, state }
    }),
  }
}
