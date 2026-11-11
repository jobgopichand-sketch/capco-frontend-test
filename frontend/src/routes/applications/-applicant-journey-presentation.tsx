import { Box, Button, Card, CardContent, Stack, Typography } from '@kyc/ui'

import styles from '../applicant-journey.module.css'

export type ApplicantJourneyStep = 'personal-details' | 'identity-and-address'
export type ApplicantJourneyStepState = 'complete' | 'current' | 'remaining'
export type ApplicantJourneyEntryState = 'start' | 'resume'

export interface ApplicantJourneyProgressItem {
  step: ApplicantJourneyStep
  state: ApplicantJourneyStepState
}

/**
 * Fixture-shaped presentation input mapped from the route's minimal feature model.
 */
export interface ApplicantJourneyPresentationFixture {
  entryState: ApplicantJourneyEntryState
  progress: readonly ApplicantJourneyProgressItem[]
}

export interface ApplicantJourneyPresentationProps extends ApplicantJourneyPresentationFixture {
  onPrimaryAction: () => void
  isPrimaryActionDisabled?: boolean
  primaryActionLabel?: string
}

export const applicantJourneyFixtures = {
  start: {
    entryState: 'start',
    progress: [
      { step: 'personal-details', state: 'current' },
      { step: 'identity-and-address', state: 'remaining' },
    ],
  },
  resume: {
    entryState: 'resume',
    progress: [
      { step: 'personal-details', state: 'current' },
      { step: 'identity-and-address', state: 'remaining' },
    ],
  },
} as const satisfies Record<
  ApplicantJourneyEntryState,
  ApplicantJourneyPresentationFixture
>

const copy = {
  start: {
    heading: 'Start your KYC application',
    description:
      'Your application has two short steps. Have your personal details, identity document, and residential address ready.',
    action: 'Start application',
  },
  resume: {
    heading: 'Resume your KYC application',
    description:
      'Your application is still a draft. Complete the remaining steps before review and submission.',
    action: 'Resume application',
  },
} as const

const stepNames: Record<ApplicantJourneyStep, string> = {
  'personal-details': 'Personal details',
  'identity-and-address': 'Identity and address',
}

const statusText: Record<ApplicantJourneyStepState, string> = {
  complete: 'Complete',
  current: 'Current step',
  remaining: 'Remaining',
}

export function ApplicantJourneyPresentation({
  entryState,
  progress,
  onPrimaryAction,
  isPrimaryActionDisabled = false,
  primaryActionLabel,
}: ApplicantJourneyPresentationProps) {
  const stateCopy = copy[entryState]

  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <CardContent className={styles.cardContent}>
          <Stack spacing={3}>
            <Stack spacing={1}>
              <Typography component="h1" variant="heading">
                {stateCopy.heading}
              </Typography>
              <Typography tone="muted" id="journey-description">
                {stateCopy.description}
              </Typography>
            </Stack>

            <Box aria-label="Application progress" component="section">
              <Typography component="h2" variant="subheading">
                Your progress
              </Typography>
              <Stack
                aria-label="Application progress"
                component="ol"
                className={styles.progressList}
                id="journey-progress"
                spacing={1}
              >
                {progress.map(({ step, state }, index) => (
                  <Box
                    aria-current={state === 'current' ? 'step' : undefined}
                    component="li"
                    key={step}
                    className={[
                      styles.progressItem,
                      state === 'current' && styles.current,
                      state === 'complete' && styles.complete,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Box
                      aria-hidden="true"
                      component="span"
                      className={styles.stepIndex}
                    >
                      {index + 1}
                    </Box>
                    <Box component="span" className={styles.stepName}>
                      {stepNames[step]}
                    </Box>
                    <Box component="span" className={styles.stepStatus}>
                      {statusText[state]}
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>

            <Button
              aria-describedby="journey-description journey-progress"
              isDisabled={isPrimaryActionDisabled}
              fullWidth
              onClick={onPrimaryAction}
              size="large"
              className={styles.action}
            >
              {primaryActionLabel ?? stateCopy.action}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </main>
  )
}
