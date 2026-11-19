import React from 'react';
import OnboardingSpotlight, { MATCH_SETUP_GUIDE, SINGLE_PLAYER_GUIDE } from './OnboardingSpotlight';

export type OnboardingStage = 'lobby' | 'single-player' | 'match-setup';

interface Props {
  stage: OnboardingStage;
  open: boolean;
  onSkip: () => void;
  onFinish: () => void;
}

/** Maps a tutorial stage to its steps so App can lazy-load the whole guide. */
const OnboardingStageSpotlight: React.FC<Props> = ({ stage, ...props }) => (
  <OnboardingSpotlight
    {...props}
    steps={stage === 'single-player' ? SINGLE_PLAYER_GUIDE : stage === 'match-setup' ? MATCH_SETUP_GUIDE : undefined}
    stepOffset={stage === 'lobby' ? 0 : stage === 'single-player' ? 4 : 5}
    totalSteps={6}
  />
);

export default OnboardingStageSpotlight;
