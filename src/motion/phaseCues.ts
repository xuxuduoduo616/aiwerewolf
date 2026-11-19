import { useEffect, useRef, useState } from 'react';
import { GamePhase } from '../types';

export type TimeOfDay = 'night' | 'day';

export type PhaseCueKind = 'nightfall' | 'daybreak' | 'vote';

export interface PhaseCue {
  kind: PhaseCueKind;
  title: string;
  subtitle: string;
}

const NIGHT_PHASES = new Set<GamePhase>([
  GamePhase.NIGHT_START,
  GamePhase.NIGHT_WEREWOLVES,
  GamePhase.NIGHT_SEER,
  GamePhase.NIGHT_WITCH,
]);

export const getTimeOfDay = (phase: GamePhase): TimeOfDay =>
  NIGHT_PHASES.has(phase) ? 'night' : 'day';

/**
 * The few phase changes worth a full-width banner. Everything else is
 * announced by the console text alone to keep motion meaningful.
 * `roundCount` is the value at the moment of the change: NIGHT_START runs
 * before the round increments, so the coming night is roundCount + 1.
 */
export const getPhaseCue = (
  previous: GamePhase | null,
  next: GamePhase,
  roundCount: number,
): PhaseCue | null => {
  if (previous === null || previous === next) return null;
  // The opening night is covered by the match ceremony.
  if (previous === GamePhase.LOBBY || previous === GamePhase.LOGIN) return null;

  if (next === GamePhase.NIGHT_START) {
    return { kind: 'nightfall', title: `Night ${roundCount + 1}`, subtitle: 'Night falls. Close your eyes.' };
  }
  if (next === GamePhase.DAY_ANNOUNCE) {
    return { kind: 'daybreak', title: `Day ${Math.max(1, roundCount)}`, subtitle: 'Dawn breaks over the village.' };
  }
  if (next === GamePhase.DAY_VOTING) {
    return { kind: 'vote', title: 'The Vote', subtitle: 'Choose who leaves the village.' };
  }
  return null;
};

export const PHASE_CUE_MS = 1900;

/** Tracks the previous phase and exposes a short-lived banner cue. */
export const usePhaseCue = (phase: GamePhase, roundCount: number): PhaseCue & { id: number } | null => {
  const previousRef = useRef<GamePhase | null>(null);
  const idRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const [cue, setCue] = useState<PhaseCue & { id: number } | null>(null);

  // Later phase changes (NIGHT_START lasts ~700ms) must not cancel the hide
  // timer, so it is owned by a ref and only cleared on replace or unmount.
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = phase;
    const next = getPhaseCue(previous, phase, roundCount);
    if (!next) return;
    idRef.current += 1;
    const id = idRef.current;
    setCue({ ...next, id });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCue(current => (current?.id === id ? null : current));
    }, PHASE_CUE_MS);
    // roundCount is read at change time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return cue;
};

/** Ids that were alive in `previous` and are dead in `next`. */
export const findNewlyFallen = (
  previous: ReadonlyMap<number, boolean>,
  next: readonly { id: number; isAlive: boolean }[],
): number[] => next
  .filter(player => previous.get(player.id) === true && !player.isAlive)
  .map(player => player.id);

export const FALLEN_HIGHLIGHT_MS = 2200;

/** Briefly flags seats whose player just died so the board can mark them. */
export const useFallenPlayers = (players: readonly { id: number; isAlive: boolean }[]): ReadonlySet<number> => {
  const aliveRef = useRef<Map<number, boolean>>(new Map());
  const timersRef = useRef(new Set<number>());
  const [fallen, setFallen] = useState<ReadonlySet<number>>(() => new Set());

  // `players` changes constantly; highlight timers outlive those updates.
  useEffect(() => () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    const newlyFallen = findNewlyFallen(aliveRef.current, players);
    aliveRef.current = new Map(players.map(player => [player.id, player.isAlive]));
    if (newlyFallen.length === 0) return;
    setFallen(current => new Set([...current, ...newlyFallen]));
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      setFallen(current => {
        const remaining = new Set(current);
        for (const id of newlyFallen) remaining.delete(id);
        return remaining;
      });
    }, FALLEN_HIGHLIGHT_MS);
    timersRef.current.add(timer);
  }, [players]);

  return fallen;
};
