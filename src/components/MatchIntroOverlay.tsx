import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  returnFocusRef: React.RefObject<HTMLElement>;
  onDone: () => void;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Opening ceremony. It doubles as the loading screen: it stays up until the
 * minimum beat has played and the match assets are warm (capped), so the
 * first speech and seat avatars never pop in. A click, Enter, Space, or Escape
 * skips the ceremony.
 */
const MatchIntroOverlay: React.FC<Props> = ({ boardName, roleLabel, players, returnFocusRef, onDone }) => {
  const [leaving, setLeaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const reduced = useRef(prefersReducedMotion()).current;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (reduced) { onDoneRef.current(); return; }
    setLeaving(true);
    exitTimerRef.current = window.setTimeout(() => onDoneRef.current(), INTRO_EXIT_MS);
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

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    skipRef.current?.focus({ preventScroll: true });

    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
      dialog.close();
      // The lobby's Start Game button has unmounted by the time the intro opens.
      if (document.activeElement === document.body) {
        returnFocusRef.current?.focus({ preventScroll: true });
      }
    };
  }, [returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className={`match-intro m-0 h-full max-h-none w-full max-w-none border-0${leaving ? ' is-leaving' : ''}`}
      aria-modal="true"
      aria-label="Match starting"
      onCancel={event => { event.preventDefault(); finish(); }}
      onClick={finish}
      onKeyDown={event => {
        if (event.key === 'Tab') {
          // The skip button is the dialog's only focusable control.
          event.preventDefault();
          skipRef.current?.focus();
        } else if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          finish();
        }
      }}
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
      <button ref={skipRef} type="button" className="match-intro-skip cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4" aria-label="Skip match intro">
        Tap anywhere to skip
      </button>
    </dialog>
  );
};

export default MatchIntroOverlay;
