import React, { useEffect, useRef, useState } from 'react';
import {
  Difficulty,
  DIFFICULTY_CONFIGS,
  GameConfig,
  GameLog,
  GamePhase,
  GameRecord,
  NightState,
  Player,
  Role,
  SupabaseSession,
  UserProfile,
  VoteRecord,
  Winner,
  WolfChatMessage,
} from '../types';
import { AI_NAMES, AVATAR_SEEDS } from '../constants';
import { generateAIAction, generateAIDialogue, generateWolfChat, resetAIMemory, setAIDifficulty } from '../ai/aiOrchestrator';
import { CUSTOM_AI_STYLES, pickRolePersona } from '../services/aiStyles';
import {
  applyElimination,
  applyNightResolution,
  buildGameRecordSummary,
  createSuspicionMap,
  createVoteRecords,
  getRoleCamp,
  isTargetableAliveOther,
  normalizeHumanSpeech,
  resolveVoteResult,
} from '../gameEngine';
import { isSupabaseConfigured, saveGameRecord } from '../services/supabaseClient';
import { DEFAULT_DISPLAY_LANGUAGE, pickTranslationSource, type DisplayLanguage } from '../i18n';
import * as speechAudio from '../services/speechAudio';
import { endMatch, startMatch } from '../services/matchTelemetry';
import { globalBeliefTracker } from '../ai/beliefTracker';
import { createReplayRecorder, saveReplay, type ReplayRecorder } from '../replay';

const AI_STYLE_KEYS = Object.keys(CUSTOM_AI_STYLES);
const MY_PLAYER_ID = 1;
const ROLE_LABELS_EN: Record<Role, string> = {
  [Role.WEREWOLF]: 'Werewolf',
  [Role.VILLAGER]: 'Villager',
  [Role.SEER]: 'Seer',
  [Role.WITCH]: 'Witch',
  [Role.HUNTER]: 'Hunter',
  [Role.IDIOT]: 'Idiot',
};
const ROLE_DESCRIPTIONS_EN: Record<Role, string> = {
  [Role.WEREWOLF]: 'Choose a victim with your pack at night and conceal your identity during the day.',
  [Role.VILLAGER]: 'Find the werewolves through speeches, votes, and deduction.',
  [Role.SEER]: 'Check one player each night to learn whether they are a werewolf.',
  [Role.WITCH]: 'Use one antidote and one poison during the game.',
  [Role.HUNTER]: 'When killed normally, you may shoot one player.',
  [Role.IDIOT]: 'If exiled, reveal and survive but lose your vote.',
};

/**
 * Audio preferences (card: browser-tts-mvp), persisted with the same
 * try/catch localStorage pattern as the language pill (src/i18n/index.ts).
 * `isMuted` stays session-only exactly as before this card.
 */
const AUDIO_PREFS_KEY = 'werewolf_audio_prefs';

interface AudioPrefs {
  volume: number;   // 0–1, master volume
  rate: number;     // 0.5–2, speech rate
  enabled: boolean; // AI-voice toggle (default off — needs a user gesture)
}

const DEFAULT_AUDIO_PREFS: AudioPrefs = { volume: 1, rate: 1, enabled: true };

const loadAudioPrefs = (): AudioPrefs => {
  try {
    const stored = localStorage.getItem(AUDIO_PREFS_KEY);
    if (!stored) return DEFAULT_AUDIO_PREFS;
    const parsed = JSON.parse(stored) as Partial<AudioPrefs>;
    return {
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_AUDIO_PREFS.volume,
      rate: typeof parsed.rate === 'number' ? Math.max(0.5, Math.min(2, parsed.rate)) : DEFAULT_AUDIO_PREFS.rate,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_AUDIO_PREFS.enabled,
    };
  } catch {
    return DEFAULT_AUDIO_PREFS;
  }
};

const saveAudioPrefs = (prefs: AudioPrefs): void => {
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable (private mode) — prefs stay in memory.
  }
};

/**
 * P0 fix (dead-player-vote-autoresolve): during DAY_VOTING the phase driver
 * must auto-resolve the vote when the human has no vote (dead, or vote lost
 * e.g. revealed Idiot) — otherwise nothing ever calls finishVote and the game
 * soft-locks until the dead spectator clicks "NO VOTE". A living human who
 * can vote is still waited on indefinitely.
 */
export const shouldAutoResolveVote = (
  phase: GamePhase,
  me: Pick<Player, 'isAlive' | 'canVote'> | undefined
): boolean => phase === GamePhase.DAY_VOTING && !(me?.isAlive && me.canVote);

/** Vote-phase countdown duration in ms. Single definition — no scattered 10s. */
export const VOTE_DURATION_MS = 10_000;

/** Module-level injectable clock. Tests override with vi.spyOn or direct assignment. */
export let nowFn: () => number = () => Date.now();

/**
 * Pure helper: derive displayed seconds from a fixed deadline.
 * Returns ceil((deadline - now) / 1000), floored at 0 (never negative).
 * Background-tab safe: recomputes from the deadline, not a decrement counter.
 */
export const computeVoteRemaining = (deadline: number, now: number): number =>
  Math.max(0, Math.ceil((deadline - now) / 1000));

/**
 * Pure predicate: has the vote deadline been reached?
 * null deadline (inactive/cleared timer) always returns false.
 */
export const shouldAutoResolveVoteTimeout = (
  deadline: number | null,
  now: number,
): boolean => deadline !== null && now >= deadline;

/**
 * P0 fix (night-pipeline-exception-safety): every isProcessingAI block must
 * reset the flag even when an AI call rejects (e.g. the dynamic geminiAdapter
 * chunk failing to load after a redeploy). Without this, the phase driver
 * early-returns on isProcessingAI forever and the game wedges on the
 * "AI正在思考局势..." spinner.
 *
 * Never rejects: errors are routed to onError so callers can log a system
 * line and apply a safe default action; the flag always resets in finally,
 * and the caller's phase advance after the await runs on both paths.
 */
export const runAIPhaseSafely = async (
  setProcessing: (value: boolean) => void,
  task: () => Promise<void>,
  onError: (error: unknown) => void,
  commit: (work: () => void) => void | Promise<void> = work => work(),
): Promise<void> => {
  setProcessing(true);
  try {
    await task();
  } catch (error) {
    await commit(() => onError(error));
  } finally {
    await commit(() => setProcessing(false));
  }
};

/**
 * lobby-language-authority: the lobby selection is snapshotted once at
 * startGame as the fixed game language for all AI generation; a missing value
 * uses the English default.
 */
export const resolveGameLanguage = (language?: DisplayLanguage): DisplayLanguage =>
  language ?? DEFAULT_DISPLAY_LANGUAGE;

export const scrollLogTailIntoView = (
  element: Pick<Element, 'scrollIntoView'> | null,
): void => {
  element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/**
 * P0 fix (speech-timer-autoskip-fix): the speech-timer tick must land on 0 so
 * the auto-skip effect can fire. The old tick jumped 1 → null, and the
 * auto-skip guard (speechTimer !== 0) then early-returned forever — the human
 * speech phase permanently stalled. An inactive timer (null) stays null; an
 * active timer counts down to 0, never negative, and stays at 0 until the
 * timer effect resets it.
 */
export const tickSpeechTimer = (value: number | null): number | null => {
  if (value === null) return null;
  return Math.max(0, value - 1);
};

/**
 * Auto-skip guard: fires only when an active speech timer has reached 0 AND
 * the current speaker is the human. An inactive timer (null) or a non-human
 * speaker never triggers it.
 */
export const shouldAutoSkipSpeech = (
  speechTimer: number | null,
  currentSpeakerId: number | undefined
): boolean => speechTimer === 0 && currentSpeakerId === MY_PLAYER_ID;

/**
 * Pure helper: derive the speaking-status badge for a single player card so
 * the logic can be unit-tested without jsdom.
 */
export const computeSpeakingStatus = (
  playerId: number,
  isAlive: boolean,
  currentSpeakerId: number | undefined,
  spokenPlayerIds: Set<number>,
  phase: GamePhase
): 'speaking' | 'spoken' | 'pending' | 'none' => {
  if (phase !== GamePhase.DAY_DISCUSSION) return 'none';
  if (!isAlive) return 'none';
  if (currentSpeakerId === playerId) return 'speaking';
  if (spokenPlayerIds.has(playerId)) return 'spoken';
  return 'pending';
};

export const resolvePublicPlayerName = (publicName: string): string | null => {
  const normalized = publicName.trim();
  return normalized || null;
};

export interface AuthContext {
  session: SupabaseSession | null;
  isGuest: boolean;
  profile: UserProfile | null;
  records: GameRecord[];
  setRecords: React.Dispatch<React.SetStateAction<GameRecord[]>>;
  recordError: string;
  setRecordError: React.Dispatch<React.SetStateAction<string>>;
  authEmail: string;
  guestPrincipalId: string | null;
  publicName: string;
}

interface PhaseScope {
  phase: GamePhase;
  wolfChatStarted: boolean;
}

interface PlayerClock {
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export function useGameState(authContext: AuthContext) {
  const { session, isGuest, records, setRecords, setRecordError, guestPrincipalId, publicName } = authContext;

  const [config, setConfig] = useState<GameConfig | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [gameLanguage, setGameLanguage] = useState<DisplayLanguage>(DEFAULT_DISPLAY_LANGUAGE);
  const [players, setPlayers] = useState<Player[]>([]);
  const [phaseScope, setPhaseScope] = useState<PhaseScope>({ phase: GamePhase.LOBBY, wolfChatStarted: false });
  const { phase } = phaseScope;
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [witchStatus, setWitchStatus] = useState({ hasSave: true, hasPoison: true });
  const [nightState, setNightState] = useState<NightState>({ wolfKillId: null, witchPoisonId: null, witchSaved: false });
  const [roundCount, setRoundCount] = useState(0);
  const [winner, setWinner] = useState<Winner>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  // Keep a fresh view state even if two toggles are batched into one render,
  // so a cancelled phase delay is always rearmed when running.
  const [pause, setPause] = useState({ isPaused: false });
  const [isMuted, setIsMuted] = useState(false);
  // Audio prefs (browser-tts-mvp): restored from localStorage, synced to the
  // speechAudio service below. ttsEnabled defaults to OFF — flipping the
  // header toggle is the explicit user gesture the autoplay policy requires.
  const [audioVolume, setAudioVolume] = useState<number>(() => loadAudioPrefs().volume);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => loadAudioPrefs().enabled);
  const [ttsRate, setTtsRate] = useState<number>(() => loadAudioPrefs().rate);
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [userInput, setUserInput] = useState('');
  const [aiSeerLastCheck, setAiSeerLastCheck] = useState<{ targetId: number; isGood: boolean } | null>(null);
  const [speakingQueue, setSpeakingQueue] = useState<Player[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState<Player | null>(null);
  const [deadThisRound, setDeadThisRound] = useState<number[]>([]);
  const [voteRecords, setVoteRecords] = useState<VoteRecord[]>([]);
  const [wolfChat, setWolfChat] = useState<WolfChatMessage[]>([]);
  const [wolfCountdown, setWolfCountdown] = useState<number | null>(null);
  const [pendingHunterId, setPendingHunterId] = useState<number | null>(null);
  const [hunterReturnPhase, setHunterReturnPhase] = useState<GamePhase.DAY_DISCUSSION | GamePhase.NIGHT_START>(GamePhase.DAY_DISCUSSION);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  // NetEase rule: speech timer (60s per player)
  const [speechTimer, setSpeechTimer] = useState<number | null>(null);
  // Vote countdown: deadline-based timer for human during DAY_VOTING (10s)
  const [voteTimer, setVoteTimer] = useState<number | null>(null);
  // Track last eliminated player for clockwise speaking order
  const [lastEliminatedId, setLastEliminatedId] = useState<number | null>(null);
  // Per-player "finished speaking" tracking for the current day round
  const [spokenPlayerIds, setSpokenPlayerIds] = useState<Set<number>>(new Set());

  const SPEECH_DURATION = 60; // seconds per player

  const logsEndRef = useRef<HTMLDivElement>(null);
  const matchGenerationRef = useRef(0);
  const matchActiveRef = useRef(false);
  const phaseScopeRef = useRef(phaseScope);
  const processingScopeRef = useRef<PhaseScope | null>(null);
  const pausedRef = useRef(false);
  const resumeWaitersRef = useRef(new Set<() => void>());
  const phaseDelayRef = useRef<(() => void) | null>(null);
  const playerClockRef = useRef<PlayerClock | null>(null);
  const saveStartedGenerationRef = useRef<number | null>(null);
  const timerCleanupsRef = useRef(new Set<() => void>());
  // H2-A: replay capture stays in memory for the whole match and is persisted
  // exactly once at GAME_OVER. The refs below only guard against duplicate
  // recording; they do not participate in the phase machine.
  const replayRecorderRef = useRef<ReplayRecorder | null>(null);
  const replaySavedRef = useRef(false);
  const replayLastBeliefRoundRef = useRef<number | null>(null);
  const replayLastPhaseKeyRef = useRef<string | null>(null);
  const generation = matchGenerationRef.current;
  const isCurrentMatch = () => matchActiveRef.current && generation === matchGenerationRef.current;
  const isCurrentPhase = () => isCurrentMatch() && phaseScopeRef.current === phaseScope;
  const canProgress = () => isCurrentPhase() && !pausedRef.current
    && phase !== GamePhase.LOBBY && phase !== GamePhase.LOGIN && phase !== GamePhase.GAME_OVER;

  const trackTimer = (cleanup: () => void) => {
    const release = () => {
      cleanup();
      timerCleanupsRef.current.delete(release);
    };
    timerCleanupsRef.current.add(release);
    return release;
  };

  const wakeWaiters = () => {
    for (const resume of resumeWaitersRef.current) resume();
    resumeWaitersRef.current.clear();
  };

  const stopPlayerClock = () => {
    playerClockRef.current?.stop();
    playerClockRef.current = null;
  };

  const clearPhaseWork = () => {
    phaseDelayRef.current = null;
    for (const cleanup of timerCleanupsRef.current) cleanup();
    stopPlayerClock();
    processingScopeRef.current = null;
    wakeWaiters();
  };

  const setPhase = (nextPhase: GamePhase) => {
    if (phaseScopeRef.current.phase === nextPhase) return;
    const nextScope = { phase: nextPhase, wolfChatStarted: false };
    phaseScopeRef.current = nextScope;
    clearPhaseWork();
    setIsProcessingAI(false);
    setPhaseScope(nextScope);
  };

  const invalidateMatch = () => {
    matchGenerationRef.current += 1;
    matchActiveRef.current = false;
    pausedRef.current = false;
    clearPhaseWork();
    speechAudio.cancel();
  };

  const togglePause = () => {
    if (!isCurrentPhase() || phase === GamePhase.GAME_OVER || phase === GamePhase.LOBBY || phase === GamePhase.LOGIN) return;
    const isPaused = !pausedRef.current;
    pausedRef.current = isPaused;
    setPause({ isPaused });
    if (isPaused) {
      phaseDelayRef.current?.();
      phaseDelayRef.current = null;
      playerClockRef.current?.pause();
      speechAudio.pause();
    } else {
      playerClockRef.current?.resume();
      speechAudio.resume();
      wakeWaiters();
    }
  };

  // Check and execute in the same turn of the event loop. An await followed
  // by a separate commit would let a new pause land between them.
  const runWhenActive = async <T,>(work: () => T | Promise<T>): Promise<T | undefined> => {
    while (isCurrentPhase() && pausedRef.current) {
      await new Promise<void>(resolve => resumeWaitersRef.current.add(resolve));
    }
    if (isCurrentPhase()) return work();
  };

  // Resolving a cancelled delay lets its caller exit through the generation
  // check without leaving a pending promise or running another AI request.
  const waitForMatch = (ms: number) => new Promise<void>(resolve => {
    const timer = window.setTimeout(() => release(), ms);
    const release = trackTimer(() => { window.clearTimeout(timer); resolve(); });
  });

  const runCurrentAIPhase = async (task: () => Promise<void>, onError: (error: unknown) => void) => {
    if (!canProgress() || processingScopeRef.current) return;
    processingScopeRef.current = phaseScope;
    await runAIPhaseSafely(value => {
      if (!value) processingScopeRef.current = null;
      setIsProcessingAI(value);
    }, task, onError, runWhenActive);
  };

  const leaveGame = () => {
    if (!matchActiveRef.current) return;
    // H1-F: only a match without a winner is an abandonment. A match that
    // already reached GAME_OVER was finalized by the effect below, and
    // `endMatch` would be a no-op anyway.
    if (!winner) endMatch({ completed: false, phase, rounds: roundCount });
    invalidateMatch();
    setPause({ isPaused: false });
    setIsProcessingAI(false);
    setCurrentSpeaker(null);
    setSpeechTimer(null);
    setWolfCountdown(null);
    setVoteTimer(null);
    setSelectedPlayerId(null);
    setUserInput('');
    setPhase(GamePhase.LOBBY);
  };

  useEffect(() => () => invalidateMatch(), []);

  const me = players.find(player => player.id === MY_PLAYER_ID);

  /**
   * H2-A: project the frozen belief tracker into replay snapshots for one
   * round. Only living AI seats are read; each target list is filtered to the
   * seats that were alive at capture time, so `scores.length === alive - 1`.
   * This is a read-only `snapshot()` call — no belief state is modified.
   */
  const recordReplayBeliefSnapshots = (round: number) => {
    const recorder = replayRecorderRef.current;
    if (!recorder || !matchActiveRef.current) return;
    if (replayLastBeliefRoundRef.current === round) return;
    const alive = players.filter(player => player.isAlive);
    const snapshots = alive
      .filter(player => !player.isHuman)
      .map(player => ({
        round,
        actorId: player.id,
        scores: globalBeliefTracker
          .snapshot(player.id)
          .filter(entry => entry.targetId !== player.id && alive.some(candidate => candidate.id === entry.targetId))
          .map(entry => ({ targetId: entry.targetId, score: entry.score })),
      }))
      // A tracker that has not been initialized yet has no beliefs to record.
      .filter(snapshot => snapshot.scores.length > 0);
    if (snapshots.length === 0) return;
    replayLastBeliefRoundRef.current = round;
    recorder.recordBeliefSnapshots(snapshots);
  };

  // H2-A: capture the ordered phase sequence from state. setPhase() and the
  // transition driver are untouched; this effect only reads them.
  useEffect(() => {
    const recorder = replayRecorderRef.current;
    if (!recorder || !matchActiveRef.current) return;
    const key = `${phase}:${roundCount}`;
    if (replayLastPhaseKeyRef.current === key) return;
    replayLastPhaseKeyRef.current = key;
    recorder.recordPhase(phase, roundCount);
  }, [phase, roundCount]);

  // Scroll logs to bottom
  useEffect(() => {
    scrollLogTailIntoView(logsEndRef.current);
  }, [logs, currentSpeaker, wolfChat]);

  // Audio: mute cancels current speech immediately (speechAudio owns the API).
  useEffect(() => {
    speechAudio.setMuted(isMuted);
  }, [isMuted]);

  // Audio: sync preferences into the service and persist them (same
  // localStorage pattern as the language pill).
  useEffect(() => {
    speechAudio.setVolume(audioVolume);
    speechAudio.setRate(ttsRate);
    speechAudio.setEnabled(ttsEnabled);
    saveAudioPrefs({ volume: audioVolume, rate: ttsRate, enabled: ttsEnabled });
  }, [audioVolume, ttsRate, ttsEnabled]);

  // Audio: any phase change (incl. game over and returning to the lobby)
  // cancels in-flight speech. Presentation-only — never touches game flow.
  useEffect(() => {
    speechAudio.cancel();
  }, [phase]);

  // At most one player clock is active. Store milliseconds when paused,
  // including the fractional second hidden by the displayed timer.
  useEffect(() => {
    const wolfPhase = phase === GamePhase.NIGHT_WEREWOLVES;
    const humanVoting = phase === GamePhase.DAY_VOTING && me?.isAlive && me.canVote;
    const humanSpeaking = phase === GamePhase.DAY_DISCUSSION && currentSpeaker?.id === MY_PLAYER_ID;
    if (!wolfPhase) setWolfCountdown(null);
    if (!humanVoting) setVoteTimer(null);
    if (!humanSpeaking) setSpeechTimer(null);
    if (!isCurrentPhase() || (!wolfPhase && !humanVoting && !humanSpeaking)) return;
    if (humanVoting && processingScopeRef.current) return;

    const setRemaining = wolfPhase ? setWolfCountdown : humanVoting ? setVoteTimer : setSpeechTimer;
    const onTimeout = wolfPhase ? expireWolfChoice : humanVoting ? () => finishVote(null) : expireHumanSpeech;
    let remainingMs = wolfPhase ? 20_000 : humanVoting ? VOTE_DURATION_MS : SPEECH_DURATION * 1000;
    let deadline = 0;
    let timer: number;
    const stop = () => window.clearTimeout(timer);
    const showRemaining = () => setRemaining(computeVoteRemaining(remainingMs, 0));
    const schedule = () => {
      const untilNextTick = remainingMs > 0 ? remainingMs % 1000 || 1000 : 0;
      timer = window.setTimeout(() => {
        if (!canProgress() || playerClockRef.current !== clock) return;
        remainingMs = Math.max(0, deadline - nowFn());
        showRemaining();
        if (remainingMs > 0) {
          schedule();
        } else {
          playerClockRef.current = null;
          onTimeout();
        }
      }, untilNextTick);
    };
    const clock: PlayerClock = {
      pause: () => {
        stop();
        remainingMs = Math.max(0, deadline - nowFn());
        showRemaining();
      },
      resume: () => {
        deadline = nowFn() + remainingMs;
        schedule();
      },
      stop,
    };
    playerClockRef.current = clock;
    showRemaining();
    if (!pausedRef.current) clock.resume();
    return () => {
      stop();
      if (playerClockRef.current === clock) playerClockRef.current = null;
    };
  }, [phaseScope, generation, roundCount, currentSpeaker, me?.isAlive, me?.canVote]);

  // Phase transition driver
  useEffect(() => {
    if (!canProgress() || winner || !players.length || processingScopeRef.current) return;
    const timer = window.setTimeout(() => {
      release();
      if (!canProgress() || processingScopeRef.current) return;
      if (phase === GamePhase.NIGHT_START) beginNight();
      else if (phase === GamePhase.NIGHT_WEREWOLVES) handleWerewolfPhase();
      else if (phase === GamePhase.NIGHT_SEER) handleSeerPhase();
      else if (phase === GamePhase.NIGHT_WITCH) handleWitchPhase();
      else if (phase === GamePhase.DAY_ANNOUNCE) handleDayAnnounce();
      else if (phase === GamePhase.DAY_HUNTER_CHECK) handleHunterCheck();
      else if (phase === GamePhase.DAY_DISCUSSION) handleDiscussion();
      else if (shouldAutoResolveVote(phase, me)) finishVote(null);
    }, 700);

    const release = trackTimer(() => {
      window.clearTimeout(timer);
      if (phaseDelayRef.current === release) phaseDelayRef.current = null;
    });
    phaseDelayRef.current = release;
    return release;
  }, [phaseScope, generation, pause, players, isProcessingAI, winner, currentSpeaker, speakingQueue, deadThisRound, nightState]);

  // Game record saving
  useEffect(() => {
    if (!isCurrentMatch() || !winner || !config || !me || savedRecordId || saveStartedGenerationRef.current === generation) return;
    saveStartedGenerationRef.current = generation;

    const userWon = (winner === 'WEREWOLVES' && me.role === Role.WEREWOLF) || (winner === 'VILLAGERS' && me.role !== Role.WEREWOLF);
    const summary = buildGameRecordSummary(config, me.role, winner, roundCount, logs);
    const baseRecord = {
      userId: session?.user.id ?? guestPrincipalId ?? '',
      boardId: config.id,
      role: me.role,
      result: userWon ? 'WIN' as const : 'LOSE' as const,
      rounds: Math.max(1, roundCount),
      summary,
    };

    if (session && !isGuest && isSupabaseConfigured()) {
      saveGameRecord(session, baseRecord)
        .then(record => {
          if (!isCurrentMatch()) return;
          setRecords(prev => [record, ...prev]);
          setSavedRecordId(record.id);
        })
        .catch(error => {
          if (!isCurrentMatch()) return;
          setRecordError(error.message || 'Could not save the game record.');
          setSavedRecordId('failed');
        });
    } else if (isGuest && guestPrincipalId) {
      // Only a transient completion ID is needed by the existing cosmetic reward
      // gate. Guest matches never enter history or browser storage.
      setSavedRecordId(`guest-match-${generation}-${Date.now()}`);
    } else {
      setRecordError('A public identity is required before saving a game record.');
      setSavedRecordId('failed');
    }
  }, [winner, config, me, savedRecordId, roundCount, logs, session, isGuest, guestPrincipalId, records]);

  // H1-D/H1-F: close the per-match telemetry aggregate exactly when the match
  // ends. `endMatch` is idempotent, so repeated renders or a following
  // leaveGame() cannot double-record.
  useEffect(() => {
    if (winner && phase === GamePhase.GAME_OVER) endMatch({ completed: true, winner, rounds: roundCount });
  }, [winner, phase, roundCount]);

  // H2-A: persist exactly one replay, only once the match reached GAME_OVER.
  // The guard ref, the recorder's one-shot finalize and saveReplay's gameId
  // upsert all defend the "one record per match" rule independently.
  useEffect(() => {
    const recorder = replayRecorderRef.current;
    if (!recorder || !isCurrentMatch() || !winner || phase !== GamePhase.GAME_OVER) return;
    if (replaySavedRef.current) return;
    replaySavedRef.current = true;
    try {
      const rounds = Math.max(1, roundCount);
      // A round that ended at night (or with the hunter shot) has no vote
      // settlement point, so capture its final snapshot here.
      recordReplayBeliefSnapshots(rounds);
      const record = recorder.finalize({ winner, rounds });
      if (record) saveReplay(record);
    } catch {
      // Replay capture is observational; it must never interrupt the match.
    }
  }, [winner, phase, roundCount, players]);

  const addLog = (
    message: string,
    isSystem: boolean,
    speakerId?: number,
    translation?: string,
    tone: GameLog['tone'] = isSystem ? 'system' : 'speech'
  ): string => {
    const id = `${Date.now()}-${Math.random()}`;
    setLogs(prev => [
      ...prev,
      {
        id,
        phase,
        message,
        translation,
        isSystem,
        speakerId,
        tone,
      },
    ]);
    return id;
  };

  const startGame = (nextConfig: GameConfig, language?: DisplayLanguage) => {
    const playerName = resolvePublicPlayerName(publicName);
    if (!playerName) {
      setRecordError('A public identity is required before starting a game.');
      return;
    }
    invalidateMatch();
    matchActiveRef.current = true;
    const nextLanguage = resolveGameLanguage(language);
    startMatch({ boardId: nextConfig.id, difficulty, language: nextLanguage, isGuest });
    setPause({ isPaused: false });
    setIsProcessingAI(false);
    setSpeechTimer(null);
    setWolfCountdown(null);
    setVoteTimer(null);
    resetAIMemory();
    speechAudio.reset(); // new game: cancel audio, clear play-once dedupe
    setGameLanguage(nextLanguage);
    setAIDifficulty(DIFFICULTY_CONFIGS[difficulty].actionAccuracy);
    const shuffledRoles = [...nextConfig.roles].sort(() => Math.random() - 0.5);
    const wolfIndices: number[] = [];
    const basePlayers: Player[] = shuffledRoles.map((role, index) => {
      const isHuman = index === 0;
      const styleKey = AI_STYLE_KEYS[Math.floor(Math.random() * AI_STYLE_KEYS.length)];
      const styleConf = CUSTOM_AI_STYLES[styleKey];
      if (role === Role.WEREWOLF && !isHuman) wolfIndices.push(index);

      return {
        id: index + 1,
        name: isHuman ? playerName : AI_NAMES[index % AI_NAMES.length],
        role,
        camp: getRoleCamp(role),
        isAlive: true,
        canVote: true,
        isRevealed: false,
        avatarUrl: `https://api.dicebear.com/7.x/notionists/svg?seed=${isHuman ? 'MySelf' : AVATAR_SEEDS[index % AVATAR_SEEDS.length]}&backgroundColor=transparent`,
        aiPersonality: isHuman ? 'Human' : styleConf.label,
        aiModelLabel: isHuman ? 'HUMAN' : styleKey,
        traits: isHuman ? [] : [styleKey],
        isHuman,
        isWolfHopper: false,
        publicClaims: [],
        privateKnowledge: [],
        suspicionMap: {},
      };
    });

    if (wolfIndices.length > 0) {
      basePlayers[wolfIndices[Math.floor(Math.random() * wolfIndices.length)]].isWolfHopper = true;
    }

    const nextPlayers = basePlayers.map(player => ({
      ...player,
      ...(!player.isHuman && { aiSpeechPersonaId: pickRolePersona().id }),
      suspicionMap: createSuspicionMap(player.id, basePlayers),
      privateKnowledge: player.role === Role.WEREWOLF
        ? [`狼队友：${basePlayers.filter(p => p.role === Role.WEREWOLF && p.id !== player.id).map(p => `${p.id}号`).join('、') || '无'}`]
        : [],
    }));

    // H2-A: a fresh in-memory recorder per match. It snapshots the roster as
    // seat + role + isHuman only (never the player name) and writes nothing
    // until the GAME_OVER effect finalizes it.
    replayRecorderRef.current = createReplayRecorder({
      boardId: nextConfig.id,
      difficulty,
      language: nextLanguage,
      isGuest,
      players: nextPlayers.map(player => ({ seat: player.id, role: player.role, isHuman: player.isHuman })),
    });
    replaySavedRef.current = false;
    replayLastBeliefRoundRef.current = null;
    replayLastPhaseKeyRef.current = null;

    setConfig(nextConfig);
    setPlayers(nextPlayers);
    const localVitePorts = new Set(['5173', '4173', '4174', '4175']);
    const localProxyNotice = localVitePorts.has(window.location.port)
      ? [{
          id: `proxy-${Date.now()}`,
          phase: GamePhase.LOBBY,
          message: 'Local Vite preview does not run Netlify Functions. AI fallback speech is active.',
          translation: 'Local Vite preview does not run Netlify Functions. AI fallback speech is active. Deploy to Netlify with API_KEY configured to enable server-side Gemini.',
          isSystem: true,
          tone: 'warning' as const,
        }]
      : [];

    setLogs([
      {
        id: 'init',
        phase: GamePhase.LOBBY,
        message: `Game Start. You are ${nextPlayers[0].role}.`,
        translation: `Game start. Your role is ${ROLE_LABELS_EN[nextPlayers[0].role]}. ${ROLE_DESCRIPTIONS_EN[nextPlayers[0].role]}`,
        isSystem: true,
        tone: 'system',
      },
      ...localProxyNotice,
    ]);
    if (nextPlayers[0].role === Role.WEREWOLF) {
      const teammates = nextPlayers.filter(player => player.role === Role.WEREWOLF && player.id !== MY_PLAYER_ID).map(player => `Player ${player.id}`);
      setLogs(prev => [
        ...prev,
        {
          id: `wolves-${Date.now()}`,
          phase: GamePhase.LOBBY,
          message: `Wolf teammates: ${teammates.join(', ') || 'none'}.`,
          translation: `Your werewolf teammates: ${teammates.join(', ') || 'none'}. Open the werewolf channel at night.`,
          isSystem: true,
          tone: 'wolf',
        },
      ]);
    }

    setPhase(GamePhase.NIGHT_START);
    setRoundCount(0);
    setWinner(null);
    setWitchStatus({ hasSave: true, hasPoison: true });
    setNightState({ wolfKillId: null, witchPoisonId: null, witchSaved: false });
    setAiSeerLastCheck(null);
    setSpeakingQueue([]);
    setCurrentSpeaker(null);
    setDeadThisRound([]);
    setVoteRecords([]);
    setWolfChat([]);
    setSelectedPlayerId(null);
    setPendingHunterId(null);
    setSavedRecordId(null);
    setUserInput('');
    setRecordError('');
  };

  const beginNight = () => {
    setRoundCount(prev => prev + 1);
    setNightState({ wolfKillId: null, witchPoisonId: null, witchSaved: false });
    setDeadThisRound([]);
    setSelectedPlayerId(null);
    setWolfChat([]);
    addLog('Night falls. Close your eyes.', true, undefined, 'Night falls. Close your eyes.', 'system');
    setPhase(GamePhase.NIGHT_WEREWOLVES);
  };

  const expireWolfChoice = () => {
    if (!me?.isAlive || me.role !== Role.WEREWOLF || nightState.wolfKillId) return;
    const fallbackTarget = players.find(player => player.isAlive && player.role !== Role.WEREWOLF);
    if (fallbackTarget) {
      addLog(`Wolf timer expired. Auto selected Player ${fallbackTarget.id}.`, true, undefined, `Wolf timer expired. Auto selected Player ${fallbackTarget.id}.`, 'wolf');
      setNightState(prev => ({ ...prev, wolfKillId: fallbackTarget.id }));
    }
    setPhase(GamePhase.NIGHT_SEER);
  };

  const expireHumanSpeech = () => {
    addLog('Time expired. Speech skipped.', true, undefined, 'Time expired. Speech skipped.', 'system');
    setSpokenPlayerIds(prev => new Set(prev).add(MY_PLAYER_ID));
    setCurrentSpeaker(null);
  };

  const handleWerewolfPhase = () => {
    if (phaseScope.wolfChatStarted) return;
    phaseScope.wolfChatStarted = true;
    const humanWolf = me?.role === Role.WEREWOLF && me.isAlive;
    const wolves = players.filter(player => player.role === Role.WEREWOLF && player.isAlive);
    const loadChat = async () => {
      if (!wolves.length) return;
      try {
        let commitChat: (() => void) | undefined;
        const chat = await generateWolfChat(wolves, players, logs, Math.max(1, roundCount), voteRecords, gameLanguage, {
          runWhenActive,
          deferCommit: commit => { commitChat = commit; },
        });
        await runWhenActive(() => {
          commitChat?.();
          setWolfChat(chat);
          // H2-A: capture the committed night chat (already free of names).
          for (const entry of chat) {
            replayRecorderRef.current?.recordWolfChat({
              round: entry.round,
              speakerId: entry.speakerId,
              message: entry.message,
            });
          }
        });
      } catch {
        // Wolf chat is cosmetic — a failed AI call must never block the night.
      }
    };
    if (humanWolf) {
      // A human wolf can choose a target before the cosmetic chat arrives.
      void loadChat();
      return;
    }

    void runCurrentAIPhase(async () => {
      await loadChat();
      const leader = wolves[0];
      const action = await runWhenActive(() => leader ? generateAIAction(leader, players, logs, 'KILL', voteRecords) : { targetId: null });
      await runWhenActive(() => {
        const fallback = players.find(player => player.isAlive && player.role !== Role.WEREWOLF);
        const targetId = action?.targetId || fallback?.id || null;
        if (targetId) setNightState(prev => ({ ...prev, wolfKillId: targetId }));
        setPhase(GamePhase.NIGHT_SEER);
      });
    }, () => {
      addLog('AI error. Default wolf target used.', true, undefined, 'AI error. Default wolf target used.', 'system');
      const fallback = players.find(player => player.isAlive && player.role !== Role.WEREWOLF);
      if (fallback) setNightState(prev => ({ ...prev, wolfKillId: fallback.id }));
      setPhase(GamePhase.NIGHT_SEER);
    });
  };

  const handleSeerPhase = async () => {
    if (me?.role === Role.SEER && me.isAlive) return;
    await runCurrentAIPhase(async () => {
      const seer = players.find(player => player.role === Role.SEER && player.isAlive);
      const action = seer ? await generateAIAction(seer, players, logs, 'CHECK', voteRecords) : null;
      await runWhenActive(() => {
        const target = seer ? players.find(player => player.id === action?.targetId) : undefined;
        if (seer && target) {
          const isGood = target.role !== Role.WEREWOLF;
          setAiSeerLastCheck({ targetId: target.id, isGood });
          // H2-A: AI seer path of the check chain.
          replayRecorderRef.current?.recordCheck({
            round: Math.max(1, roundCount),
            actorId: seer.id,
            targetId: target.id,
            isGood,
          });
        }
        setPhase(GamePhase.NIGHT_WITCH);
      });
    }, () => {
      addLog('AI error. Seer check skipped.', true, undefined, 'AI error. Seer check skipped.', 'system');
      setPhase(GamePhase.NIGHT_WITCH);
    });
  };

  const handleWitchPhase = async () => {
    if (me?.role === Role.WITCH && me.isAlive) return;
    await runCurrentAIPhase(async () => {
      const witch = players.find(player => player.role === Role.WITCH && player.isAlive);
      let nextNight = { ...nightState };
      let nextWitch = { ...witchStatus };
      if (witch) {
        const killedPlayer = players.find(player => player.id === nightState.wolfKillId);
        if (nightState.wolfKillId && witchStatus.hasSave && killedPlayer?.role !== Role.WEREWOLF && Math.random() > 0.45) {
          nextNight = { ...nextNight, witchSaved: true };
          nextWitch = { ...nextWitch, hasSave: false };
        } else if (witchStatus.hasPoison && Math.random() > 0.72) {
          const action = await generateAIAction(witch, players, logs, 'POISON', voteRecords);
          if (action.targetId && action.targetId !== nightState.wolfKillId) {
            nextNight = { ...nextNight, witchPoisonId: action.targetId };
            nextWitch = { ...nextWitch, hasPoison: false };
          }
        }
      }
      await runWhenActive(() => {
        if (witch) {
          setNightState(nextNight);
          setWitchStatus(nextWitch);
        }
        setPhase(GamePhase.DAY_ANNOUNCE);
      });
    }, () => {
      addLog('AI error. Witch action skipped.', true, undefined, 'AI error. Witch action skipped.', 'system');
      setPhase(GamePhase.DAY_ANNOUNCE);
    });
  };

  /**
   * NetEase rule: clockwise speaking order starting from dead player's next seat.
   */
  const buildSpeakingQueue = (alivePlayers: Player[], lastDeadId: number | null): Player[] => {
    if (!lastDeadId) return alivePlayers;
    // Find the first alive player whose id is greater than lastDeadId
    const startIdx = alivePlayers.findIndex(p => p.id > lastDeadId);
    if (startIdx === -1) return alivePlayers; // wrap: all higher IDs dead
    return [...alivePlayers.slice(startIdx), ...alivePlayers.slice(0, startIdx)];
  };

  const handleDayAnnounce = () => {
    const outcome = applyNightResolution(players, nightState);
    setPlayers(outcome.players);
    setDeadThisRound(outcome.deadIds);
    const msg = outcome.deadIds.length ? `Deaths: ${outcome.deadIds.join(', ')}` : 'Peaceful night.';
    const trans = outcome.deadIds.length
      ? `Eliminated last night: ${outcome.deadIds.map(id => `Player ${id}`).join(', ')}`
      : 'No one was eliminated last night.';
    addLog(msg, true, undefined, trans, 'system');

    if (outcome.winner) {
      setWinner(outcome.winner);
      setPhase(GamePhase.GAME_OVER);
      return;
    }

    // New day — reset per-round speaking status before last-words are queued
    setSpokenPlayerIds(new Set());

    // NetEase fix: ALL rounds — dead players get last words
    const lastWords = outcome.players.filter(p => outcome.deadIds.includes(p.id));
    setSpeakingQueue(lastWords);

    // Track first death for clockwise order
    if (outcome.deadIds.length > 0) {
      setLastEliminatedId(outcome.deadIds[0]);
    }

    setPhase(GamePhase.DAY_HUNTER_CHECK);
  };

  const enterDiscussion = (nextPlayers: Player[] = players) => {
    const alive = nextPlayers.filter(p => p.isAlive);
    // NetEase rule: start from dead player's clockwise neighbor
    const ordered = buildSpeakingQueue(alive, lastEliminatedId);
    setSpeakingQueue(prev => [...prev, ...ordered]);
    setPhase(GamePhase.DAY_DISCUSSION);
  };

  const handleHunterCheck = () => {
    const hunter = players.find(player => player.role === Role.HUNTER);
    if (hunter && deadThisRound.includes(hunter.id) && nightState.witchPoisonId !== hunter.id) {
      if (hunter.isHuman) {
        setPendingHunterId(hunter.id);
        setHunterReturnPhase(GamePhase.DAY_DISCUSSION);
        addLog('Hunter may shoot.', true, undefined, 'The Hunter was eliminated and may shoot one player.', 'action');
        setPhase(GamePhase.DAY_HUNTER_SHOT);
        return;
      }
      const targets = players.filter(player => player.isAlive && player.id !== hunter.id);
      const target = targets[Math.floor(Math.random() * targets.length)];
      if (target) {
        addLog(`Hunter shoots Player ${target.id}.`, true, undefined, `Hunter shoots Player ${target.id}.`, 'action');
        const outcome = applyElimination(players, target.id, 'HUNTER');
        setPlayers(outcome.players);
        if (outcome.winner) {
          setWinner(outcome.winner);
          setPhase(GamePhase.GAME_OVER);
          return;
        }
        enterDiscussion(outcome.players);
        return;
      }
    }
    enterDiscussion();
  };

  const handleDiscussion = async () => {
    if (currentSpeaker) return;
    if (speakingQueue.length === 0) {
      addLog('Discussion ended. Voting starts.', true, undefined, 'Discussion ended. Exile voting starts.', 'system');
      setPhase(GamePhase.DAY_VOTING);
      return;
    }

    const nextSpeaker = speakingQueue[0];
    setSpeakingQueue(prev => prev.slice(1));
    setCurrentSpeaker(nextSpeaker);
    // Skip dead human players — they spoke their last words already.
    if (!nextSpeaker.isAlive && nextSpeaker.isHuman) {
      addLog(`Dead player ${nextSpeaker.id} has no further speech.`, true, undefined, `Player ${nextSpeaker.id} is out. Speech skipped.`, 'system');
      setSpokenPlayerIds(prev => new Set(prev).add(nextSpeaker.id));
      setCurrentSpeaker(null);
      return;
    }
    if (nextSpeaker.isHuman) return;

    await runCurrentAIPhase(async () => {
      const seerInfo = nextSpeaker.role === Role.SEER ? aiSeerLastCheck : null;
      let commitSpeech: (() => void) | undefined;
      const response = await generateAIDialogue(
        nextSpeaker,
        players,
        logs,
        GamePhase.DAY_DISCUSSION,
        deadThisRound,
        Math.max(1, roundCount),
        seerInfo,
        voteRecords,
        nightState,
        gameLanguage,
        { runWhenActive, deferCommit: commit => { commitSpeech = commit; } },
      );
      await runWhenActive(async () => {
        commitSpeech?.();
        const ttsLogId = addLog(response.en, false, nextSpeaker.id, response.zh, 'speech');
        // H2-A: every AI public speech, as delivered in the match language.
        replayRecorderRef.current?.recordSpeech({
          round: Math.max(1, roundCount),
          phase: GamePhase.DAY_DISCUSSION,
          speakerId: nextSpeaker.id,
          text: gameLanguage === 'zh' ? (response.zh || response.en) : (response.en || response.zh),
        });
        setSpokenPlayerIds(prev => new Set(prev).add(nextSpeaker.id));
        const ttsText = pickTranslationSource(
          { message: response.en, translation: response.zh, isSystem: false },
          gameLanguage,
        );
        if (!ttsText) return;
        try {
          await speechAudio.enqueue(
            ttsText,
            speechAudio.speechLangTag(ttsText, gameLanguage),
            nextSpeaker.id,
            ttsLogId,
            isGuest ? undefined : session?.accessToken,
          );
        } catch {
          // Audio is presentation-only; cancellation/failure never stalls play.
        }
      });
      await runWhenActive(() => setCurrentSpeaker(null));
    }, () => {
      addLog(`Player ${nextSpeaker.id} speech skipped (AI error).`, true, undefined, `AI error. Player ${nextSpeaker.id}'s speech was skipped.`, 'system');
      setSpokenPlayerIds(prev => new Set(prev).add(nextSpeaker.id));
      setCurrentSpeaker(null);
    });
  };

  const finishVote = async (humanTargetId: number | null) => {
    if (phase !== GamePhase.DAY_VOTING) return;
    await runCurrentAIPhase(async () => {
      // The synchronous AI lock lets only the first click or expiry take the vote.
      stopPlayerClock();
      setVoteTimer(null);
      const votes: Record<number, number> = {};
      const votesByVoter: Record<number, number | null> = {};
      // H2-A: AI reasons come from the same action object used for the tally.
      const voteReasons: Record<number, string | undefined> = {};
      const humanCanVote = Boolean(me?.isAlive && me.canVote);

      if (humanCanVote && humanTargetId) {
        votes[humanTargetId] = (votes[humanTargetId] || 0) + 1;
        votesByVoter[MY_PLAYER_ID] = humanTargetId;
        addLog(`You voted Player ${humanTargetId}.`, true, undefined, `You voted for Player ${humanTargetId}.`, 'vote');
      } else {
        votesByVoter[MY_PLAYER_ID] = null;
        addLog('You have no vote or abstained.', true, undefined, 'You have no vote or abstained.', 'vote');
      }

      const aiVoters = players.filter(player => player.isAlive && !player.isHuman && player.canVote);
      for (const voter of aiVoters) {
        await runWhenActive(() => waitForMatch(180));
        const action = await runWhenActive(async () => {
          try {
            return await generateAIAction(voter, players, logs, 'VOTE', voteRecords);
          } catch {
            // Failed AI vote counts as abstain — keep the tally moving.
            return null;
          }
        });
        const targetId = action?.targetId ?? null;
        if (action?.reason) voteReasons[voter.id] = action.reason;
        const counted = await runWhenActive(() => {
          votesByVoter[voter.id] = targetId ?? null;
          if (targetId) votes[targetId] = (votes[targetId] || 0) + 1;
          return true;
        });
        if (!counted) return;
      }

      await runWhenActive(() => settleVote(votes, votesByVoter, voteReasons));
    }, () => {
      addLog('AI error during voting. Night begins.', true, undefined, 'AI error during voting. Night begins.', 'system');
      setPhase(GamePhase.NIGHT_START);
    });
  };

  const settleVote = (
    votes: Record<number, number>,
    votesByVoter: Record<number, number | null>,
    voteReasons: Record<number, string | undefined> = {},
  ) => {
    const newVoteRecords = createVoteRecords(Math.max(1, roundCount), votesByVoter);
    setVoteRecords(prev => [...prev, ...newVoteRecords]);
    // H2-A: one vote entry per voter (abstentions stay as `targetId: null`)
    // plus a per-round belief snapshot after the tally is settled.
    for (const vote of newVoteRecords) {
      const reason = voteReasons[vote.voterId];
      replayRecorderRef.current?.recordVote({
        round: vote.round,
        voterId: vote.voterId,
        targetId: vote.targetId,
        ...(reason ? { reason } : {}),
      });
    }
    recordReplayBeliefSnapshots(Math.max(1, roundCount));
    addLog(
      `Vote record: ${newVoteRecords.map(v => `${v.voterId}->${v.targetId || 'skip'}`).join(', ')}`,
      true,
      undefined,
      `Votes: ${newVoteRecords.map(v => `Player ${v.voterId} -> ${v.targetId ? `Player ${v.targetId}` : 'abstain'}`).join(', ')}`,
      'vote'
    );

    const eliminatedPlayerId = resolveVoteResult(votes);
    if (!eliminatedPlayerId) {
      addLog('Tie vote. No one is exiled.', true, undefined, 'Tie vote. No one is exiled.', 'vote');
      setPhase(GamePhase.NIGHT_START);
      return;
    }

    const target = players.find(player => player.id === eliminatedPlayerId);
    const outcome = applyElimination(players, eliminatedPlayerId, 'VOTE');
    setPlayers(outcome.players);
    if (outcome.sparedByIdiot) {
      addLog(`Player ${eliminatedPlayerId} reveals Idiot and survives.`, true, undefined, `Player ${eliminatedPlayerId} reveals as the Idiot and survives, but loses their vote.`, 'action');
      setPhase(GamePhase.NIGHT_START);
      return;
    }

    addLog(`Player ${eliminatedPlayerId} was exiled.`, true, undefined, `Player ${eliminatedPlayerId} was exiled.`, 'vote');
    if (outcome.winner) {
      setWinner(outcome.winner);
      setPhase(GamePhase.GAME_OVER);
      return;
    }

    if (target?.role === Role.HUNTER) {
      if (target.isHuman) {
        setPendingHunterId(target.id);
        setHunterReturnPhase(GamePhase.NIGHT_START);
        setPhase(GamePhase.DAY_HUNTER_SHOT);
        return;
      }
      const aliveTargets = outcome.players.filter(player => player.isAlive && player.id !== target.id);
      const shot = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
      if (shot) {
        const shotOutcome = applyElimination(outcome.players, shot.id, 'HUNTER');
        addLog(`Hunter shoots Player ${shot.id}.`, true, undefined, `Hunter shoots Player ${shot.id}.`, 'action');
        setPlayers(shotOutcome.players);
        if (shotOutcome.winner) {
          setWinner(shotOutcome.winner);
          setPhase(GamePhase.GAME_OVER);
          return;
        }
      }
    }

    setPhase(GamePhase.NIGHT_START);
  };

  const handleHumanSpeechSubmit = () => {
    if (!canProgress() || currentSpeaker?.id !== MY_PLAYER_ID || !playerClockRef.current) return;
    const nextSpeech = normalizeHumanSpeech(userInput);
    if (!nextSpeech) return;
    stopPlayerClock();
    addLog(nextSpeech, false, MY_PLAYER_ID, nextSpeech, 'speech');
    // H2-A: human speech verbatim (seat only, never the player name).
    replayRecorderRef.current?.recordSpeech({
      round: Math.max(1, roundCount),
      phase: GamePhase.DAY_DISCUSSION,
      speakerId: MY_PLAYER_ID,
      text: nextSpeech,
    });
    setSpokenPlayerIds(prev => new Set(prev).add(MY_PLAYER_ID));
    setUserInput('');
    setCurrentSpeaker(null);
  };

  const handleHunterShot = (targetId: number) => {
    if (!pendingHunterId || !isTargetableAliveOther(players, pendingHunterId, targetId)) return;
    const outcome = applyElimination(players, targetId, 'HUNTER');
    addLog(`Hunter shoots Player ${targetId}.`, true, undefined, `Hunter shoots Player ${targetId}.`, 'action');
    setPlayers(outcome.players);
    setPendingHunterId(null);
    if (outcome.winner) {
      setWinner(outcome.winner);
      setPhase(GamePhase.GAME_OVER);
      return;
    }
    if (hunterReturnPhase === GamePhase.DAY_DISCUSSION) enterDiscussion(outcome.players);
    else setPhase(GamePhase.NIGHT_START);
  };

  const handlePlayerAction = (targetId: number) => {
    if (!canProgress() || processingScopeRef.current) return;
    // Hunter shot: a dead Hunter can still act (the only dead-human action path)
    if (phase === GamePhase.DAY_HUNTER_SHOT && pendingHunterId === MY_PLAYER_ID) {
      handleHunterShot(targetId);
      return;
    }
    const target = players.find(player => player.id === targetId);
    if (!me?.isAlive || !target) return;

    if (phase === GamePhase.NIGHT_WEREWOLVES && me.role === Role.WEREWOLF) {
      if (!target.isAlive || target.role === Role.WEREWOLF) return;
      setNightState(prev => ({ ...prev, wolfKillId: targetId }));
      addLog(`Wolf target locked: Player ${targetId}.`, true, undefined, `Werewolf target locked: Player ${targetId}.`, 'wolf');
      setPhase(GamePhase.NIGHT_SEER);
    } else if (phase === GamePhase.NIGHT_SEER && me.role === Role.SEER) {
      if (!isTargetableAliveOther(players, MY_PLAYER_ID, targetId)) return;
      const isGood = target.role !== Role.WEREWOLF;
      addLog(`Check Player ${targetId}: ${isGood ? 'GOOD' : 'WOLF'}.`, true, undefined, `Player ${targetId} check result: ${isGood ? 'GOOD' : 'WOLF'}.`, 'action');
      setAiSeerLastCheck({ targetId, isGood });
      // H2-A: human seer path of the check chain.
      replayRecorderRef.current?.recordCheck({
        round: Math.max(1, roundCount),
        actorId: MY_PLAYER_ID,
        targetId,
        isGood,
      });
      setPhase(GamePhase.NIGHT_WITCH);
    } else if (phase === GamePhase.NIGHT_WITCH && me.role === Role.WITCH) {
      if (!isTargetableAliveOther(players, MY_PLAYER_ID, targetId) || !witchStatus.hasPoison) return;
      setNightState(prev => ({ ...prev, witchPoisonId: targetId }));
      setWitchStatus(prev => ({ ...prev, hasPoison: false }));
      addLog(`Poison Player ${targetId}.`, true, undefined, `You chose to poison Player ${targetId}.`, 'action');
      setPhase(GamePhase.DAY_ANNOUNCE);
    } else if (phase === GamePhase.DAY_HUNTER_SHOT) {
      handleHunterShot(targetId);
    } else if (phase === GamePhase.DAY_VOTING) {
      if (!target.isAlive || target.id === MY_PLAYER_ID) return;
      finishVote(targetId);
    }
  };

  const handleWitchSave = () => {
    if (!canProgress() || phase !== GamePhase.NIGHT_WITCH || processingScopeRef.current) return;
    if (!witchStatus.hasSave || !nightState.wolfKillId) return;
    setNightState(prev => ({ ...prev, witchSaved: true }));
    setWitchStatus(prev => ({ ...prev, hasSave: false }));
    addLog('Witch used antidote.', true, undefined, `You used the antidote to save Player ${nightState.wolfKillId}.`, 'action');
    setPhase(GamePhase.DAY_ANNOUNCE);
  };

  const skipWitch = () => {
    if (!canProgress() || phase !== GamePhase.NIGHT_WITCH || processingScopeRef.current) return;
    addLog('Witch passed.', true, undefined, 'The Witch chose not to use a potion.', 'action');
    setPhase(GamePhase.DAY_ANNOUNCE);
  };

  const selectedPlayer = players.find(p => p.id === selectedPlayerId);
  const visibleText = (log: GameLog) =>
    translateEnabled && log.translation ? log.translation : log.message;

  const phaseHint = (() => {
    if (!me) return '';
    if (phase === GamePhase.NIGHT_WEREWOLVES && me.role === Role.WEREWOLF) return 'Choose a non-werewolf player as the night target.';
    if (phase === GamePhase.NIGHT_SEER && me.role === Role.SEER) return 'Choose a player to check.';
    if (phase === GamePhase.NIGHT_WITCH && me.role === Role.WITCH) return 'Choose to save, poison, or pass.';
    if (phase === GamePhase.DAY_DISCUSSION && currentSpeaker?.id === MY_PLAYER_ID) return 'It is your turn to speak publicly.';
    if (phase === GamePhase.DAY_VOTING) return me.canVote ? 'Choose a player for the exile vote.' : 'You have no vote and can only observe this round.';
    if (phase === GamePhase.DAY_HUNTER_SHOT) return 'Hunter shot: choose a living player.';
    return 'Waiting for the system and AI players.';
  })();

  const skipCurrentSpeech = (): void => {
    if (!canProgress()) return;
    // Cancels the in-flight utterance; the awaited enqueue promise settles and
    // the AI turn advances to the next speaker immediately.
    speechAudio.cancel();
  };

  return {
    // state
    config, players, phase, setPhase, logs,
    difficulty, setDifficulty,
    gameLanguage,
    selectedPlayerId, setSelectedPlayerId,
    witchStatus, nightState, roundCount, winner,
    isProcessingAI, isPaused: pause.isPaused, isMuted, setIsMuted,
    audioVolume, setAudioVolume,
    ttsEnabled, setTtsEnabled,
    ttsRate, setTtsRate,
    translateEnabled, setTranslateEnabled,
    userInput, setUserInput,
    speakingQueue, currentSpeaker, spokenPlayerIds,
    deadThisRound, voteRecords, wolfChat, wolfCountdown,
    pendingHunterId, savedRecordId,
    speechTimer, voteTimer, aiSeerLastCheck,
    // derived
    me, selectedPlayer, phaseHint,
    logsEndRef,
    // actions
    startGame, leaveGame, handlePlayerAction,
    handleWitchSave, skipWitch,
    finishVote, handleHumanSpeechSubmit,
    skipCurrentSpeech, togglePause,
  };
}
