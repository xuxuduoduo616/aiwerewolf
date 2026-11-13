import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MATCH_TELEMETRY_STORAGE_KEY,
  MAX_RETAINED_EVENTS,
  MAX_RETAINED_MATCHES,
  TTS_COST_PER_SYNTH_USD,
  endMatch,
  recordProviderOutcome,
  recordTtsOutcome,
  reset,
  snapshot,
  startMatch,
  summarizeMatches,
} from './matchTelemetry';

const store = new Map<string, string>();
const workingStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
};
const throwingStorage = {
  getItem: () => { throw new Error('storage denied'); },
  setItem: () => { throw new Error('storage denied'); },
  removeItem: () => { throw new Error('storage denied'); },
};
const start = () => startMatch({ boardId: '9-standard', difficulty: 'normal', language: 'en', isGuest: true });

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', workingStorage);
  reset();
});

afterEach(() => {
  reset();
  vi.unstubAllGlobals();
});

describe('match telemetry aggregate', () => {
  it('tracks one match and starts with zeroed estimates', () => {
    start();
    const { current, matches } = snapshot();
    expect(matches).toEqual([]);
    expect(current).toMatchObject({
      boardId: '9-standard',
      difficulty: 'normal',
      language: 'en',
      isGuest: true,
      completed: false,
      endedAt: null,
      providerRequests: 0,
      providerCostUSD: 0,
      ttsCostUSD: 0,
      costEstimateUSD: 0,
    });
    expect(typeof current?.id).toBe('string');
  });

  it('sums provider cost estimates and counts TTS syntheses with the fixed estimate', () => {
    start();
    recordProviderOutcome('provider_success', { costUSD: 0.0042 });
    recordProviderOutcome('provider_success', { costUSD: 0.0038 });
    recordProviderOutcome('provider_timeout');
    recordProviderOutcome('provider_unparsable');
    recordTtsOutcome('tts_success');
    recordTtsOutcome('tts_success');
    recordTtsOutcome('tts_rate_limited');
    const current = snapshot().current!;
    expect(current.providerRequests).toBe(4);
    expect(current.providerSuccesses).toBe(2);
    expect(current.providerFailures).toBe(2);
    expect(current.providerFallbacks).toBe(2);
    expect(current.providerCostUSD).toBeCloseTo(0.008, 6);
    expect(current.ttsRequests).toBe(3);
    expect(current.ttsSuccesses).toBe(2);
    expect(current.ttsFailures).toBe(1);
    expect(current.ttsCostUSD).toBeCloseTo(2 * TTS_COST_PER_SYNTH_USD, 6);
    expect(current.costEstimateUSD).toBeCloseTo(0.008 + 2 * TTS_COST_PER_SYNTH_USD, 6);
    expect(current.events).toMatchObject({
      provider_success: 2,
      provider_timeout: 1,
      provider_unparsable: 1,
      tts_success: 2,
      tts_rate_limited: 1,
      provider_failed: 0,
      tts_unavailable: 0,
    });
  });

  it('only counts provider cost from successful outcomes and rejects non-finite values', () => {
    start();
    recordProviderOutcome('provider_success', { costUSD: Number.NaN });
    recordProviderOutcome('provider_success', { costUSD: -1 });
    recordProviderOutcome('provider_failed', { costUSD: 0.5 });
    const current = snapshot().current!;
    expect(current.providerCostUSD).toBe(0);
    expect(current.costEstimateUSD).toBe(0);
  });

  it('persists completed matches newest-first and caps retention', () => {
    start();
    recordProviderOutcome('provider_success', { costUSD: 0.002 });
    endMatch({ completed: true, winner: 'VILLAGERS' });
    let stored = JSON.parse(store.get(MATCH_TELEMETRY_STORAGE_KEY)!);
    expect(stored.version).toBe(1);
    expect(stored.matches).toHaveLength(1);
    expect(stored.matches[0]).toMatchObject({ completed: true, winner: 'VILLAGERS', phaseAtEnd: 'GAME_OVER' });
    expect(stored.matches[0].providerCostUSD).toBeCloseTo(0.002, 6);

    for (let index = 0; index < MAX_RETAINED_MATCHES + 5; index += 1) {
      start();
      endMatch({ completed: true, winner: 'WEREWOLVES' });
    }
    const { current, matches } = snapshot();
    stored = JSON.parse(store.get(MATCH_TELEMETRY_STORAGE_KEY)!);
    expect(current).toBeNull();
    expect(matches).toHaveLength(MAX_RETAINED_MATCHES);
    expect(stored.matches).toHaveLength(MAX_RETAINED_MATCHES);
    expect(new Set(matches.map(match => match.id)).size).toBe(MAX_RETAINED_MATCHES);
  });

  it('records an abandoned match with its phase and ignores repeated finalization', () => {
    start();
    recordTtsOutcome('tts_unavailable');
    endMatch({ completed: false, phase: 'DAY_VOTING' });
    endMatch({ completed: true, winner: 'VILLAGERS' });
    const { current, matches } = snapshot();
    expect(current).toBeNull();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ completed: false, winner: null, phaseAtEnd: 'DAY_VOTING', ttsFailures: 1 });
  });

  it('supersedes an unfinished match instead of losing it', () => {
    start();
    const first = snapshot().current!.id;
    start();
    const { current, matches } = snapshot();
    expect(current?.id).not.toBe(first);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: first, completed: false, phaseAtEnd: 'SUPERSEDED' });
  });

  it('keeps the aggregate in memory when localStorage is unavailable or throws', () => {
    vi.stubGlobal('localStorage', throwingStorage);
    expect(() => start()).not.toThrow();
    recordProviderOutcome('provider_success', { costUSD: 0.004 });
    recordTtsOutcome('tts_success');
    expect(() => endMatch({ completed: true, winner: 'WEREWOLVES' })).not.toThrow();
    const { current, matches } = snapshot();
    expect(current).toBeNull();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ completed: true, winner: 'WEREWOLVES', providerCostUSD: 0.004 });
    expect(matches[0].costEstimateUSD).toBeCloseTo(0.004 + TTS_COST_PER_SYNTH_USD, 6);
  });

  it('ignores outcomes without an active match and resets stored state', () => {
    expect(() => recordProviderOutcome('provider_timeout')).not.toThrow();
    expect(snapshot().current).toBeNull();
    start();
    endMatch({ completed: true, winner: 'VILLAGERS' });
    expect(snapshot().matches).toHaveLength(1);
    reset();
    expect(snapshot()).toEqual({ current: null, matches: [] });
    expect(store.has(MATCH_TELEMETRY_STORAGE_KEY)).toBe(false);
  });
});

const readStored = () => JSON.parse(store.get(MATCH_TELEMETRY_STORAGE_KEY)!);

describe('match lifecycle ledger (completion and abandonment)', () => {
  it('writes match_started and match_finished with the required fields', () => {
    start();
    const matchId = snapshot().current!.id;
    endMatch({ completed: true, winner: 'VILLAGERS', rounds: 3 });

    const stored = readStored();
    expect(stored.events).toHaveLength(2);
    expect(stored.events[0]).toMatchObject({
      type: 'match_started',
      matchId,
      boardId: '9-standard',
      difficulty: 'normal',
      language: 'en',
      isGuest: true,
    });
    expect(typeof stored.events[0].startedAt).toBe('string');
    expect(stored.events[0].startedAt).toBe(stored.events[0].at);
    expect(Object.keys(stored.events[0]).sort()).toEqual([
      'at', 'boardId', 'difficulty', 'isGuest', 'language', 'matchId', 'startedAt', 'type',
    ]);
    expect(stored.events[1]).toMatchObject({
      type: 'match_finished',
      matchId,
      winner: 'VILLAGERS',
      rounds: 3,
      completed: true,
    });
    expect(Object.keys(stored.events[1]).sort()).toEqual([
      'at', 'completed', 'durationMs', 'matchId', 'rounds', 'type', 'winner',
    ]);
    expect(typeof stored.events[1].durationMs).toBe('number');
    expect(stored.events[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(stored.matches[0]).toMatchObject({ rounds: 3, completed: true, winner: 'VILLAGERS' });
    expect(stored.matches[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('writes match_abandoned with the phase and round left by the player', () => {
    start();
    endMatch({ completed: false, phase: 'DAY_VOTING', rounds: 2 });

    const events = readStored().events;
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: 'match_abandoned',
      phase: 'DAY_VOTING',
      round: 2,
      completed: false,
    });
    expect(events[1]).not.toHaveProperty('winner');
    expect(Object.keys(events[1]).sort()).toEqual([
      'at', 'completed', 'durationMs', 'matchId', 'phase', 'round', 'type',
    ]);
    expect(snapshot().matches[0]).toMatchObject({
      completed: false,
      phaseAtEnd: 'DAY_VOTING',
      rounds: 2,
    });
  });

  it('pairs a started event with exactly one end event per finalized match', () => {
    start();
    start();
    const stored = readStored();
    expect(stored.events.map((event: { type: string }) => event.type)).toEqual([
      'match_started',
      'match_abandoned',
    ]);
    expect(stored.events[1].phase).toBe('SUPERSEDED');
    expect(stored.matches).toHaveLength(1);
  });

  it('retains lifecycle events for the newest matches only', () => {
    for (let index = 0; index < MAX_RETAINED_MATCHES + 3; index += 1) {
      start();
      endMatch({
        completed: index % 2 === 0,
        winner: 'VILLAGERS',
        phase: 'DAY_VOTING',
        rounds: index + 1,
      });
    }

    const stored = readStored();
    const matchIds = new Set(stored.matches.map((match: { id: string }) => match.id));
    expect(stored.matches).toHaveLength(MAX_RETAINED_MATCHES);
    expect(stored.events).toHaveLength(MAX_RETAINED_EVENTS);
    expect(stored.events.every((event: { matchId: string }) => matchIds.has(event.matchId))).toBe(true);

    const counts = stored.events.reduce(
      (total: Record<string, number>, event: { type: string }) => ({
        ...total,
        [event.type]: (total[event.type] ?? 0) + 1,
      }),
      {},
    );
    expect(counts).toEqual({ match_started: 20, match_finished: 10, match_abandoned: 10 });
    expect(summarizeMatches()).toMatchObject({
      started: 20,
      finished: 10,
      abandoned: 10,
      completionRate: 0.5,
      averageRounds: 14,
    });
  });

  it('summarizes an injected ledger without reading storage', () => {
    vi.stubGlobal('localStorage', throwingStorage);
    const source = {
      matches: [],
      events: [
        { type: 'match_started', matchId: 'a' },
        { type: 'match_started', matchId: 'b' },
        { type: 'match_started', matchId: 'c' },
        { type: 'match_started', matchId: 'd' },
        { type: 'match_finished', matchId: 'a', winner: 'VILLAGERS', rounds: 3, durationMs: 1000, completed: true },
        { type: 'match_abandoned', matchId: 'b', phase: 'DAY_VOTING', round: 2, durationMs: 500, completed: false },
        { type: 'match_finished', matchId: 'c', winner: 'WEREWOLVES', rounds: 5, durationMs: 2000, completed: true },
        { type: 'match_abandoned', matchId: 'd', phase: 'NIGHT_WEREWOLVES', round: 1, durationMs: 300, completed: false },
      ],
    };

    expect(summarizeMatches(source)).toEqual({
      started: 4,
      finished: 2,
      abandoned: 2,
      completionRate: 0.5,
      abandonedByPhase: { DAY_VOTING: 1, NIGHT_WEREWOLVES: 1 },
      averageRounds: 4,
    });
  });

  it('never divides by zero and tolerates empty or malformed input', () => {
    const empty = {
      started: 0,
      finished: 0,
      abandoned: 0,
      completionRate: 0,
      abandonedByPhase: {},
      averageRounds: 0,
    };
    expect(summarizeMatches()).toEqual(empty);
    expect(summarizeMatches(null)).toEqual(empty);
    expect(summarizeMatches({ matches: [null, 42, {}], events: [null, { type: 'bogus' }] })).toEqual(empty);
    expect(Number.isNaN(summarizeMatches({ matches: [], events: [] }).completionRate)).toBe(false);
  });

  it('derives the summary from records written before lifecycle events existed', () => {
    const source = {
      matches: [
        { id: 'old-completed', completed: true, rounds: 4, phaseAtEnd: 'GAME_OVER' },
        { id: 'old-abandoned', completed: false, rounds: 2, phaseAtEnd: 'DAY_DISCUSSION' },
      ],
    };
    expect(summarizeMatches(source)).toEqual({
      started: 2,
      finished: 1,
      abandoned: 1,
      completionRate: 0.5,
      abandonedByPhase: { DAY_DISCUSSION: 1 },
      averageRounds: 4,
    });
  });

  it('recovers from corrupt stored JSON and rewrites a valid ledger', () => {
    store.set(MATCH_TELEMETRY_STORAGE_KEY, '{not valid json');
    expect(() => snapshot()).not.toThrow();
    expect(snapshot().matches).toEqual([]);
    expect(summarizeMatches()).toMatchObject({ started: 0, completionRate: 0 });

    start();
    endMatch({ completed: true, winner: 'VILLAGERS', rounds: 1 });
    const stored = readStored();
    expect(stored.matches).toHaveLength(1);
    expect(stored.events).toHaveLength(2);
    expect(summarizeMatches()).toMatchObject({ started: 1, finished: 1, abandoned: 0, completionRate: 1 });
  });

  it('keeps memory authoritative when storage rejects the write (quota exceeded)', () => {
    const previousLedger = JSON.stringify({
      version: 1,
      matches: [{ id: 'previous-match', completed: true }],
      events: [
        { type: 'match_started', matchId: 'previous-match' },
        { type: 'match_finished', matchId: 'previous-match', rounds: 1, completed: true },
      ],
    });
    store.set(MATCH_TELEMETRY_STORAGE_KEY, previousLedger);
    const quotaError = Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: () => { throw quotaError; },
      removeItem: (key: string) => { store.delete(key); },
    });

    expect(() => {
      start();
      endMatch({ completed: true, winner: 'WEREWOLVES', rounds: 2 });
    }).not.toThrow();
    expect(store.get(MATCH_TELEMETRY_STORAGE_KEY)).toBe(previousLedger);
    expect(snapshot().matches).toHaveLength(2);
    expect(summarizeMatches()).toMatchObject({
      started: 2,
      finished: 2,
      abandoned: 0,
      completionRate: 1,
      averageRounds: 1.5,
    });
  });

  it('summarizes from memory when localStorage throws', () => {
    vi.stubGlobal('localStorage', throwingStorage);
    start();
    endMatch({ completed: false, phase: 'DAY_DISCUSSION', rounds: 1 });
    expect(summarizeMatches()).toEqual({
      started: 1,
      finished: 0,
      abandoned: 1,
      completionRate: 0,
      abandonedByPhase: { DAY_DISCUSSION: 1 },
      averageRounds: 0,
    });
  });
});
