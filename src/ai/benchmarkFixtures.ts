// --- START OF FILE src/ai/benchmarkFixtures.ts ---
//
// H2-C: local anonymous replay fixtures → benchmark records.
//
// This module is the single bridge between the replay schema (`src/replay/**`,
// H2-A) and the deterministic offline evaluation runner (`evaluation.ts`).
// It reads fixtures from disk, so it is Node/Vitest-only: it must never be
// imported by an entry point reachable from `src/App.tsx`, or the sample data
// would be pulled into the production bundle. `benchmark.test.ts` and
// `scripts/replay-to-benchmark.mjs` are the only intended consumers.
//
// Determinism: no clock, no randomness, no network. Speech turns are fed to the
// runner as the scripted "model output"; votes are fed as the scripted action
// proposals. Same fixture bytes → same benchmark bytes.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalizeReplay } from '../replay/replayRecorder';
import type {
  ReplayBeliefSnapshot,
  ReplayPlayerSeat,
  ReplayRecord,
  ReplayVote,
} from '../replay/replayTypes';
import type { BehaviorVariant } from '../services/roleProfiles';
import { Role, type Player } from '../types';
import {
  BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD,
  isValidBenchmarkResult,
  type GameBenchmarkResult,
} from './benchmark';
import {
  createMockProvider,
  estimateTokens,
  runReplay,
  type EvalProviderCall,
  type ReplayInput,
  type RoleEvaluationReport,
  type ScriptedTurn,
} from './evaluation';

/** Fixed placeholder that replaces every human utterance in a fixture. */
export const HUMAN_SPEECH_PLACEHOLDER = '[human speech omitted]';

/** Dataset version shared by the local anonymous replay sample set. */
export const BENCHMARK_DATA_VERSION = 'local-replay-v1';

/** Method label: recorded AI speech/votes replayed through `evaluation.ts`. */
export const BENCHMARK_METHOD = 'replay-evaluation-runner-v1';

/**
 * Behavior variant used for the runner prompts. The replay does not record a
 * variant (it is an expression-layer setting, not a rule-layer fact), so the
 * benchmark pins one value to keep results comparable. It only changes prompt
 * text; the mock provider echoes the recorded speech either way.
 */
export const BENCHMARK_BEHAVIOR_VARIANT: BehaviorVariant = 'balanced';

/** File-name suffix of a replay fixture. */
export const FIXTURE_FILE_SUFFIX = '.replay.json';

/** Default fixture directory (absolute, resolved from this module). */
export const BENCHMARK_FIXTURES_DIR = fileURLToPath(
  new URL('./__fixtures__/replays/', import.meta.url),
);

const REPLAY_TOP_LEVEL_KEYS = [
  'schemaVersion',
  'gameId',
  'createdAt',
  'boardId',
  'difficulty',
  'language',
  'isGuest',
  'players',
  'phases',
  'speeches',
  'votes',
  'beliefSnapshots',
  'wolfChat',
  'checks',
  'outcome',
] as const;

const PLAYER_SEAT_KEYS = ['seat', 'role', 'isHuman'] as const;
const BOARD_IDS = ['9-standard', '12-standard'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const LANGUAGES = ['zh', 'en'] as const;
const WINNERS = ['VILLAGERS', 'WEREWOLVES'] as const;

/**
 * Identity-ish keys that must never appear in a committed replay fixture.
 * Compared after lower-casing and dropping `_`/`-`, so `userId`, `user_id` and
 * `UserID` are all caught. `gameId`/`actorId`/`targetId`/`voterId`/`speakerId`
 * are deliberately allowed: they are seat/game indices, not account ids.
 */
const FORBIDDEN_KEYS = new Set([
  'name',
  'playername',
  'displayname',
  'nickname',
  'email',
  'mail',
  'token',
  'accesstoken',
  'refreshtoken',
  'session',
  'password',
  'userid',
  'avatarurl',
]);

const EMAIL_LIKE_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const fixtureError = (message: string): never => {
  throw new Error(`Invalid replay fixture: ${message}`);
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fixtureError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const expectArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) return fixtureError(`${label} must be an array`);
  return value;
};

const assertNoIdentityKeys = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoIdentityKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
      fixtureError(`forbidden identity key "${key}" at ${path}`);
    }
    assertNoIdentityKeys(entry, `${path}.${key}`);
  }
};

/**
 * Structural type guard for a committed fixture. It accepts only the exact
 * schemaVersion-1 top-level key set and the exact player-seat key set, so a
 * raw browser export with extra identity fields is rejected rather than
 * silently canonicalized.
 */
export const isReplayRecord = (value: unknown): value is ReplayRecord => {
  try {
    const record = asRecord(value, 'replay');
    if (record.schemaVersion !== 1) return false;
    const keys = Object.keys(record);
    if (keys.length !== REPLAY_TOP_LEVEL_KEYS.length) return false;
    if (!REPLAY_TOP_LEVEL_KEYS.every(key => keys.includes(key))) return false;
    if (typeof record.gameId !== 'string' || record.gameId.length === 0) return false;
    if (typeof record.createdAt !== 'string' || record.createdAt.length === 0) return false;
    if (!BOARD_IDS.includes(record.boardId as (typeof BOARD_IDS)[number])) return false;
    if (!DIFFICULTIES.includes(record.difficulty as (typeof DIFFICULTIES)[number])) return false;
    if (!LANGUAGES.includes(record.language as (typeof LANGUAGES)[number])) return false;
    if (typeof record.isGuest !== 'boolean') return false;
    const players = expectArray(record.players, 'players');
    for (const entry of players) {
      const seat = asRecord(entry, 'players[]');
      const seatKeys = Object.keys(seat);
      if (seatKeys.length !== PLAYER_SEAT_KEYS.length) return false;
      if (!PLAYER_SEAT_KEYS.every(key => seatKeys.includes(key))) return false;
      if (typeof seat.seat !== 'number' || !Number.isInteger(seat.seat) || seat.seat < 1) return false;
      if (!Object.values(Role).includes(seat.role as Role)) return false;
      if (typeof seat.isHuman !== 'boolean') return false;
    }
    for (const field of ['phases', 'speeches', 'votes', 'beliefSnapshots', 'wolfChat', 'checks'] as const) {
      expectArray(record[field], field);
    }
    const outcome = asRecord(record.outcome, 'outcome');
    if (!WINNERS.includes(outcome.winner as (typeof WINNERS)[number])) return false;
    if (typeof outcome.rounds !== 'number' || !Number.isFinite(outcome.rounds)) return false;
    return true;
  } catch {
    return false;
  }
};

/**
 * Privacy guard: every human utterance must already be the fixed placeholder
 * and no e-mail-like string may remain anywhere in the record.
 */
export const assertSanitizedReplay = (record: ReplayRecord): void => {
  const humanSeats = new Set(record.players.filter(player => player.isHuman).map(player => player.seat));
  for (const speech of record.speeches) {
    if (humanSeats.has(speech.speakerId) && speech.text !== HUMAN_SPEECH_PLACEHOLDER) {
      fixtureError(
        `human speech at round ${speech.round} still contains raw text; `
        + `replace it with "${HUMAN_SPEECH_PLACEHOLDER}"`,
      );
    }
  }
  const serialized = JSON.stringify(record);
  if (EMAIL_LIKE_PATTERN.test(serialized)) {
    fixtureError('record still contains an e-mail-like string');
  }
};

/** Validate one parsed fixture value, enforce privacy, and canonicalize it. */
export const parseReplayFixture = (value: unknown, label: string): ReplayRecord => {
  if (!isReplayRecord(value)) fixtureError(`${label} does not match the schemaVersion 1 replay shape`);
  const raw = value as unknown as ReplayRecord;
  assertNoIdentityKeys(raw, label);
  const replay = canonicalizeReplay(raw);
  assertSanitizedReplay(replay);
  return replay;
};

const fixtureIdFromFileName = (fileName: string): string =>
  fileName.endsWith(FIXTURE_FILE_SUFFIX)
    ? fileName.slice(0, -FIXTURE_FILE_SUFFIX.length)
    : fileName;

const roundScore = (value: number): number => Math.round(value * 1e6) / 1e6;
const roundCost = (value: number): number => Math.round(value * 1e8) / 1e8;

const toBenchmarkPlayer = (seat: ReplayPlayerSeat): Player => ({
  id: seat.seat,
  // Synthetic, stable label. Fixture files never carry a display name; the
  // replay runner only needs an id for turn lookup.
  name: `P${seat.seat}`,
  role: seat.role,
  camp: seat.role === Role.WEREWOLF ? 'WEREWOLF' : 'VILLAGE',
  // The replay schema does not snapshot liveness per turn, so the runner sees
  // every seat as alive. This keeps recorded votes legal at their own round;
  // `illegalActionRate` therefore only measures proposals the schema can
  // actually judge (self/unknown targets).
  isAlive: true,
  canVote: true,
  isRevealed: false,
  avatarUrl: '',
  aiPersonality: '',
  traits: [],
  aiModelLabel: '',
  isHuman: seat.isHuman,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
});

/**
 * Turn order per round: recorded public speeches first, then that round's
 * votes — the real chronological order. Human turns are skipped entirely
 * (their speech is a placeholder and their behaviour is not AI quality).
 */
export const buildScriptedTurns = (record: ReplayRecord): ScriptedTurn[] => {
  const humanSeats = new Set(record.players.filter(player => player.isHuman).map(player => player.seat));
  const aiSpeeches = record.speeches.filter(speech => !humanSeats.has(speech.speakerId));
  const aiVotes = record.votes.filter(
    (vote): vote is ReplayVote & { targetId: number } =>
      !humanSeats.has(vote.voterId) && vote.targetId !== null,
  );
  const maxRound = Math.max(
    1,
    ...aiSpeeches.map(speech => speech.round),
    ...aiVotes.map(vote => vote.round),
  );

  const turns: ScriptedTurn[] = [];
  for (let round = 1; round <= maxRound; round += 1) {
    for (const speech of aiSpeeches) {
      if (speech.round !== round) continue;
      turns.push({
        kind: 'speech',
        round,
        actorId: speech.speakerId,
        speech: speech.text,
      });
    }
    for (const vote of aiVotes) {
      if (vote.round !== round) continue;
      turns.push({
        kind: 'action',
        round,
        actorId: vote.voterId,
        actionType: 'VOTE',
        proposedTargetId: vote.targetId,
      });
    }
  }
  return turns;
};

export interface VoteAgreementDiagnostics {
  /** AI votes with a concrete target (abstentions are not proposals). */
  aiVotesWithTarget: number;
  /** Votes whose target was in the voter's same-round top-2 suspicion. */
  voteRationalityNumerator: number;
  /** Votes with a same-round belief snapshot for the voter. */
  voteRationalityDenominator: number;
  /** AI votes that did not target a werewolf teammate. */
  roleConsistencyNumerator: number;
  roleConsistencyDenominator: number;
}

export interface BenchmarkFixtureMetrics {
  aiSpeechTurns: number;
  aiVoteTurns: number;
  humanSpeechesOmitted: number;
  humanVotesSkipped: number;
  illegalVoteProposals: number;
  leakedSpeechTurns: number;
  repeatedSpeechTurns: number;
  providerCalls: number;
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  costPer1kTokensUSD: number;
}

export interface BenchmarkComputation {
  report: RoleEvaluationReport;
  result: GameBenchmarkResult;
  metrics: BenchmarkFixtureMetrics;
  voteAgreement: VoteAgreementDiagnostics;
}

const findSnapshot = (
  snapshots: readonly ReplayBeliefSnapshot[],
  round: number,
  actorId: number,
): ReplayBeliefSnapshot | undefined =>
  snapshots.find(snapshot => snapshot.round === round && snapshot.actorId === actorId);

const computeVoteAgreement = (record: ReplayRecord): VoteAgreementDiagnostics => {
  const seatById = new Map(record.players.map(player => [player.seat, player]));
  const diagnostics: VoteAgreementDiagnostics = {
    aiVotesWithTarget: 0,
    voteRationalityNumerator: 0,
    voteRationalityDenominator: 0,
    roleConsistencyNumerator: 0,
    roleConsistencyDenominator: 0,
  };

  for (const vote of record.votes) {
    const voter = seatById.get(vote.voterId);
    if (!voter || voter.isHuman || vote.targetId === null) continue;
    diagnostics.aiVotesWithTarget += 1;
    diagnostics.roleConsistencyDenominator += 1;
    const target = seatById.get(vote.targetId);
    const votedTeammate = voter.role === Role.WEREWOLF && target?.role === Role.WEREWOLF;
    if (!votedTeammate) diagnostics.roleConsistencyNumerator += 1;

    const snapshot = findSnapshot(record.beliefSnapshots, vote.round, vote.voterId);
    if (!snapshot || snapshot.scores.length === 0) continue;
    diagnostics.voteRationalityDenominator += 1;
    const topTwo = [...snapshot.scores]
      .sort((a, b) => (b.score - a.score) || (a.targetId - b.targetId))
      .slice(0, 2)
      .map(entry => entry.targetId);
    if (topTwo.includes(vote.targetId)) diagnostics.voteRationalityNumerator += 1;
  }
  return diagnostics;
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : numerator / denominator;

const tokenCounts = (calls: ReadonlyArray<EvalProviderCall>): { promptTokens: number; responseTokens: number } => {
  let promptTokens = 0;
  let responseTokens = 0;
  for (const call of calls) {
    promptTokens += estimateTokens(call.prompt);
    responseTokens += estimateTokens(call.response);
  }
  return { promptTokens, responseTokens };
};

const buildNotes = (record: ReplayRecord): string =>
  `Local anonymous ${record.isGuest ? 'guest' : 'signed-in'} match on ${record.boardId}; `
  + `difficulty ${record.difficulty}; `
  + `language ${record.language}; winner ${record.outcome.winner} in `
  + `${record.outcome.rounds} round${record.outcome.rounds === 1 ? '' : 's'}; `
  + `human speech omitted. Not production user data.`;

/**
 * Convert one fixture to a `GameBenchmarkResult` using the shared offline
 * runner. Pure and deterministic for a given record + fixture id.
 */
export const buildBenchmarkFromReplay = (record: ReplayRecord, fixtureId: string): BenchmarkComputation => {
  if (fixtureId.length === 0) fixtureError('fixture id is empty');
  const provider = createMockProvider();
  const input: ReplayInput = {
    gameId: fixtureId,
    players: record.players.map(toBenchmarkPlayer),
    turns: buildScriptedTurns(record),
    variant: BENCHMARK_BEHAVIOR_VARIANT,
    provider,
    costPer1kTokens: BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD,
  };
  const report = runReplay(input);
  const voteAgreement = computeVoteAgreement(record);
  const { promptTokens, responseTokens } = tokenCounts(provider.calls);
  const humanSeats = new Set(record.players.filter(player => player.isHuman).map(player => player.seat));

  const result: GameBenchmarkResult = {
    gameId: fixtureId,
    dataVersion: BENCHMARK_DATA_VERSION,
    method: BENCHMARK_METHOD,
    roleConsistencyScore: roundScore(ratio(
      voteAgreement.roleConsistencyNumerator,
      voteAgreement.roleConsistencyDenominator,
    )),
    illegalActionRate: roundScore(report.illegalActionRate),
    voteRationalityScore: roundScore(ratio(
      voteAgreement.voteRationalityNumerator,
      voteAgreement.voteRationalityDenominator,
    )),
    speechRepetitionRate: roundScore(report.speechRepetitionRate),
    estimatedCostUSD: roundCost(report.estimatedCostUSD),
    evalSet: `local-replay-${record.boardId}`,
    notes: buildNotes(record),
    infoLeakageRate: roundScore(report.infoLeakageRate),
  };
  if (!isValidBenchmarkResult(result)) {
    throw new Error(`Benchmark result for ${fixtureId} violates the GameBenchmarkResult contract`);
  }

  return {
    report,
    result,
    voteAgreement,
    metrics: {
      aiSpeechTurns: report.speechTurns,
      aiVoteTurns: report.actionTurns,
      humanSpeechesOmitted: record.speeches.filter(speech => humanSeats.has(speech.speakerId)).length,
      humanVotesSkipped: record.votes.filter(vote => humanSeats.has(vote.voterId)).length,
      illegalVoteProposals: report.illegalActions.length,
      // A speech can trip several leakage rules; count distinct speech turns.
      leakedSpeechTurns: new Set(report.leakageFindings.map(finding => `${finding.round}:${finding.actorId}`)).size,
      // The runner exposes the rate; recover the integer count it was built from.
      repeatedSpeechTurns: Math.round(report.speechRepetitionRate * report.speechTurns),
      providerCalls: provider.calls.length,
      promptTokens,
      responseTokens,
      totalTokens: promptTokens + responseTokens,
      costPer1kTokensUSD: BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD,
    },
  };
};

export interface LoadedReplayFixture {
  id: string;
  fileName: string;
  replay: ReplayRecord;
}

/** Read every `*.replay.json` fixture in `dir`, sorted by file name. */
export const loadReplayFixtures = (dir: string = BENCHMARK_FIXTURES_DIR): LoadedReplayFixture[] => {
  const fileNames = readdirSync(dir)
    .filter(name => name.endsWith(FIXTURE_FILE_SUFFIX) && !name.startsWith('.'))
    .sort();
  if (fileNames.length === 0) {
    throw new Error(`No ${FIXTURE_FILE_SUFFIX} fixtures found`);
  }
  return fileNames.map(fileName => {
    const raw = readFileSync(join(dir, fileName), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Fixture ${fileName} is not valid JSON`);
    }
    return {
      id: fixtureIdFromFileName(fileName),
      fileName,
      replay: parseReplayFixture(parsed, fileName),
    };
  });
};

export interface BenchmarkFixture extends LoadedReplayFixture, BenchmarkComputation {}

/** Load and convert every fixture; throws when ids are duplicated. */
export const loadBenchmarkFixtures = (dir: string = BENCHMARK_FIXTURES_DIR): BenchmarkFixture[] => {
  const fixtures = loadReplayFixtures(dir).map(fixture => ({
    ...fixture,
    ...buildBenchmarkFromReplay(fixture.replay, fixture.id),
  }));
  const seen = new Set<string>();
  for (const fixture of fixtures) {
    if (seen.has(fixture.id)) throw new Error(`Duplicate benchmark fixture id ${fixture.id}`);
    seen.add(fixture.id);
  }
  return fixtures;
};

/** Group fixtures by `result.dataVersion`, preserving fixture order. */
export const groupBenchmarkFixturesByDataVersion = (
  fixtures: readonly BenchmarkFixture[],
): Map<string, BenchmarkFixture[]> => {
  const groups = new Map<string, BenchmarkFixture[]>();
  for (const fixture of fixtures) {
    const version = fixture.result.dataVersion;
    const group = groups.get(version);
    if (group) group.push(fixture);
    else groups.set(version, [fixture]);
  }
  return groups;
};

/**
 * Golden conversion output used by both `benchmark.test.ts` and
 * `scripts/replay-to-benchmark.mjs --check`. These numbers were captured from
 * the fixture bytes; a deliberate change to the runner, the generator or a
 * fixture must update this table together with the thresholds in
 * `benchmark.ts`.
 */
export const EXPECTED_BENCHMARK_RESULTS: Readonly<Record<string, GameBenchmarkResult>> = {
  'local-12p-001': {
    gameId: 'local-12p-001',
    dataVersion: 'local-replay-v1',
    method: 'replay-evaluation-runner-v1',
    roleConsistencyScore: 0.972222,
    illegalActionRate: 0,
    voteRationalityScore: 0.972222,
    speechRepetitionRate: 0,
    estimatedCostUSD: 0.001536,
    evalSet: 'local-replay-12-standard',
    notes: 'Local anonymous guest match on 12-standard; difficulty normal; language zh; winner WEREWOLVES in 5 rounds; human speech omitted. Not production user data.',
    infoLeakageRate: 0,
  },
  'local-9p-001': {
    gameId: 'local-9p-001',
    dataVersion: 'local-replay-v1',
    method: 'replay-evaluation-runner-v1',
    roleConsistencyScore: 1,
    illegalActionRate: 0,
    voteRationalityScore: 1,
    speechRepetitionRate: 0,
    estimatedCostUSD: 0.000564,
    evalSet: 'local-replay-9-standard',
    notes: 'Local anonymous guest match on 9-standard; difficulty normal; language zh; winner WEREWOLVES in 2 rounds; human speech omitted. Not production user data.',
    infoLeakageRate: 0,
  },
  'local-9p-002': {
    gameId: 'local-9p-002',
    dataVersion: 'local-replay-v1',
    method: 'replay-evaluation-runner-v1',
    roleConsistencyScore: 1,
    illegalActionRate: 0,
    voteRationalityScore: 1,
    speechRepetitionRate: 0,
    estimatedCostUSD: 0.000519,
    evalSet: 'local-replay-9-standard',
    notes: 'Local anonymous guest match on 9-standard; difficulty normal; language zh; winner VILLAGERS in 2 rounds; human speech omitted. Not production user data.',
    infoLeakageRate: 0,
  },
};

// --- END OF FILE src/ai/benchmarkFixtures.ts ---
