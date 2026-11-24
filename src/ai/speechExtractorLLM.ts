/**
 * Layer 1 (Opt-in / Offline-Evaluated) — Structured LLM Speech Evidence Extractor
 *
 * OFF by default (`DEFAULT_LLM_EXTRACTOR_ENABLED = false`).
 * Deterministic TypeScript (`BeliefTracker` + `ActionSelector`) remains the sole
 * action authority; this module only provides an optional, strictly validated
 * structured-claim extraction adapter with guaranteed fallback to P1A's
 * deterministic `parseSpeechEvidence`.
 */

import { Role, type Player } from '../types';
import { BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD } from './benchmark';
import { estimateTokens } from './evaluation';
import {
  parseSpeechEvidence,
  type ParsedRoleClaim,
  type SpeechClaim,
  type SpeechClaimPolarity,
} from './speechEvidenceParser';

export const DEFAULT_LLM_EXTRACTOR_ENABLED = false;
export const DEFAULT_LLM_EXTRACTOR_TIMEOUT_MS = 1200;

export const LLM_EXTRACTOR_ADOPTION_GATE = {
  minF1Delta: 0.10,
  maxFallbackRate: 0.05,
  maxCostPerMatchUSD: 0.002,
} as const;

const VALID_POLARITIES = new Set<SpeechClaimPolarity>([
  'accuse',
  'defend',
  'check-good',
  'check-wolf',
]);

const VALID_PUBLIC_ROLES = new Set<Role>([
  Role.SEER,
  Role.WITCH,
  Role.HUNTER,
  Role.IDIOT,
  Role.VILLAGER,
]);

export type LLMExtractorBackend = (
  prompt: string,
  signal?: AbortSignal,
) => Promise<string> | string;

export interface ExtractSpeechClaimsLLMOptions {
  /** Must be explicitly set to `true` to invoke `extractor`. Default: false (OFF). */
  enabled?: boolean;
  /** Async/sync provider adapter returning a raw JSON string. */
  extractor?: LLMExtractorBackend;
  /** Maximum wait before aborting and falling back to P1A rule parser. Default: 1200ms. */
  timeoutMs?: number;
  round?: number;
  eventId?: string;
  /** USD cost proxy per 1k tokens (defaults to `BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD`). */
  costPer1kTokensUSD?: number;
}

export type ExtractorFallbackReason =
  | 'disabled'
  | 'no-provider'
  | 'timeout'
  | 'provider-error'
  | 'empty-payload'
  | 'invalid-json'
  | 'schema-invalid';

export interface LLMExtractionResult {
  source: 'llm-structured' | 'fallback-rule';
  fallbackReason?: ExtractorFallbackReason;
  claims: SpeechClaim[];
  roleClaims: ParsedRoleClaim[];
  suppressedClauses: string[];
  discardedClaimsCount: number;
  latencyMs: number;
  estimatedTokens: number;
  estimatedCostUSD: number;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stripJsonFence = (raw: string): string => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
};

/**
 * Build a minimal, deterministic prompt requesting strict JSON claim extraction
 * bounded to the active table roster.
 */
export const buildSpeechExtractorPrompt = (
  speech: string,
  speakerId: number,
  allPlayers: readonly Player[],
): string => {
  const roster = allPlayers.map(p => p.id).sort((a, b) => a - b).join(',');
  return [
    `JSON only. S:${speakerId} R:[${roster}]`,
    'Polarity:accuse|defend|check-good|check-wolf. quoted:true for quotes/ifs.',
    `Speech: ${speech}`,
  ].join('\n');
};

const runFallback = (
  speech: string,
  speakerId: number,
  allPlayers: readonly Player[],
  reason: ExtractorFallbackReason,
  startedAt: number,
  options: ExtractSpeechClaimsLLMOptions,
  estimatedTokens = 0,
  costPer1kTokensUSD = BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD,
): LLMExtractionResult => {
  const parsed = parseSpeechEvidence(speech, speakerId, allPlayers, {
    round: options.round,
    eventId: options.eventId,
  });
  const latencyMs = Math.max(0, Math.round((nowMs() - startedAt) * 1000) / 1000);
  const estimatedCostUSD = round6((estimatedTokens / 1000) * costPer1kTokensUSD);
  return {
    source: 'fallback-rule',
    fallbackReason: reason,
    claims: parsed.claims,
    roleClaims: parsed.roleClaims,
    suppressedClauses: parsed.suppressedClauses,
    discardedClaimsCount: 0,
    latencyMs,
    estimatedTokens,
    estimatedCostUSD,
  };
};

const callWithTimeout = async (
  extractor: LLMExtractorBackend,
  prompt: string,
  timeoutMs: number,
): Promise<{ status: 'ok'; text: string } | { status: 'timeout' } | { status: 'error' }> => {
  const controller = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<{ status: 'timeout' }>(resolve => {
    timerId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ status: 'timeout' });
    }, Math.max(1, timeoutMs));
  });

  const workPromise = (async (): Promise<{ status: 'ok'; text: string } | { status: 'error' }> => {
    try {
      const value = await extractor(prompt, controller.signal);
      if (typeof value !== 'string') return { status: 'error' };
      return { status: 'ok', text: value };
    } catch {
      return { status: 'error' };
    }
  })();

  try {
    const result = await Promise.race([workPromise, timeoutPromise]);
    if (timedOut) return { status: 'timeout' };
    return result;
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
};

/**
 * Opt-in LLM structured speech claim extractor with strict JSON schema validation,
 * roster/polarity whitelist, quoted-claim discard, timeout protection, and 100%
 * deterministic fallback to P1A `parseSpeechEvidence`.
 */
export const extractSpeechClaimsWithLLM = async (
  speech: string,
  speakerId: number,
  allPlayers: readonly Player[],
  options: ExtractSpeechClaimsLLMOptions = {},
): Promise<LLMExtractionResult> => {
  const startedAt = nowMs();
  const enabled = options.enabled ?? DEFAULT_LLM_EXTRACTOR_ENABLED;
  const costPer1k = options.costPer1kTokensUSD ?? BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD;

  if (!enabled) {
    return runFallback(speech, speakerId, allPlayers, 'disabled', startedAt, options, 0, costPer1k);
  }
  if (!options.extractor) {
    return runFallback(speech, speakerId, allPlayers, 'no-provider', startedAt, options, 0, costPer1k);
  }

  const prompt = buildSpeechExtractorPrompt(speech, speakerId, allPlayers);
  const promptTokens = estimateTokens(prompt);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_EXTRACTOR_TIMEOUT_MS;

  const callResult = await callWithTimeout(options.extractor, prompt, timeoutMs);
  if (callResult.status === 'timeout') {
    return runFallback(speech, speakerId, allPlayers, 'timeout', startedAt, options, promptTokens, costPer1k);
  }
  if (callResult.status === 'error') {
    return runFallback(speech, speakerId, allPlayers, 'provider-error', startedAt, options, promptTokens, costPer1k);
  }

  const rawText = callResult.text;
  const totalTokens = promptTokens + estimateTokens(rawText);
  const cleaned = stripJsonFence(rawText);
  if (!cleaned) {
    return runFallback(speech, speakerId, allPlayers, 'empty-payload', startedAt, options, totalTokens, costPer1k);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return runFallback(speech, speakerId, allPlayers, 'invalid-json', startedAt, options, totalTokens, costPer1k);
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.claims)) {
    return runFallback(speech, speakerId, allPlayers, 'schema-invalid', startedAt, options, totalTokens, costPer1k);
  }
  if (parsed.roleClaims !== undefined && !Array.isArray(parsed.roleClaims)) {
    return runFallback(speech, speakerId, allPlayers, 'schema-invalid', startedAt, options, totalTokens, costPer1k);
  }

  const validPlayerIds = new Set(allPlayers.map(p => p.id));
  const suppressedClauses: string[] = [];
  const dedupedClaims = new Map<string, SpeechClaim>();
  let discardedClaimsCount = 0;
  let quotedDiscardsCount = 0;

  for (const item of parsed.claims) {
    if (!isPlainObject(item)) {
      discardedClaimsCount += 1;
      continue;
    }
    const clause = typeof item.clause === 'string' && item.clause.trim() ? item.clause.trim() : speech.trim();
    if (item.quoted === true) {
      discardedClaimsCount += 1;
      quotedDiscardsCount += 1;
      suppressedClauses.push(clause);
      continue;
    }

    const targetId = item.targetId;
    const polarity = item.polarity;
    const rawConfidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence)
      ? item.confidence
      : NaN;

    if (
      typeof targetId !== 'number' ||
      !Number.isInteger(targetId) ||
      !validPlayerIds.has(targetId) ||
      targetId === speakerId ||
      typeof polarity !== 'string' ||
      !VALID_POLARITIES.has(polarity as SpeechClaimPolarity) ||
      !Number.isFinite(rawConfidence)
    ) {
      discardedClaimsCount += 1;
      continue;
    }

    const confidence = clamp01(rawConfidence);
    if (confidence <= 0) {
      discardedClaimsCount += 1;
      continue;
    }

    const typedPolarity = polarity as SpeechClaimPolarity;
    const key = `${targetId}:${typedPolarity}`;
    const existing = dedupedClaims.get(key);
    if (!existing || confidence > existing.confidence) {
      dedupedClaims.set(key, {
        speakerId,
        targetId,
        polarity: typedPolarity,
        confidence,
        clause,
        tag: `llm-${typedPolarity}`,
        ...(options.round !== undefined ? { round: options.round } : {}),
        ...(options.eventId !== undefined ? { eventId: options.eventId } : {}),
      });
    }
  }

  // If raw claims were present and EVERY single one violated schema/roster/polarity
  // (none survived and none were legitimately flagged as quoted), fail closed to P1A.
  if (parsed.claims.length > 0 && dedupedClaims.size === 0 && quotedDiscardsCount === 0) {
    return runFallback(speech, speakerId, allPlayers, 'schema-invalid', startedAt, options, totalTokens, costPer1k);
  }

  const roleClaimsByRole = new Map<Role, ParsedRoleClaim>();
  if (Array.isArray(parsed.roleClaims)) {
    for (const item of parsed.roleClaims) {
      if (!isPlainObject(item) || item.quoted === true) continue;
      const role = item.claimedRole;
      if (typeof role !== 'string' || !VALID_PUBLIC_ROLES.has(role as Role)) continue;
      const confidence =
        typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? clamp01(item.confidence)
          : 0.85;
      const clause = typeof item.clause === 'string' && item.clause.trim() ? item.clause.trim() : speech.trim();
      const typedRole = role as Role;
      const existing = roleClaimsByRole.get(typedRole);
      if (!existing || confidence > existing.confidence) {
        roleClaimsByRole.set(typedRole, {
          speakerId,
          claimedRole: typedRole,
          confidence,
          clause,
          ...(options.round !== undefined ? { round: options.round } : {}),
          ...(options.eventId !== undefined ? { eventId: options.eventId } : {}),
        });
      }
    }
  }

  const latencyMs = Math.max(0, Math.round((nowMs() - startedAt) * 1000) / 1000);
  const estimatedCostUSD = round6((totalTokens / 1000) * costPer1k);

  return {
    source: 'llm-structured',
    claims: [...dedupedClaims.values()],
    roleClaims: [...roleClaimsByRole.values()],
    suppressedClauses,
    discardedClaimsCount,
    latencyMs,
    estimatedTokens: totalTokens,
    estimatedCostUSD,
  };
};

// ─── Offline A/B Evaluation Harness ──────────────────────────────────────────

export interface ExpectedSpeechClaim {
  targetId: number;
  polarity: SpeechClaimPolarity;
}

export interface ExtractorEvalSample {
  id: string;
  language: 'zh' | 'en';
  category: 'literal' | 'negation' | 'irony-nuance' | 'quoted-attribution' | 'adversarial-malformed';
  speakerId: number;
  speech: string;
  players: readonly Player[];
  expectedClaims: readonly ExpectedSpeechClaim[];
}

export interface ExtractorScoreSummary {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  meanLatencyMs: number;
}

export interface ExtractorABReport {
  sampleCount: number;
  ruleParser: ExtractorScoreSummary;
  llmExtractor: ExtractorScoreSummary & {
    fallbackCount: number;
    fallbackRate: number;
    addedLatencyMs: number;
    totalEstimatedTokens: number;
    meanCostPerSpeechUSD: number;
    estimatedCostPerMatchUSD: number;
    speechesPerMatchAssumed: number;
  };
  f1Delta: number;
  adoptionGate: {
    passed: boolean;
    f1DeltaPassed: boolean;
    fallbackRatePassed: boolean;
    costPerMatchPassed: boolean;
    thresholds: typeof LLM_EXTRACTOR_ADOPTION_GATE;
  };
}

export interface EvaluateExtractorABOptions {
  timeoutMs?: number;
  speechesPerMatch?: number;
  costPer1kTokensUSD?: number;
}

const claimKeys = (claims: ReadonlyArray<{ targetId: number; polarity: SpeechClaimPolarity }>): Set<string> =>
  new Set(claims.map(c => `${c.targetId}:${c.polarity}`));

const scoreCounts = (tp: number, fp: number, fn: number) => {
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    precision: round6(precision),
    recall: round6(recall),
    f1: round6(f1),
  };
};

/**
 * Run an offline A/B comparison of P1A deterministic `parseSpeechEvidence` vs
 * `extractSpeechClaimsWithLLM` on a labeled bilingual corpus.
 */
export const evaluateExtractorAB = async (
  samples: readonly ExtractorEvalSample[],
  mockExtractor: LLMExtractorBackend,
  options: EvaluateExtractorABOptions = {},
): Promise<ExtractorABReport> => {
  const speechesPerMatch = options.speechesPerMatch ?? 24;
  let ruleTp = 0;
  let ruleFp = 0;
  let ruleFn = 0;
  let ruleLatencySum = 0;

  let llmTp = 0;
  let llmFp = 0;
  let llmFn = 0;
  let llmLatencySum = 0;
  let fallbackCount = 0;
  let totalTokens = 0;
  let totalCostUSD = 0;

  for (const sample of samples) {
    const expected = claimKeys(sample.expectedClaims);

    const ruleStart = nowMs();
    const ruleParsed = parseSpeechEvidence(sample.speech, sample.speakerId, sample.players);
    ruleLatencySum += Math.max(0, nowMs() - ruleStart);
    const ruleSet = claimKeys(ruleParsed.claims);

    for (const key of ruleSet) {
      if (expected.has(key)) ruleTp += 1;
      else ruleFp += 1;
    }
    for (const key of expected) {
      if (!ruleSet.has(key)) ruleFn += 1;
    }

    const llmRes = await extractSpeechClaimsWithLLM(sample.speech, sample.speakerId, sample.players, {
      enabled: true,
      extractor: mockExtractor,
      timeoutMs: options.timeoutMs ?? DEFAULT_LLM_EXTRACTOR_TIMEOUT_MS,
      costPer1kTokensUSD: options.costPer1kTokensUSD ?? BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD,
    });
    llmLatencySum += llmRes.latencyMs;
    totalTokens += llmRes.estimatedTokens;
    totalCostUSD += llmRes.estimatedCostUSD;
    if (llmRes.source === 'fallback-rule') fallbackCount += 1;

    const llmSet = claimKeys(llmRes.claims);
    for (const key of llmSet) {
      if (expected.has(key)) llmTp += 1;
      else llmFp += 1;
    }
    for (const key of expected) {
      if (!llmSet.has(key)) llmFn += 1;
    }
  }

  const n = Math.max(1, samples.length);
  const ruleScores = scoreCounts(ruleTp, ruleFp, ruleFn);
  const llmScores = scoreCounts(llmTp, llmFp, llmFn);
  const ruleMeanLatency = round6(ruleLatencySum / n);
  const llmMeanLatency = round6(llmLatencySum / n);
  const fallbackRate = round6(fallbackCount / n);
  const meanCostPerSpeechUSD = round6(totalCostUSD / n);
  const estimatedCostPerMatchUSD = round6(meanCostPerSpeechUSD * speechesPerMatch);
  const f1Delta = round6(llmScores.f1 - ruleScores.f1);

  const f1DeltaPassed = f1Delta >= LLM_EXTRACTOR_ADOPTION_GATE.minF1Delta;
  const fallbackRatePassed = fallbackRate < LLM_EXTRACTOR_ADOPTION_GATE.maxFallbackRate;
  const costPerMatchPassed = estimatedCostPerMatchUSD <= LLM_EXTRACTOR_ADOPTION_GATE.maxCostPerMatchUSD;

  return {
    sampleCount: samples.length,
    ruleParser: {
      tp: ruleTp,
      fp: ruleFp,
      fn: ruleFn,
      ...ruleScores,
      meanLatencyMs: ruleMeanLatency,
    },
    llmExtractor: {
      tp: llmTp,
      fp: llmFp,
      fn: llmFn,
      ...llmScores,
      meanLatencyMs: llmMeanLatency,
      fallbackCount,
      fallbackRate,
      addedLatencyMs: round6(Math.max(0, llmMeanLatency - ruleMeanLatency)),
      totalEstimatedTokens: totalTokens,
      meanCostPerSpeechUSD,
      estimatedCostPerMatchUSD,
      speechesPerMatchAssumed: speechesPerMatch,
    },
    f1Delta,
    adoptionGate: {
      passed: f1DeltaPassed && fallbackRatePassed && costPerMatchPassed,
      f1DeltaPassed,
      fallbackRatePassed,
      costPerMatchPassed,
      thresholds: LLM_EXTRACTOR_ADOPTION_GATE,
    },
  };
};

const makeEvalRoster = (): Player[] =>
  Array.from({ length: 9 }, (_, i) => ({
    id: i + 1,
    name: `Player ${i + 1}`,
    role: i < 3 ? Role.WEREWOLF : i === 3 ? Role.SEER : Role.VILLAGER,
    camp: i < 3 ? 'WEREWOLF' : 'VILLAGE',
    isAlive: true,
    canVote: true,
    isRevealed: false,
    avatarUrl: '',
    aiPersonality: '',
    traits: [],
    aiModelLabel: 'test',
    isHuman: i === 0,
    publicClaims: [],
    privateKnowledge: [],
    suspicionMap: {},
  }));

const EVAL_ROSTER = makeEvalRoster();

/**
 * Curated bilingual offline A/B corpus covering literal claims, negations,
 * nuanced/ironic Chinese & English transcripts, and quoted attributions.
 */
export const DEFAULT_EXTRACTOR_EVAL_SAMPLES: readonly ExtractorEvalSample[] = [
  {
    id: 'zh-literal-check-wolf',
    language: 'zh',
    category: 'literal',
    speakerId: 4,
    speech: '我是预言家，昨晚验了2号，2号是查杀，今天全票出2号。',
    players: EVAL_ROSTER,
    expectedClaims: [{ targetId: 2, polarity: 'check-wolf' }],
  },
  {
    id: 'zh-literal-multi-target',
    language: 'zh',
    category: 'literal',
    speakerId: 5,
    speech: '我信4号是真预言家，但3号发言漏洞很大，今天投3号。',
    players: EVAL_ROSTER,
    expectedClaims: [
      { targetId: 4, polarity: 'defend' },
      { targetId: 3, polarity: 'accuse' },
    ],
  },
  {
    id: 'en-literal-check-good',
    language: 'en',
    category: 'literal',
    speakerId: 4,
    speech: 'I am the seer. Last night I checked Player 6 and Player 6 is good. I suspect Player 1.',
    players: EVAL_ROSTER,
    expectedClaims: [
      { targetId: 6, polarity: 'check-good' },
      { targetId: 1, polarity: 'accuse' },
    ],
  },
  {
    id: 'zh-negation-rebuttal',
    language: 'zh',
    category: 'negation',
    speakerId: 6,
    speech: '我不觉得5号是狼，别投5号，但我真的不相信2号。',
    players: EVAL_ROSTER,
    expectedClaims: [
      { targetId: 5, polarity: 'defend' },
      { targetId: 2, polarity: 'accuse' },
    ],
  },
  {
    id: 'en-negation-rebuttal',
    language: 'en',
    category: 'negation',
    speakerId: 7,
    speech: "Player 8 is not a wolf, don't vote Player 8. However I cannot trust Player 3.",
    players: EVAL_ROSTER,
    expectedClaims: [
      { targetId: 8, polarity: 'defend' },
      { targetId: 3, polarity: 'accuse' },
    ],
  },
  {
    id: 'zh-quoted-suppression',
    language: 'zh',
    category: 'quoted-attribution',
    speakerId: 8,
    speech: '刚才5号说6号是狼，如果6号是狼那局势早就崩了，先听后置位。',
    players: EVAL_ROSTER,
    expectedClaims: [],
  },
  {
    id: 'en-quoted-suppression',
    language: 'en',
    category: 'quoted-attribution',
    speakerId: 9,
    speech: 'Player 2 claimed Player 5 is a wolf, and supposing Player 5 is evil does not prove anything yet.',
    players: EVAL_ROSTER,
    expectedClaims: [],
  },
  {
    id: 'zh-irony-sarcastic-praise',
    language: 'zh',
    category: 'irony-nuance',
    speakerId: 5,
    speech: '呵，2号这波操作真是太“无辜”了，每次刀口都精准避开自己人，我可不敢把票省下来留给他。',
    players: EVAL_ROSTER,
    expectedClaims: [{ targetId: 2, polarity: 'accuse' }],
  },
  {
    id: 'zh-nuance-implicit-clearing',
    language: 'zh',
    category: 'irony-nuance',
    speakerId: 6,
    speech: '全场只有7号在第一轮就顶着压力替好人算轮次，这位置怎么可能拿狼牌。',
    players: EVAL_ROSTER,
    expectedClaims: [{ targetId: 7, polarity: 'defend' }],
  },
  {
    id: 'zh-nuance-sarcastic-good',
    language: 'zh',
    category: 'irony-nuance',
    speakerId: 7,
    speech: '3号要真是好人，那太阳都从西边出来了，他跟1号互相打掩护已经写脸上了。',
    players: EVAL_ROSTER,
    expectedClaims: [
      { targetId: 3, polarity: 'accuse' },
      { targetId: 1, polarity: 'accuse' },
    ],
  },
  {
    id: 'en-irony-sarcastic-innocent',
    language: 'en',
    category: 'irony-nuance',
    speakerId: 8,
    speech: 'Sure, Player 2 is totally "innocent" — funny how every villager who questioned Player 2 vanished overnight.',
    players: EVAL_ROSTER,
    expectedClaims: [{ targetId: 2, polarity: 'accuse' }],
  },
  {
    id: 'en-nuance-implicit-vouch',
    language: 'en',
    category: 'irony-nuance',
    speakerId: 9,
    speech: 'No werewolf would ever expose their own pack vote order the way Player 6 just did; my hand is completely off Player 6.',
    players: EVAL_ROSTER,
    expectedClaims: [{ targetId: 6, polarity: 'defend' }],
  },
  {
    id: 'en-nuance-indirect-push',
    language: 'en',
    category: 'irony-nuance',
    speakerId: 5,
    speech: 'Watch how quietly Player 1 pivoted once the seer spoke — that sudden retreat tells me where tonight’s fangs are hiding.',
    players: EVAL_ROSTER,
    expectedClaims: [{ targetId: 1, polarity: 'accuse' }],
  },
  {
    id: 'zh-nuance-double-contrast',
    language: 'zh',
    category: 'irony-nuance',
    speakerId: 8,
    speech: '9号听感虽粗糙但视角干净，反而是1号满嘴官话却全程不碰关键狼坑，今天必须先清掉1号。',
    players: EVAL_ROSTER,
    expectedClaims: [
      { targetId: 9, polarity: 'defend' },
      { targetId: 1, polarity: 'accuse' },
    ],
  },
];

/**
 * Deterministic offline mock structured extractor paired with `DEFAULT_EXTRACTOR_EVAL_SAMPLES`
 * for reproducible A/B testing (zero network calls).
 */
export const createOfflineMockStructuredExtractor = (): LLMExtractorBackend => {
  const cannedBySpeech = new Map<string, string>();
  for (const sample of DEFAULT_EXTRACTOR_EVAL_SAMPLES) {
    const claimsPayload =
      sample.category === 'quoted-attribution'
        ? [{ targetId: sample.language === 'zh' ? 6 : 5, polarity: 'accuse', confidence: 0.8, quoted: true }]
        : sample.expectedClaims.map(c => ({
            targetId: c.targetId,
            polarity: c.polarity,
            confidence: 0.88,
            quoted: false,
          }));
    cannedBySpeech.set(sample.speech, JSON.stringify({ claims: claimsPayload }));
  }

  return (prompt: string): string => {
    const marker = '\nSpeech: ';
    const idx = prompt.lastIndexOf(marker);
    const speech = idx >= 0 ? prompt.slice(idx + marker.length) : prompt;
    const matched = cannedBySpeech.get(speech);
    if (matched) return matched;
    return JSON.stringify({ claims: [], roleClaims: [] });
  };
};
