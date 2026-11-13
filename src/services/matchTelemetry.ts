/**
 * Per-match, local-only telemetry for cost and fallback observability.
 *
 * This module never sends data anywhere: there is no network call and it never
 * reads a credential. It stores enum counters, request counts and USD estimates
 * only — never prompts, model output, player names or speech text.
 *
 * `TTS_COST_PER_SYNTH_USD` is a fixed planning estimate, not a billed amount:
 * the voice provider returns no per-request price, so TTS cost here can only be
 * used to spot order-of-magnitude changes. Provider cost is the server's
 * `cost_estimate` value summed per request.
 *
 * Storage is best effort. When `localStorage` is unavailable or throws (for
 * example private mode or a full quota), the aggregate stays in module memory
 * for this session and the game is never interrupted.
 *
 * H1-F adds a local lifecycle ledger on top of the aggregate: `match_started`,
 * `match_finished` and `match_abandoned` events are buffered with the active
 * match and written next to the retained matches in the same key. The events
 * carry enums, counters and ISO timestamps only — no player name, speech text,
 * account id or credential. `summarizeMatches()` turns that ledger (or an injected
 * snapshot) into a completion rate and an abandonment-phase histogram.
 */

export const MATCH_TELEMETRY_STORAGE_KEY = 'werewolf.matchTelemetry.v1';
export const MATCH_TELEMETRY_VERSION = 1;
/** Keep the current match plus this many finished matches at most. */
export const MAX_RETAINED_MATCHES = 20;
/** One `match_started` plus one end event per retained match. */
export const MAX_RETAINED_EVENTS = MAX_RETAINED_MATCHES * 2;
/** Planning estimate per successful synthesis; NOT a billing value. */
export const TTS_COST_PER_SYNTH_USD = 0.001;

export type ProviderTelemetryEvent =
  | 'provider_success'
  | 'provider_failed'
  | 'provider_timeout'
  | 'provider_unparsable';

export type TtsTelemetryEvent =
  | 'tts_success'
  | 'tts_rate_limited'
  | 'tts_timeout'
  | 'tts_unavailable'
  | 'tts_invalid_media';

export type MatchTelemetryEvent = ProviderTelemetryEvent | TtsTelemetryEvent;

/**
 * Local-only per-match lifecycle events. They are distinct from the provider /
 * TTS counters above and are never sent anywhere.
 */
export interface MatchStartedEvent {
  type: 'match_started';
  /** Random local per-match id; correlation only, not an account id. */
  matchId: string;
  at: string;
  boardId: string;
  difficulty: string;
  language: string;
  isGuest: boolean;
  startedAt: string;
}

export interface MatchFinishedEvent {
  type: 'match_finished';
  matchId: string;
  at: string;
  winner: string;
  rounds: number;
  durationMs: number;
  completed: true;
}

export interface MatchAbandonedEvent {
  type: 'match_abandoned';
  matchId: string;
  at: string;
  phase: string;
  round: number;
  durationMs: number;
  completed: false;
}

export type MatchLifecycleEvent = MatchStartedEvent | MatchFinishedEvent | MatchAbandonedEvent;

/** Aggregated, read-only view of the stored lifecycle ledger. */
export interface MatchSummary {
  started: number;
  finished: number;
  abandoned: number;
  /** `finished / started`; always 0 when nothing was started (never NaN). */
  completionRate: number;
  /** Abandoned matches per phase, for example `{ DAY_VOTING: 2 }`. */
  abandonedByPhase: Record<string, number>;
  /** Mean final round count of finished matches; 0 when none finished. */
  averageRounds: number;
}

/** Injected storage snapshot accepted by `summarizeMatches` (pure input). */
export interface MatchSummarySource {
  matches?: readonly unknown[];
  events?: readonly unknown[];
}

const ALL_EVENTS: readonly MatchTelemetryEvent[] = [
  'provider_success',
  'provider_failed',
  'provider_timeout',
  'provider_unparsable',
  'tts_success',
  'tts_rate_limited',
  'tts_timeout',
  'tts_unavailable',
  'tts_invalid_media',
];

export interface StartMatchInput {
  boardId: string;
  difficulty: string;
  language: string;
  isGuest: boolean;
}

export interface MatchEndOutcome {
  completed: boolean;
  winner?: string | null;
  /** Phase left by the player when the match was abandoned. */
  phase?: string | null;
  /** Rounds played when the match was finalized; recorded as 0 if omitted. */
  rounds?: number;
}

export interface MatchTelemetryRecord {
  version: number;
  /** Random per-match id used only for local de-duplication. */
  id: string;
  startedAt: string;
  endedAt: string | null;
  boardId: string;
  difficulty: string;
  language: string;
  isGuest: boolean;
  completed: boolean;
  winner: string | null;
  phaseAtEnd: string | null;
  /** Rounds played when the record was finalized (`0` while still active). */
  rounds: number;
  /** Wall-clock duration from `startedAt` to `endedAt` (`0` while active). */
  durationMs: number;
  providerRequests: number;
  providerSuccesses: number;
  providerFailures: number;
  /** Provider outcomes that forced the local speech-library fallback. */
  providerFallbacks: number;
  providerCostUSD: number;
  ttsRequests: number;
  ttsSuccesses: number;
  ttsFailures: number;
  ttsCostUSD: number;
  costEstimateUSD: number;
  events: Record<MatchTelemetryEvent, number>;
}

export interface MatchTelemetrySnapshot {
  current: MatchTelemetryRecord | null;
  matches: MatchTelemetryRecord[];
}

/** Shape persisted under `MATCH_TELEMETRY_STORAGE_KEY`. */
export interface MatchTelemetryLedger {
  matches: MatchTelemetryRecord[];
  events: MatchLifecycleEvent[];
}

export interface ProviderOutcomeDetails {
  /** Server `cost_estimate` for this request, if the response carried one. */
  costUSD?: number;
}

let currentMatch: MatchTelemetryRecord | null = null;
/** Lifecycle events of the active match; flushed together with the record. */
let currentEvents: MatchLifecycleEvent[] = [];
let memoryMatches: MatchTelemetryRecord[] = [];
let memoryEvents: MatchLifecycleEvent[] = [];
/**
 * Once a write fails (private mode, full quota) module memory is authoritative
 * for the rest of the session, so a later read cannot resurrect stale storage
 * without the just-finished match.
 */
let storageDegraded = false;

const roundUSD = (value: number): number => Math.round(value * 1e6) / 1e6;

const normalizeCost = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, 1) : 0;

const randomMatchId = (): string => {
  try {
    const source = globalThis.crypto;
    if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  } catch {
    // Fall through to a non-cryptographic local id.
  }
  return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const emptyEvents = (): Record<MatchTelemetryEvent, number> => {
  const events = {} as Record<MatchTelemetryEvent, number>;
  for (const event of ALL_EVENTS) events[event] = 0;
  return events;
};

const createRecord = (input: StartMatchInput): MatchTelemetryRecord => ({
  version: MATCH_TELEMETRY_VERSION,
  id: randomMatchId(),
  startedAt: new Date().toISOString(),
  endedAt: null,
  boardId: String(input.boardId || 'unknown'),
  difficulty: String(input.difficulty || 'unknown'),
  language: String(input.language || 'unknown'),
  isGuest: Boolean(input.isGuest),
  completed: false,
  winner: null,
  phaseAtEnd: null,
  rounds: 0,
  durationMs: 0,
  providerRequests: 0,
  providerSuccesses: 0,
  providerFailures: 0,
  providerFallbacks: 0,
  providerCostUSD: 0,
  ttsRequests: 0,
  ttsSuccesses: 0,
  ttsFailures: 0,
  ttsCostUSD: 0,
  costEstimateUSD: 0,
  events: emptyEvents(),
});

const finalizeCosts = (record: MatchTelemetryRecord): void => {
  record.providerCostUSD = roundUSD(record.providerCostUSD);
  record.ttsCostUSD = roundUSD(record.ttsSuccesses * TTS_COST_PER_SYNTH_USD);
  record.costEstimateUSD = roundUSD(record.providerCostUSD + record.ttsCostUSD);
};

const cloneRecord = (record: MatchTelemetryRecord): MatchTelemetryRecord => ({
  ...record,
  events: { ...record.events },
});

const cloneEvent = (event: MatchLifecycleEvent): MatchLifecycleEvent => ({ ...event });

const normalizeRounds = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const durationBetween = (startedAt: string, endedAt: string): number => {
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
};

const isLifecycleEvent = (value: unknown): value is MatchLifecycleEvent => {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'match_started' || type === 'match_finished' || type === 'match_abandoned';
};

const startEventFor = (record: MatchTelemetryRecord): MatchStartedEvent => ({
  type: 'match_started',
  matchId: record.id,
  at: record.startedAt,
  boardId: record.boardId,
  difficulty: record.difficulty,
  language: record.language,
  isGuest: record.isGuest,
  startedAt: record.startedAt,
});

const endEventFor = (record: MatchTelemetryRecord): MatchLifecycleEvent =>
  record.completed
    ? {
        type: 'match_finished',
        matchId: record.id,
        at: record.endedAt ?? record.startedAt,
        winner: record.winner ?? 'UNKNOWN',
        rounds: record.rounds,
        durationMs: record.durationMs,
        completed: true,
      }
    : {
        type: 'match_abandoned',
        matchId: record.id,
        at: record.endedAt ?? record.startedAt,
        phase: record.phaseAtEnd ?? 'UNKNOWN',
        round: record.rounds,
        durationMs: record.durationMs,
        completed: false,
      };

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is MatchTelemetryRecord =>
  Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';

const readLedger = (): MatchTelemetryLedger => {
  if (storageDegraded) return { matches: memoryMatches, events: memoryEvents };
  try {
    const store = storage();
    if (!store) return { matches: memoryMatches, events: memoryEvents };
    const raw = store.getItem(MATCH_TELEMETRY_STORAGE_KEY);
    if (!raw) return { matches: memoryMatches, events: memoryEvents };
    const parsed = JSON.parse(raw) as { matches?: unknown; events?: unknown } | null;
    const matches = parsed?.matches;
    if (!Array.isArray(matches)) return { matches: memoryMatches, events: memoryEvents };
    memoryMatches = matches.filter(isRecord).slice(0, MAX_RETAINED_MATCHES).map(cloneRecord);
    memoryEvents = Array.isArray(parsed?.events)
      ? parsed.events.filter(isLifecycleEvent).slice(-MAX_RETAINED_EVENTS).map(cloneEvent)
      : [];
    return { matches: memoryMatches, events: memoryEvents };
  } catch {
    return { matches: memoryMatches, events: memoryEvents };
  }
};

const writeLedger = (matches: MatchTelemetryRecord[], events: MatchLifecycleEvent[]): void => {
  const trimmedMatches = matches.slice(0, MAX_RETAINED_MATCHES).map(cloneRecord);
  // Oldest events are dropped first: the ledger is stored in chronological order.
  const trimmedEvents = events.slice(-MAX_RETAINED_EVENTS).map(cloneEvent);
  memoryMatches = trimmedMatches;
  memoryEvents = trimmedEvents;
  try {
    const store = storage();
    if (!store) {
      storageDegraded = true;
      return;
    }
    store.setItem(MATCH_TELEMETRY_STORAGE_KEY, JSON.stringify({
      version: MATCH_TELEMETRY_VERSION,
      matches: trimmedMatches,
      events: trimmedEvents,
    }));
  } catch {
    // Storage unavailable or full: the in-memory aggregate remains authoritative.
    storageDegraded = true;
  }
};

const updateCurrent = (mutate: (record: MatchTelemetryRecord) => void): void => {
  if (!currentMatch) return;
  try {
    mutate(currentMatch);
    finalizeCosts(currentMatch);
  } catch {
    // Telemetry must never interrupt gameplay.
  }
};

/** Start a new per-match aggregate. An unfinished previous match is recorded. */
export const startMatch = (input: StartMatchInput): void => {
  try {
    if (currentMatch) endMatch({ completed: false, phase: 'SUPERSEDED' });
    const record = createRecord(input);
    currentMatch = record;
    // Buffered with the active match; written together with the final record so
    // a start event is never persisted without its matching end event.
    currentEvents = [startEventFor(record)];
  } catch {
    currentMatch = null;
    currentEvents = [];
  }
};

/** Finalize the active match. Repeated calls after finalization are no-ops. */
export const endMatch = (outcome: MatchEndOutcome): void => {
  if (!currentMatch) return;
  try {
    const record = currentMatch;
    record.endedAt = new Date().toISOString();
    record.completed = Boolean(outcome.completed);
    record.winner = outcome.completed && typeof outcome.winner === 'string' ? outcome.winner : null;
    record.phaseAtEnd = typeof outcome.phase === 'string' && outcome.phase
      ? outcome.phase
      : outcome.completed ? 'GAME_OVER' : null;
    record.rounds = normalizeRounds(outcome.rounds);
    record.durationMs = durationBetween(record.startedAt, record.endedAt);
    finalizeCosts(record);

    const ledger = readLedger();
    const pending = currentEvents.length > 0 ? currentEvents : [startEventFor(record)];
    const events = [...ledger.events, ...pending, endEventFor(record)];
    currentMatch = null;
    currentEvents = [];
    writeLedger([record, ...ledger.matches], events);
  } catch {
    currentMatch = null;
    currentEvents = [];
  }
};

/** Read the active aggregate (if any) and the retained finished matches. */
export const snapshot = (): MatchTelemetrySnapshot => {
  try {
    return {
      current: currentMatch ? cloneRecord(currentMatch) : null,
      matches: readLedger().matches.map(cloneRecord),
    };
  } catch {
    return { current: null, matches: [] };
  }
};

/** Clear the active aggregate, every retained match and every lifecycle event. */
export const reset = (): void => {
  currentMatch = null;
  currentEvents = [];
  memoryMatches = [];
  memoryEvents = [];
  storageDegraded = false;
  try {
    storage()?.removeItem(MATCH_TELEMETRY_STORAGE_KEY);
  } catch {
    // Nothing else to clean up.
  }
};

/** Record one provider request outcome. Provider cost only comes from success. */
export const recordProviderOutcome = (
  event: ProviderTelemetryEvent,
  details: ProviderOutcomeDetails = {},
): void => {
  updateCurrent(record => {
    record.providerRequests += 1;
    record.events[event] += 1;
    if (event === 'provider_success') {
      record.providerSuccesses += 1;
      record.providerCostUSD += normalizeCost(details.costUSD);
    } else {
      record.providerFailures += 1;
      record.providerFallbacks += 1;
    }
  });
};

/** Record one TTS synthesis request outcome. */
export const recordTtsOutcome = (event: TtsTelemetryEvent): void => {
  updateCurrent(record => {
    record.ttsRequests += 1;
    record.events[event] += 1;
    if (event === 'tts_success') record.ttsSuccesses += 1;
    else record.ttsFailures += 1;
  });
};

const emptySummary = (): MatchSummary => ({
  started: 0,
  finished: 0,
  abandoned: 0,
  completionRate: 0,
  abandonedByPhase: {},
  averageRounds: 0,
});

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const summarizeLedger = (ledger: MatchTelemetryLedger): MatchSummary => {
  const summary = emptySummary();
  let abandoned = 0;
  let roundsTotal = 0;
  let roundsCount = 0;

  if (ledger.events.length > 0) {
    for (const event of ledger.events) {
      if (event.type === 'match_started') {
        summary.started += 1;
        continue;
      }
      if (event.type === 'match_finished') {
        summary.finished += 1;
        const rounds = normalizeRounds(event.rounds);
        if (rounds > 0) {
          roundsTotal += rounds;
          roundsCount += 1;
        }
        continue;
      }
      abandoned += 1;
      const phase = typeof event.phase === 'string' && event.phase ? event.phase : 'UNKNOWN';
      summary.abandonedByPhase[phase] = (summary.abandonedByPhase[phase] ?? 0) + 1;
    }
  } else {
    // Compatibility with ledgers written before H1-F added lifecycle events.
    for (const match of ledger.matches) {
      summary.started += 1;
      if (match.completed) {
        summary.finished += 1;
        const rounds = normalizeRounds(match.rounds);
        if (rounds > 0) {
          roundsTotal += rounds;
          roundsCount += 1;
        }
      } else {
        abandoned += 1;
        const phase = match.phaseAtEnd ?? 'UNKNOWN';
        summary.abandonedByPhase[phase] = (summary.abandonedByPhase[phase] ?? 0) + 1;
      }
    }
  }

  summary.abandoned = abandoned;
  summary.completionRate = summary.started === 0 ? 0 : roundTo(summary.finished / summary.started, 4);
  summary.averageRounds = roundsCount === 0 ? 0 : roundTo(roundsTotal / roundsCount, 2);
  return summary;
};

/**
 * Pure summary of a stored (or injected) match ledger.
 *
 * Pass a snapshot from `localStorage` / `snapshot()` to avoid reading storage;
 * omit the argument to summarize the ledger currently persisted. Invalid or
 * corrupt entries are ignored and the function never throws. `completionRate`
 * is `finished / started` and is `0` (never `NaN`) when `started === 0`.
 */
export const summarizeMatches = (source?: MatchSummarySource | null): MatchSummary => {
  try {
    if (source === undefined) return summarizeLedger(readLedger());
    const input = source && typeof source === 'object' ? source : {};
    const matches = Array.isArray(input.matches) ? input.matches.filter(isRecord) : [];
    const events = Array.isArray(input.events) ? input.events.filter(isLifecycleEvent) : [];
    return summarizeLedger({ matches, events });
  } catch {
    return emptySummary();
  }
};
