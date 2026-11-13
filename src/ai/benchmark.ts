// --- START OF FILE src/ai/benchmark.ts ---
//
// Offline benchmark schema for evaluating AI play quality without live games.
// This is a pure data contract plus threshold constants — it makes no API
// calls and runs no games. It exists so evaluation results can be recorded and
// compared across data versions and methods in a typed, testable way.
//
// H2-C adds the local-replay thresholds. The measured values behind every
// constant come from `src/ai/__fixtures__/replays/**` through
// `src/ai/benchmarkFixtures.ts`; `docs/ai-quality-benchmark.md` repeats the
// table, and `scripts/replay-to-benchmark.mjs --check` enforces it.

export interface GameBenchmarkResult {
  gameId: string;
  /** Dataset version the evaluation ran against, e.g. "local-replay-v1". */
  dataVersion: string;
  /** Generation/eval method, e.g. "replay-evaluation-runner-v1". */
  method: string;
  /** 0–1: how consistently AIs stayed in role. Higher is better. */
  roleConsistencyScore: number;
  /** 0–1: fraction of attempted illegal actions. Lower is better. */
  illegalActionRate: number;
  /** 0–1: how evidence-based votes were. Higher is better. */
  voteRationalityScore: number;
  /** 0–1: fraction of repeated/duplicate speeches. Lower is better. */
  speechRepetitionRate: number;
  /** Estimated total cost of the evaluated game(s) in USD. */
  estimatedCostUSD: number;
  /** Evaluation set identifier, e.g. "local-replay-9-standard". */
  evalSet: string;
  notes: string;
  /**
   * Optional 0–1: fraction of speeches leaking hidden role knowledge.
   * Lower is better. Produced by the offline evaluation harness
   * (`evaluation.ts`); older results omit it.
   */
  infoLeakageRate?: number;
}

/** Fields expected in the 0–1 range, used by validation and tests. */
export const BENCHMARK_UNIT_INTERVAL_FIELDS: ReadonlyArray<keyof GameBenchmarkResult> = [
  'roleConsistencyScore',
  'illegalActionRate',
  'voteRationalityScore',
  'speechRepetitionRate',
];

/** Structural + range validation for a benchmark result. */
export const isValidBenchmarkResult = (r: GameBenchmarkResult): boolean => {
  if (!r) return false;
  const strings: Array<keyof GameBenchmarkResult> = ['gameId', 'dataVersion', 'method', 'evalSet', 'notes'];
  for (const key of strings) {
    if (typeof r[key] !== 'string' || (r[key] as string).length === 0) return false;
  }
  for (const key of BENCHMARK_UNIT_INTERVAL_FIELDS) {
    const v = r[key] as number;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) return false;
  }
  if (typeof r.estimatedCostUSD !== 'number' || r.estimatedCostUSD < 0) return false;
  if (r.infoLeakageRate !== undefined) {
    const v = r.infoLeakageRate;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) return false;
  }
  return true;
};

// ─── Local replay benchmark thresholds (H2-C) ───────────────────────────────
//
// Every constant is `measured value ± explicit margin`, measured on the three
// committed local fixtures through `evaluation.ts`. They are per-fixture bounds:
// one fixture outside any bound fails `benchmark.test.ts` and `--check`.
// Measured values are reported in `docs/ai-quality-benchmark.md`; the note next
// to each constant is the short form. Do not tighten a bound by feel.

/**
 * `illegalActionRate` upper bound. The replay schema records votes but no night
 * actions, so this measures day-vote proposals: an AI vote for itself or for a
 * seat that does not exist. Measured 0.0000 in all three fixtures (0 of 62 AI
 * vote proposals). Margin: one illegal vote in the smallest fixture is
 * 1/12 ≈ 0.083, rounded up to 0.10.
 */
export const MAX_ILLEGAL_ACTION_RATE = 0.1;

/**
 * `speechRepetitionRate` upper bound, AI speeches only (normalised duplicates
 * across a match). Measured max 0.0000 (0 of 69 AI speeches in 3 fixtures).
 * Margin: one repeated line in the smallest fixture is 1/14 ≈ 0.071, rounded
 * up to 0.08.
 */
export const MAX_SPEECH_REPETITION_RATE = 0.08;

/**
 * `infoLeakageRate` upper bound, AI speeches only, using the four
 * `LEAKAGE_RULES` in `evaluation.ts`. Measured max 0.0000 (0 of 69 AI
 * speeches). Margin: one leaked speech in the smallest fixture is
 * 1/14 ≈ 0.071, rounded up to 0.08.
 */
export const MAX_INFO_LEAKAGE_RATE = 0.08;

/**
 * `estimatedCostUSD` upper bound. The mock provider never calls a model; the
 * rate is a nominal planning proxy (see
 * `BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD`), so this bounds the token volume of
 * a recorded match, not a bill. Measured max 0.001536 USD (12-player fixture,
 * 39 AI speeches); bound is ≈ 2.6× that maximum, rounded up to 0.004.
 */
export const MAX_ESTIMATED_COST_USD = 0.004;

/**
 * `roleConsistencyScore` lower bound: share of AI votes that did not target a
 * werewolf teammate. Measured min 0.972222 (35/36 in the 12-player fixture;
 * one difficulty-randomised wolf vote hit a teammate). Margin 0.072, so one
 * such vote in the smallest 12-vote fixture (11/12 ≈ 0.917) still passes.
 */
export const MIN_ROLE_CONSISTENCY_SCORE = 0.9;

/**
 * `voteRationalityScore` lower bound: share of AI votes whose target was in
 * the voter's same-round top-2 suspicion. Measured min 0.972222 (35/36, the
 * same randomised wolf vote). Margin 0.172, so two random votes in a 12-vote
 * match (10/12 ≈ 0.833) still pass.
 */
export const MIN_VOTE_RATIONALITY_SCORE = 0.8;

/**
 * Nominal per-1k-token rate used only to keep `estimatedCostUSD`
 * non-degenerate and comparable across fixtures (~$1 per 1M tokens).
 * This is a planning proxy for regression arithmetic — NOT a published price
 * and NOT a billing claim. No provider is called while measuring.
 */
export const BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD = 0.001;

/**
 * Per-fixture threshold check shared by `benchmark.test.ts` and
 * `scripts/replay-to-benchmark.mjs --check`. Returns human-readable violations;
 * an empty array means the result is inside every published bound.
 */
export const benchmarkThresholdViolations = (r: GameBenchmarkResult): string[] => {
  const violations: string[] = [];
  if (!(r.illegalActionRate <= MAX_ILLEGAL_ACTION_RATE)) {
    violations.push(`illegalActionRate ${r.illegalActionRate} > ${MAX_ILLEGAL_ACTION_RATE}`);
  }
  if (!(r.speechRepetitionRate <= MAX_SPEECH_REPETITION_RATE)) {
    violations.push(`speechRepetitionRate ${r.speechRepetitionRate} > ${MAX_SPEECH_REPETITION_RATE}`);
  }
  if (typeof r.infoLeakageRate === 'number' && !(r.infoLeakageRate <= MAX_INFO_LEAKAGE_RATE)) {
    violations.push(`infoLeakageRate ${r.infoLeakageRate} > ${MAX_INFO_LEAKAGE_RATE}`);
  }
  if (!(r.estimatedCostUSD <= MAX_ESTIMATED_COST_USD)) {
    violations.push(`estimatedCostUSD ${r.estimatedCostUSD} > ${MAX_ESTIMATED_COST_USD}`);
  }
  if (!(r.roleConsistencyScore >= MIN_ROLE_CONSISTENCY_SCORE)) {
    violations.push(`roleConsistencyScore ${r.roleConsistencyScore} < ${MIN_ROLE_CONSISTENCY_SCORE}`);
  }
  if (!(r.voteRationalityScore >= MIN_VOTE_RATIONALITY_SCORE)) {
    violations.push(`voteRationalityScore ${r.voteRationalityScore} < ${MIN_VOTE_RATIONALITY_SCORE}`);
  }
  return violations;
};

// Schema smoke fixture ONLY. It is illustrative, does not come from a run, and
// must not be the data source for benchmark assertions anymore; the real data
// lives in `__fixtures__/replays/**` and is loaded by `benchmarkFixtures.ts`.
export const MOCK_BENCHMARK_RESULT: GameBenchmarkResult = {
  gameId: 'mock-9p-0001',
  dataVersion: 'aiwolf-2024-q2',
  method: 'rag-retrieval-v1',
  roleConsistencyScore: 0.88,
  illegalActionRate: 0.02,
  voteRationalityScore: 0.79,
  speechRepetitionRate: 0.11,
  estimatedCostUSD: 0.0034,
  evalSet: 'synthetic-9p-100games',
  notes: 'Mock fixture for offline schema smoke tests; not from a live run.',
};

// --- END OF FILE src/ai/benchmark.ts ---
