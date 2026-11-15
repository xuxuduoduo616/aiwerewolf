import React, { useLayoutEffect, useRef, useState } from 'react';
import OnboardingSpotlight, { type OnboardingStep } from './OnboardingSpotlight';

const STEPS: readonly OnboardingStep[] = [
  { id: 'game-voice', selector: '[data-tour-target="game-voice"]', title: 'AI Voice',
    description: 'Turn spoken AI dialogue on or off. You can still read every speech in the game log.' },
  { id: 'game-volume', selector: '[data-tour-target="game-volume"]', title: 'Volume',
    description: 'Drag to adjust how loud AI voices play. New settings apply to the next speech.' },
  { id: 'game-rate', selector: '[data-tour-target="game-rate"]', title: 'Speech rate',
    description: 'Drag to make AI speech slower or faster. 1.0× is normal speed. Changes apply to the next speech.' },
  { id: 'game-mute', selector: '[data-tour-target="game-mute"]', title: 'Mute sound',
    description: 'Silence AI voices and countdown sounds without changing your volume or speech rate.' },
  { id: 'game-log', selector: '[data-tour-target="game-log"]', title: 'Game log and records',
    description: 'Open the match conversation and your past records here.' },
  { id: 'game-exit', selector: '[data-tour-target="game-exit"]', title: 'Exit the game',
    description: 'Leave this match and return to the lobby. During a match, you will be asked to confirm.' },
];

interface Props {
  principalId: string;
  seenThisSession: Set<string>;
  isPaused: boolean;
  togglePause: () => void;
}

/** Mounted only after Start Game; the lobby guide and its rewards stay separate. */
export default function GameControlsGuide({ principalId, seenThisSession, isPaused, togglePause }: Props) {
  const storageKey = `aiwerewolf:game-controls-guide:v1:${principalId}`;
  const [open, setOpen] = useState(() => {
    if (seenThisSession.has(principalId)) return false;
    try { return window.localStorage.getItem(storageKey) !== 'seen'; }
    catch { return true; }
  });
  const latest = useRef({ isPaused, togglePause });
  latest.current = { isPaused, togglePause };

  useLayoutEffect(() => {
    if (!open || latest.current.isPaused) return;
    // Own only the pause introduced here. Setup/cleanup also pair in StrictMode.
    latest.current.togglePause();
    return () => latest.current.togglePause();
  }, [open]);

  const close = () => {
    seenThisSession.add(principalId);
    try { window.localStorage.setItem(storageKey, 'seen'); } catch { /* Session deduplication still works. */ }
    setOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-tour-target="game-voice"]')?.focus({ preventScroll: true });
    });
  };

  return <OnboardingSpotlight open={open} steps={STEPS} onSkip={close} onFinish={close} />;
}
