// --- START OF FILE src/ai/benchmark.ts ---
//
// Offline benchmark schema for evaluating AI play quality without live games.
// This is a pure data contract plus a mock fixture — it makes no API calls and
// runs no games. It exists so evaluation results can be recorded and compared
// across data versions and methods in a typed, testable way.

export interface GameBenchmarkResult {
  gameId: string;
  /** Dataset version the evaluation ran against, e.g. "aiwolf-2024-q2". */
  dataVersion: string;
  /** Generation/eval method, e.g. "rag-retrieval-v1". */
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
  /** Evaluation set identifier, e.g. "synthetic-9p-100games". */
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

// Mock fixture for offline evaluation and tests. Values are illustrative only.
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
  notes: 'Mock fixture for offline schema validation; not from a live run.',
};

// --- END OF FILE src/ai/benchmark.ts ---
