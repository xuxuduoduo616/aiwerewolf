import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { preloadMatchAssets, settleWithin } from '../services/matchPreload';

export const INTRO_MIN_MS = 1700;
export const INTRO_REDUCED_MIN_MS = 700;
export const INTRO_MAX_PRELOAD_MS = 5000;
export const INTRO_EXIT_MS = 450;

interface Props {
  boardName: string;
  roleLabel: string | null;
  players: readonly { role: string; avatarUrl?: string }[];
  onDone: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Opening ceremony. It doubles as the loading screen: it stays up until the
 * minimum beat has played and the match assets are warm (capped), so the
 * first speech and seat avatars never pop in. Any click or key skips it.
 */
const MatchIntroOverlay: React.FC<Props> = ({ boardName, roleLabel, players, onDone }) => {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const reduced = useRef(prefersReducedMotion()).current;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (reduced) { onDoneRef.current(); return; }
    setLeaving(true);
    window.setTimeout(() => onDoneRef.current(), INTRO_EXIT_MS);
  }, [reduced]);

  // Seat roster is fixed for the match; read it once when the ceremony opens.
  const playersRef = useRef(players);

  useEffect(() => {
    let cancelled = false;
    const minimum = new Promise<void>(resolve => window.setTimeout(resolve, reduced ? INTRO_REDUCED_MIN_MS : INTRO_MIN_MS));
    const ready = settleWithin(preloadMatchAssets(playersRef.current), INTRO_MAX_PRELOAD_MS);
    void Promise.all([minimum, ready]).then(() => { if (!cancelled) finish(); });
    return () => { cancelled = true; };
  }, [finish, reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  return (
    <div
      className={`match-intro${leaving ? ' is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Match starting"
      onClick={finish}
    >
      <div className="match-intro-moon" aria-hidden="true"><Moon size={40} /></div>
      <p className="match-intro-kicker">{boardName}</p>
      <h1 className="match-intro-title">Night 1</h1>
      <p className="match-intro-subtitle">The village falls asleep…</p>
      {roleLabel && (
        <div className="match-intro-role" role="status">
          <span>Your role</span>
          <strong>{roleLabel}</strong>
        </div>
      )}
      <p className="match-intro-skip">Tap anywhere to skip</p>
    </div>
  );
};

export default MatchIntroOverlay;
