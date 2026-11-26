import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import type { DisplayLanguage } from '../i18n';
import { preloadMatchAssets } from '../services/matchPreload';
import { getRoleShowcaseSpec, getShowcaseText } from '../services/roleShowcaseConfig';
import {
  createRoleShowcaseSession,
  type RoleShowcaseSession,
  type RoleShowcaseSnapshot,
  type ShowcaseCompleteReason,
  type ShowcaseMode,
} from '../services/roleShowcaseController';
import type { Role } from '../types';
import { getFocusLoopTarget } from './AccessibleDialog';
import RoleBadgeIcon from './RoleBadgeIcon';

export const INTRO_EXIT_MS = 450;

export interface RoleShowcaseModalProps {
  mode: ShowcaseMode;
  role: Role;
  boardName: string;
  language: DisplayLanguage;
  players: readonly { role: string; avatarUrl?: string }[];
  isMuted: boolean;
  ttsEnabled: boolean;
  audioVolume: number;
  returnFocusRef?: React.RefObject<HTMLElement>;
  onDone: () => void;
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const detectReducedMotion = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const getDialogButtons = (dialog: HTMLDialogElement): HTMLButtonElement[] =>
  Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).filter(
    button => !button.hidden && button.getAttribute('aria-hidden') !== 'true',
  );

const RoleShowcaseModal: React.FC<RoleShowcaseModalProps> = ({
  mode,
  role,
  boardName,
  language,
  players,
  isMuted,
  ttsEnabled,
  audioVolume,
  returnFocusRef,
  onDone,
}) => {
  const spec = getRoleShowcaseSpec(role);
  const roleTitle = getShowcaseText(spec.roleTitle, language);
  const subtitle = getShowcaseText(spec.subtitle, language);

  const [leaving, setLeaving] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const reduced = useRef(detectReducedMotion()).current;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const sessionRef = useRef<RoleShowcaseSession | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const exitStartedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const playersRef = useRef(players);
  playersRef.current = players;
  const audioPrefsRef = useRef({ isMuted, ttsEnabled, audioVolume });
  audioPrefsRef.current = { isMuted, ttsEnabled, audioVolume };

  const triggerExit = useCallback(() => {
    if (exitStartedRef.current) return;
    exitStartedRef.current = true;
    try { videoRef.current?.pause(); } catch { /* ignore */ }
    if (reduced) {
      onDoneRef.current();
      return;
    }
    setLeaving(true);
    exitTimerRef.current = window.setTimeout(() => onDoneRef.current(), INTRO_EXIT_MS);
  }, [reduced]);

  const requestFinish = useCallback((reason: ShowcaseCompleteReason) => {
    if (sessionRef.current) {
      sessionRef.current.complete(reason);
    } else {
      triggerExit();
    }
  }, [triggerExit]);

  useEffect(() => {
    if (mode === 'initial') {
      void preloadMatchAssets(playersRef.current, role);
    }
  }, [mode, role]);

  useEffect(() => {
    exitStartedRef.current = false;
    setLeaving(false);
    setVideoFailed(false);
    setVideoEnded(false);
    setImageFailed(false);
    setAutoplayBlocked(false);

    const session = createRoleShowcaseSession({
      mode,
      role,
      language,
      isMuted: audioPrefsRef.current.isMuted,
      ttsEnabled: audioPrefsRef.current.ttsEnabled,
      audioVolume: audioPrefsRef.current.audioVolume,
      prefersReducedMotion: reduced,
      onComplete: () => triggerExit(),
    });
    sessionRef.current = session;

    const unsubscribe = session.subscribe((snapshot: RoleShowcaseSnapshot) => {
      setAutoplayBlocked(snapshot.autoplayBlocked);
      if (snapshot.videoStatus === 'error') {
        setVideoFailed(true);
      }
    });

    session.start();

    return () => {
      unsubscribe();
      session.dispose();
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };
  }, [language, mode, reduced, role, triggerExit]);

  useEffect(() => {
    sessionRef.current?.updateAudioPreferences({ isMuted, ttsEnabled, audioVolume });
  }, [audioVolume, isMuted, ttsEnabled]);

  useIsomorphicLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    }
    skipRef.current?.focus({ preventScroll: true });

    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close();
      }
      const returnTarget = returnFocusRef?.current?.isConnected
        ? returnFocusRef.current
        : previousFocusRef.current?.isConnected
          ? previousFocusRef.current
          : null;
      if (document.activeElement === document.body || !document.activeElement || document.activeElement === dialog) {
        returnTarget?.focus({ preventScroll: true });
      }
    };
  }, [returnFocusRef]);

  const showVideo = !reduced && !videoFailed;

  return (
    <dialog
      ref={dialogRef}
      className={`match-intro role-showcase-dialog m-0 h-full max-h-none w-full max-w-none border-0${leaving ? ' is-leaving' : ''}`}
      aria-modal="true"
      aria-label={mode === 'initial' ? 'Match starting' : `${spec.roleTitle.en} role showcase`}
      data-showcase-mode={mode}
      data-role-slug={spec.slug}
      onCancel={event => {
        event.preventDefault();
        requestFinish('escape');
      }}
      onClick={event => {
        if (mode === 'initial' || event.target === event.currentTarget) {
          requestFinish(mode === 'initial' ? 'skip' : 'close');
        }
      }}
      onKeyDown={event => {
        if (event.key === 'Tab') {
          const dialog = dialogRef.current;
          if (!dialog) return;
          const buttons = getDialogButtons(dialog);
          const current = document.activeElement instanceof HTMLButtonElement
            ? document.activeElement
            : null;
          const target = getFocusLoopTarget(buttons, current, event.shiftKey);
          if (target !== undefined) {
            event.preventDefault();
            (target ?? skipRef.current)?.focus();
          }
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          requestFinish('escape');
          return;
        }

        if (
          mode === 'initial'
          && (event.key === 'Enter' || event.key === ' ')
          && (event.target === dialogRef.current || event.target === skipRef.current)
        ) {
          event.preventDefault();
          requestFinish('skip');
        }
      }}
    >
      <div className="role-showcase-card">
        <div className="role-showcase-stage">
          {showVideo ? (
            <video
              ref={videoRef}
              className="role-showcase-media"
              src={spec.entranceVideoSrc}
              poster={spec.portraitSrc}
              autoPlay
              muted
              playsInline
              preload="auto"
              onEnded={() => {
                setVideoEnded(true);
                sessionRef.current?.handleVideoEnded();
              }}
              onError={() => {
                setVideoFailed(true);
                sessionRef.current?.handleVideoError();
              }}
            />
          ) : !imageFailed ? (
            <img
              className="role-showcase-media"
              src={spec.portraitSrc}
              alt={spec.roleTitle.en}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="role-showcase-fallback" aria-hidden="true">
              <RoleBadgeIcon role={role} size={76} />
            </div>
          )}

          {showVideo && !imageFailed && (
            <img
              className={`role-showcase-still${videoEnded ? ' is-visible' : ''}`}
              src={spec.portraitSrc}
              alt=""
              aria-hidden="true"
              onError={() => setImageFailed(true)}
            />
          )}

          <div className="role-showcase-scrim" aria-hidden="true" />

          <div className="role-showcase-content">
            <p className="role-showcase-kicker">
              {mode === 'initial' ? boardName : 'Role Showcase'}
            </p>
            <h1
              className="role-showcase-title"
              data-ui-copy-category="AI_OR_PLAYER_SPEECH_OR_CHAT"
            >
              {roleTitle}
            </h1>
            <p
              className="role-showcase-subtitle"
              data-ui-copy-category="AI_OR_PLAYER_SPEECH_OR_CHAT"
            >
              {subtitle}
            </p>

            <div className="role-showcase-actions">
              {autoplayBlocked && (
                <button
                  type="button"
                  className="role-showcase-voice-btn"
                  onClick={event => {
                    event.stopPropagation();
                    void sessionRef.current?.playVoiceFromUserGesture();
                  }}
                >
                  <Volume2 size={16} aria-hidden="true" />
                  <span>Tap to play voice</span>
                </button>
              )}
              <button
                ref={skipRef}
                type="button"
                className="match-intro-skip role-showcase-skip cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                aria-label={mode === 'initial' ? 'Skip match intro' : 'Close role showcase'}
                onClick={event => {
                  event.stopPropagation();
                  requestFinish(mode === 'initial' ? 'skip' : 'close');
                }}
              >
                {mode === 'initial' ? 'Tap anywhere to skip' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
};

export default RoleShowcaseModal;
