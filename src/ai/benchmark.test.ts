import { describe, expect, it } from 'vitest';
import { isValidBenchmarkResult, MOCK_BENCHMARK_RESULT, type GameBenchmarkResult } from './benchmark';

describe('benchmark schema', () => {
  it('mock fixture has all required fields', () => {
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

  it('mock fixture is within valid ranges', () => {
    expect(isValidBenchmarkResult(MOCK_BENCHMARK_RESULT)).toBe(true);
  });

  it('rejects out-of-range scores', () => {
    const bad: GameBenchmarkResult = { ...MOCK_BENCHMARK_RESULT, roleConsistencyScore: 1.5 };
    expect(isValidBenchmarkResult(bad)).toBe(false);
  });

  it('rejects negative cost', () => {
    const bad: GameBenchmarkResult = { ...MOCK_BENCHMARK_RESULT, estimatedCostUSD: -1 };
    expect(isValidBenchmarkResult(bad)).toBe(false);
  });

  it('rejects empty required strings', () => {
    const bad: GameBenchmarkResult = { ...MOCK_BENCHMARK_RESULT, gameId: '' };
    expect(isValidBenchmarkResult(bad)).toBe(false);
  });
});
