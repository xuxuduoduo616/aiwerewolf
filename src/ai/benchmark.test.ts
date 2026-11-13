import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplayRecord } from '../replay/replayTypes';
import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD,
  MAX_ESTIMATED_COST_USD,
  MAX_ILLEGAL_ACTION_RATE,
  MAX_INFO_LEAKAGE_RATE,
  MAX_SPEECH_REPETITION_RATE,
  MIN_ROLE_CONSISTENCY_SCORE,
  MIN_VOTE_RATIONALITY_SCORE,
  MOCK_BENCHMARK_RESULT,
  benchmarkThresholdViolations,
  isValidBenchmarkResult,
  type GameBenchmarkResult,
} from './benchmark';
import {
  BENCHMARK_DATA_VERSION,
  BENCHMARK_FIXTURES_DIR,
  BENCHMARK_METHOD,
  EXPECTED_BENCHMARK_RESULTS,
  HUMAN_SPEECH_PLACEHOLDER,
  assertSanitizedReplay,
  buildScriptedTurns,
  groupBenchmarkFixturesByDataVersion,
  isReplayRecord,
  loadBenchmarkFixtures,
  parseReplayFixture,
} from './benchmarkFixtures';

// Real, sanitized local replays. Loaded once for the whole file; a broken
// fixture fails the suite with the loader's message.
const fixtures = loadBenchmarkFixtures();

const humanSeatsOf = (fixture: (typeof fixtures)[number]): Set<number> =>
  new Set(fixture.replay.players.filter(player => player.isHuman).map(player => player.seat));

// ─── Schema smoke only: the illustrative fixture is not benchmark data ──────

describe('benchmark schema smoke only (MOCK_BENCHMARK_RESULT)', () => {
  it('schema smoke only: mock fixture has all required fields', () => {
    const r = MOCK_BENCHMARK_RESULT;
    expect(typeof r.gameId).toBe('string');
    expect(typeof r.dataVersion).toBe('string');
    expect(typeof r.method).toBe('string');
    expect(typeof r.evalSet).toBe('string');
    expect(typeof r.notes).toBe('string');
    expect(typeof r.roleConsistencyScore).toBe('number');
    expect(typeof r.illegalActionRate).toBe('number');
    expect(typeof r.voteRationalityScore).toBe('number');
    expect(typeof r.speechRepetitionRate).toBe('number');
    expect(typeof r.estimatedCostUSD).toBe('number');
  });

  it('schema smoke only: mock fixture is within valid ranges', () => {
    expect(isValidBenchmarkResult(MOCK_BENCHMARK_RESULT)).toBe(true);
  });

  it('schema smoke only: rejects out-of-range scores', () => {
    const bad: GameBenchmarkResult = { ...MOCK_BENCHMARK_RESULT, roleConsistencyScore: 1.5 };
    expect(isValidBenchmarkResult(bad)).toBe(false);
  });

  it('schema smoke only: rejects negative cost', () => {
    const bad: GameBenchmarkResult = { ...MOCK_BENCHMARK_RESULT, estimatedCostUSD: -1 };
    expect(isValidBenchmarkResult(bad)).toBe(false);
  });

  it('schema smoke only: rejects empty required strings', () => {
    const bad: GameBenchmarkResult = { ...MOCK_BENCHMARK_RESULT, gameId: '' };
    expect(isValidBenchmarkResult(bad)).toBe(false);
  });

  it('schema smoke only: remains valid without infoLeakageRate (back-compat)', () => {
    expect(MOCK_BENCHMARK_RESULT.infoLeakageRate).toBeUndefined();
    expect(isValidBenchmarkResult(MOCK_BENCHMARK_RESULT)).toBe(true);
  });

  it('schema smoke only: accepts infoLeakageRate within [0, 1]', () => {
    const r: GameBenchmarkResult = { ...MOCK_BENCHMARK_RESULT, infoLeakageRate: 0.07 };
    expect(isValidBenchmarkResult(r)).toBe(true);
  });

  it('schema smoke only: rejects out-of-range infoLeakageRate', () => {
    expect(isValidBenchmarkResult({ ...MOCK_BENCHMARK_RESULT, infoLeakageRate: 1.2 })).toBe(false);
    expect(isValidBenchmarkResult({ ...MOCK_BENCHMARK_RESULT, infoLeakageRate: -0.1 })).toBe(false);
    expect(isValidBenchmarkResult({ ...MOCK_BENCHMARK_RESULT, infoLeakageRate: Number.NaN })).toBe(false);
  });
});

// ─── Real local replay fixtures ─────────────────────────────────────────────

describe('benchmark fixtures — local anonymous replays', () => {
  it('loads at least three schemaVersion-1 fixtures covering 9- and 12-player boards', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);

    const boards = fixtures.map(fixture => fixture.replay.boardId);
    expect(boards).toContain('9-standard');
    expect(boards).toContain('12-standard');

    for (const fixture of fixtures) {
      expect(fixture.replay.schemaVersion).toBe(1);
      expect(fixture.fileName.endsWith('.replay.json')).toBe(true);
      expect(fixture.id.length).toBeGreaterThan(0);
      expect(fixture.replay.players.length).toBeGreaterThanOrEqual(9);
      expect(fixture.replay.outcome.rounds).toBeGreaterThanOrEqual(1);
    }

    const twelve = fixtures.filter(fixture => fixture.replay.boardId === '12-standard');
    for (const fixture of twelve) {
      expect(fixture.replay.players).toHaveLength(12);
    }
  });

  it('keeps every fixture sanitized: placeholder-only human speech and no identity keys', () => {
    for (const fixture of fixtures) {
      expect(() => assertSanitizedReplay(fixture.replay)).not.toThrow();
      const humanSeats = humanSeatsOf(fixture);
      for (const speech of fixture.replay.speeches) {
        if (humanSeats.has(speech.speakerId)) {
          expect(speech.text).toBe(HUMAN_SPEECH_PLACEHOLDER);
        }
      }
      // Seats carry exactly seat/role/isHuman: no name, no account id.
      for (const seat of fixture.replay.players) {
        expect(Object.keys(seat).sort()).toEqual(['isHuman', 'role', 'seat']);
      }
    }

    for (const fixture of fixtures) {
      const raw = readFileSync(join(BENCHMARK_FIXTURES_DIR, fixture.fileName), 'utf8');
      expect(raw).not.toMatch(/(playerName|displayName|nickname|avatarUrl)/i);
      expect(raw).not.toMatch(/(^|[^A-Za-z])email([^A-Za-z]|$)/i);
      expect(raw).not.toMatch(/\buserId\b/i);
      expect(raw).not.toMatch(/\b(accessToken|refreshToken|session)\b/i);
      expect(raw).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    }
  });

  it('converts each fixture into a valid GameBenchmarkResult matching the golden table', () => {
    for (const fixture of fixtures) {
      expect(isValidBenchmarkResult(fixture.result)).toBe(true);
      expect(fixture.result.gameId).toBe(fixture.id);
      expect(fixture.result.dataVersion).toBe(BENCHMARK_DATA_VERSION);
      expect(fixture.result.method).toBe(BENCHMARK_METHOD);
      expect(fixture.result.evalSet).toBe(`local-replay-${fixture.replay.boardId}`);
      expect(typeof fixture.result.infoLeakageRate).toBe('number');
      expect(fixture.result).toEqual(EXPECTED_BENCHMARK_RESULTS[fixture.id]);
    }
    // The golden table mirrors exactly the committed fixture set.
    expect(Object.keys(EXPECTED_BENCHMARK_RESULTS).sort()).toEqual(fixtures.map(fixture => fixture.id).sort());
  });

  it('keeps every fixture inside the published thresholds (measured value per bound)', () => {
    for (const fixture of fixtures) {
      const result = fixture.result;
      expect(result.illegalActionRate).toBeLessThanOrEqual(MAX_ILLEGAL_ACTION_RATE);
      expect(result.speechRepetitionRate).toBeLessThanOrEqual(MAX_SPEECH_REPETITION_RATE);
      expect(result.infoLeakageRate as number).toBeLessThanOrEqual(MAX_INFO_LEAKAGE_RATE);
      expect(result.estimatedCostUSD).toBeLessThanOrEqual(MAX_ESTIMATED_COST_USD);
      expect(result.roleConsistencyScore).toBeGreaterThanOrEqual(MIN_ROLE_CONSISTENCY_SCORE);
      expect(result.voteRationalityScore).toBeGreaterThanOrEqual(MIN_VOTE_RATIONALITY_SCORE);
      expect(benchmarkThresholdViolations(result)).toEqual([]);
    }

    // The bounds are applied to real work, not to an empty sample.
    for (const fixture of fixtures) {
      expect(fixture.report.speechTurns).toBeGreaterThan(0);
      expect(fixture.report.actionTurns).toBeGreaterThan(0);
      expect(fixture.metrics.aiSpeechTurns).toBe(fixture.report.speechTurns);
      expect(fixture.metrics.aiVoteTurns).toBe(fixture.report.actionTurns);
    }
  });

  it('ties estimatedCostUSD to the documented proxy rate and measured tokens', () => {
    expect(BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(fixture.metrics.totalTokens).toBeGreaterThan(0);
      expect(fixture.metrics.costPer1kTokensUSD).toBe(BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD);
      expect(fixture.result.estimatedCostUSD).toBeCloseTo(
        (fixture.metrics.totalTokens / 1000) * BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD,
        8,
      );
    }
  });

  it('groups fixtures by dataVersion', () => {
    const groups = groupBenchmarkFixturesByDataVersion(fixtures);
    expect([...groups.keys()]).toEqual([BENCHMARK_DATA_VERSION]);
    expect(groups.get(BENCHMARK_DATA_VERSION)).toHaveLength(fixtures.length);
  });

  it('is deterministic: two independent fixture loads produce identical results', () => {
    const again = loadBenchmarkFixtures();
    expect(again.map(fixture => fixture.result)).toEqual(fixtures.map(fixture => fixture.result));
    expect(again.map(fixture => JSON.stringify(fixture.result))).toEqual(
      fixtures.map(fixture => JSON.stringify(fixture.result)),
    );
  });

  it('replays only AI turns, in round order, speeches before that round votes', () => {
    for (const fixture of fixtures) {
      const humanSeats = humanSeatsOf(fixture);
      const turns = buildScriptedTurns(fixture.replay);
      const expectedSpeechTurns = fixture.replay.speeches
        .filter(speech => !humanSeats.has(speech.speakerId)).length;
      const expectedVoteTurns = fixture.replay.votes
        .filter(vote => !humanSeats.has(vote.voterId) && vote.targetId !== null).length;
      expect(turns).toHaveLength(expectedSpeechTurns + expectedVoteTurns);
      expect(turns.every(turn => !humanSeats.has(turn.actorId))).toBe(true);

      for (let index = 1; index < turns.length; index += 1) {
        const previous = turns[index - 1];
        const current = turns[index];
        expect(current.round).toBeGreaterThanOrEqual(previous.round);
        if (current.round === previous.round && current.kind === 'speech') {
          expect(previous.kind).toBe('speech');
        }
      }
    }
  });

  it('rejects raw human speech and foreign identity keys at the loader boundary', () => {
    const source = fixtures[0];
    const humanSeats = humanSeatsOf(source);
    const humanSpeechIndex = source.replay.speeches.findIndex(speech => humanSeats.has(speech.speakerId));
    expect(humanSpeechIndex).toBeGreaterThanOrEqual(0);

    const rawCopy = JSON.parse(JSON.stringify(source.replay)) as ReplayRecord;
    rawCopy.speeches[humanSpeechIndex].text = 'Hello, my name is Alice.';
    expect(() => assertSanitizedReplay(rawCopy)).toThrow(/human speech/);

    const foreignKeyCopy = JSON.parse(JSON.stringify(source.replay)) as Record<string, unknown>;
    const foreignSpeeches = foreignKeyCopy.speeches as Array<Record<string, unknown>>;
    foreignSpeeches[0].playerName = 'Alice';
    expect(() => parseReplayFixture(foreignKeyCopy, 'raw-export.replay.json')).toThrow(/identity key/);

    expect(isReplayRecord({})).toBe(false);
    expect(isReplayRecord({ schemaVersion: 2 })).toBe(false);
    expect(() => parseReplayFixture({ schemaVersion: 1 }, 'broken.replay.json')).toThrow(/replay shape/);
  });
});
