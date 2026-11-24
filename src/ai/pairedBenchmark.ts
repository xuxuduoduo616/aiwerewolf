// --- START OF FILE src/ai/pairedBenchmark.ts ---
//
// Deterministic offline paired-evidence evaluation benchmark (P1–P9).
//
// Runs single-variable counterfactual pairs through the real BeliefTracker,
// PlayerMemoryStore, ActionSelector, AIOrchestrator (`generateAIAction`), and
// multi-language leakage detector using a seeded 32-bit LCG RNG. Zero network,
// zero LLM calls. Never imported from `src/App.tsx`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canWitchSelfSave, getRoleCamp } from '../gameEngine';
import { GamePhase, Role, type Difficulty, type Player } from '../types';
import {
  selectAction,
  type ActionDecision,
  type ActionType,
} from './actionSelector';
import { generateAIAction, setAIDifficulty } from './aiOrchestrator';
import { BeliefTracker, globalBeliefTracker } from './beliefTracker';
import {
  detectInfoLeakage,
  runReplay,
  type CounterfactualComparison,
  type ReplayInput,
} from './evaluation';
import { canSeatRead, WOLF_TEAMMATE_SUSPICION, type VisibleEvent } from './playerMemory';

// ─── Seeded PRNG (32-bit LCG) ───────────────────────────────────────────────

/** Deterministic 32-bit linear congruential generator returning values in [0, 1). */
export const createSeededRng = (seed: number): (() => number) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

// ─── Dataset types ──────────────────────────────────────────────────────────

export interface PairedSeatTemplate {
  seat: number;
  role: Role;
  isHuman: boolean;
  isAlive?: boolean;
  isRevealed?: boolean;
  isWolfHopper?: boolean;
}

export interface PairedCaseDefinition {
  id: 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9';
  title: string;
  category: string;
  evidenceSwap: boolean;
  boardId: string;
  difficulty: Difficulty;
  actionAccuracy: number;
  seed: number;
  visibleState: Record<string, unknown>;
}

export interface PairedCasesDataset {
  schemaVersion: number;
  datasetVersion: string;
  boardTemplates: Record<string, PairedSeatTemplate[]>;
  cases: PairedCaseDefinition[];
}

export const PAIRED_CASES_PATH = fileURLToPath(
  new URL('./__fixtures__/paired/cases.json', import.meta.url),
);

export const loadPairedCases = (filePath: string = PAIRED_CASES_PATH): PairedCasesDataset => {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as PairedCasesDataset;
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.cases)) {
    throw new Error(`Invalid paired cases dataset at ${filePath}`);
  }
  return parsed;
};

// ─── Report & Metrics types ─────────────────────────────────────────────────

export interface RoleActionDistribution {
  VOTE: number;
  KILL: number;
  CHECK: number;
  POISON: number;
  HOLD: number;
  SAVE: number;
  SHOOT: number;
}

export interface DecisionLatencyStats {
  p50: number;
  p95: number;
  max: number;
}

export interface PairedCaseResult {
  id: PairedCaseDefinition['id'];
  title: string;
  category: string;
  evidenceSwap: boolean;
  seed: number;
  passed: boolean;
  failures: string[];
  summary: string;
  details: Record<string, unknown>;
}

export interface PairedBenchmarkSummary {
  datasetVersion: string;
  casesPassed: number;
  casesTotal: number;
  evidenceSensitivityRate: number;
  roleActionDistribution: RoleActionDistribution;
  tieBreakUniformity: number;
  tieBreakRate: number;
  fallbackRate: number;
  illegalActionRate: number;
  unauthorizedInfoReadRate: number;
  decisionLatencyMs: DecisionLatencyStats;
}

export interface PairedBenchmarkReport {
  summary: PairedBenchmarkSummary;
  cases: PairedCaseResult[];
}

export interface DeterministicPairedBenchmarkReport {
  summary: Omit<PairedBenchmarkSummary, 'decisionLatencyMs'>;
  cases: PairedCaseResult[];
}

export interface CounterfactualPolicySummary {
  gameId: string;
  totalActions: number;
  agreedCount: number;
  divergedCount: number;
  agreementRate: number;
  divergenceRate: number;
  multilingualLeakageRate: number;
  leakageFindingCount: number;
  comparisons: CounterfactualComparison[];
}

export interface PairedBenchmarkCheckOutcome {
  ok: boolean;
  problems: string[];
  notes: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const round3 = (value: number): number => Math.round(value * 1e3) / 1e3;

const buildPlayers = (
  templates: readonly PairedSeatTemplate[],
  overrides: Record<number, Partial<Player>> = {},
): Player[] =>
  templates.map(seat => ({
    id: seat.seat,
    name: `P${seat.seat}`,
    role: seat.role,
    camp: getRoleCamp(seat.role),
    isAlive: seat.isAlive ?? true,
    canVote: true,
    isRevealed: seat.isRevealed ?? false,
    avatarUrl: '',
    aiPersonality: '',
    traits: [],
    aiModelLabel: '',
    isHuman: seat.isHuman,
    isWolfHopper: seat.isWolfHopper,
    publicClaims: [],
    privateKnowledge: [],
    suspicionMap: {},
    ...(overrides[seat.seat] ?? {}),
  }));

interface RecordedDecisionCheck {
  actor: Player;
  players: readonly Player[];
  actionType: ActionType;
  round: number;
  decision: ActionDecision;
  checkedTargetIds?: ReadonlySet<number>;
  excludedTargetIds?: ReadonlySet<number>;
  wolfKillId?: number | null;
  hasSave?: boolean;
}

const isLegalDecision = (entry: RecordedDecisionCheck): boolean => {
  const { actor, players, actionType, round, decision } = entry;
  if (decision.outcome === 'HOLD' || decision.outcome === 'NO_TARGET') {
    return decision.targetId === null;
  }
  if (decision.targetId === null) return false;
  const target = players.find(p => p.id === decision.targetId);
  if (!target || !target.isAlive) return false;

  if (actionType === 'SAVE') {
    if (entry.hasSave === false) return false;
    if (entry.wolfKillId !== undefined && target.id !== entry.wolfKillId) return false;
    return canWitchSelfSave(round, actor.id, target.id);
  }

  if (target.id === actor.id) return false;
  if (entry.excludedTargetIds?.has(target.id)) return false;

  switch (actionType) {
    case 'KILL':
      return target.role !== Role.WEREWOLF;
    case 'CHECK':
      return !target.isRevealed && !entry.checkedTargetIds?.has(target.id);
    case 'POISON':
      return !target.isRevealed;
    case 'VOTE':
    case 'SHOOT':
      return true;
  }
};

const computePercentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return round3(sorted[index]);
};

interface MetricsCollector {
  roleActionDistribution: RoleActionDistribution;
  totalDecisions: number;
  tieBrokenCount: number;
  fallbackCount: number;
  illegalActionCount: number;
  latenciesMs: number[];
  privacyProbes: number;
  unauthorizedReads: number;
  tieBreakUniformity: number;
}

const createMetricsCollector = (): MetricsCollector => ({
  roleActionDistribution: {
    VOTE: 0,
    KILL: 0,
    CHECK: 0,
    POISON: 0,
    HOLD: 0,
    SAVE: 0,
    SHOOT: 0,
  },
  totalDecisions: 0,
  tieBrokenCount: 0,
  fallbackCount: 0,
  illegalActionCount: 0,
  latenciesMs: [],
  privacyProbes: 0,
  unauthorizedReads: 0,
  tieBreakUniformity: 1,
});

const recordDecision = (collector: MetricsCollector, entry: RecordedDecisionCheck): void => {
  const { decision, actionType } = entry;
  collector.totalDecisions += 1;
  if (decision.outcome === 'HOLD') {
    collector.roleActionDistribution.HOLD += 1;
  } else if (decision.outcome === 'ACT') {
    collector.roleActionDistribution[actionType] += 1;
  }
  if (decision.tieBroken || decision.trace?.tieBroken) {
    collector.tieBrokenCount += 1;
  }
  if (decision.trace?.fallback) {
    collector.fallbackCount += 1;
  }
  if (!isLegalDecision(entry)) {
    collector.illegalActionCount += 1;
  }
  const latency = decision.trace?.latencyMs ?? 0;
  collector.latenciesMs.push(Number.isFinite(latency) && latency >= 0 ? latency : 0);
};

// ─── Case Runners (P1–P9) ───────────────────────────────────────────────────

const runCaseP1 = async (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): Promise<PairedCaseResult> => {
  const vs = def.visibleState as {
    round: number;
    speakerId: number;
    listenerId: number;
    hunterId: number;
    targetId: number;
    accuseSpeech: string;
    trustSpeech: string;
  };
  const failures: string[] = [];
  const players = buildPlayers(templates);
  const listener = players.find(p => p.id === vs.listenerId)!;
  const hunter = players.find(p => p.id === vs.hunterId)!;

  // Branch A: Human accuses target
  const trackerA = new BeliefTracker();
  trackerA.init(players);
  trackerA.updateFromSpeech(vs.speakerId, vs.accuseSpeech, players, {
    round: vs.round,
    eventId: 'p1-accuse',
  });
  const susA = round6(trackerA.getSuspicion(vs.listenerId, vs.targetId));
  const voteA = selectAction(listener, players, trackerA, 'VOTE', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: voteA });

  const shootA = selectAction(hunter, players, trackerA, 'SHOOT', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed + 1),
    phase: GamePhase.DAY_HUNTER_SHOT,
  });
  recordDecision(collector, { actor: hunter, players, actionType: 'SHOOT', round: vs.round, decision: shootA });

  // Branch B: Human trusts target
  const trackerB = new BeliefTracker();
  trackerB.init(players);
  trackerB.updateFromSpeech(vs.speakerId, vs.trustSpeech, players, {
    round: vs.round,
    eventId: 'p1-trust',
  });
  const susB = round6(trackerB.getSuspicion(vs.listenerId, vs.targetId));
  const voteB = selectAction(listener, players, trackerB, 'VOTE', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: voteB });

  const shootB = selectAction(hunter, players, trackerB, 'SHOOT', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed + 1),
    phase: GamePhase.DAY_HUNTER_SHOT,
  });
  recordDecision(collector, { actor: hunter, players, actionType: 'SHOOT', round: vs.round, decision: shootB });

  // Orchestrator path (`generateAIAction`) verification for both branches
  let orchVoteA: ActionDecision;
  let orchVoteB: ActionDecision;
  try {
    setAIDifficulty(def.actionAccuracy);

    globalBeliefTracker.init(players);
    globalBeliefTracker.updateFromSpeech(vs.speakerId, vs.accuseSpeech, players, {
      round: vs.round,
      eventId: 'p1-orch-accuse',
    });
    orchVoteA = await generateAIAction(listener, players, [], 'VOTE', [], vs.round, {
      rng: createSeededRng(def.seed),
      phase: GamePhase.DAY_VOTING,
      deferVoteBeliefUpdate: true,
    });
    recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: orchVoteA });

    globalBeliefTracker.init(players);
    globalBeliefTracker.updateFromSpeech(vs.speakerId, vs.trustSpeech, players, {
      round: vs.round,
      eventId: 'p1-orch-trust',
    });
    orchVoteB = await generateAIAction(listener, players, [], 'VOTE', [], vs.round, {
      rng: createSeededRng(def.seed),
      phase: GamePhase.DAY_VOTING,
      deferVoteBeliefUpdate: true,
    });
    recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: orchVoteB });
  } finally {
    globalBeliefTracker.reset();
    setAIDifficulty(0.85);
  }

  if (!(susA > 0.5)) failures.push(`accuse suspicion ${susA} did not rise above 0.5`);
  if (!(susB < 0.5)) failures.push(`trust suspicion ${susB} did not drop below 0.5`);
  if (voteA.targetId !== vs.targetId) failures.push(`selectAction accuse vote picked ${voteA.targetId}, expected ${vs.targetId}`);
  if (voteB.targetId === vs.targetId) failures.push(`selectAction trust vote failed to flip away from ${vs.targetId}`);
  if (orchVoteA.targetId !== vs.targetId) failures.push(`generateAIAction accuse vote picked ${orchVoteA.targetId}, expected ${vs.targetId}`);
  if (orchVoteB.targetId === vs.targetId) failures.push(`generateAIAction trust vote failed to flip away from ${vs.targetId}`);
  if (shootA.targetId !== vs.targetId) failures.push(`hunter accuse shoot picked ${shootA.targetId}, expected ${vs.targetId}`);
  if (shootB.targetId === vs.targetId) failures.push(`hunter trust shoot failed to flip away from ${vs.targetId}`);

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `sus(${vs.targetId}): ${susA} (accuse) -> ${susB} (trust); vote ${voteA.targetId}->${voteB.targetId}; shoot ${shootA.targetId}->${shootB.targetId}`,
    details: {
      accuseSuspicion: susA,
      trustSuspicion: susB,
      selectVoteAccuse: voteA.targetId,
      selectVoteTrust: voteB.targetId,
      orchestratorVoteAccuse: orchVoteA.targetId,
      orchestratorVoteTrust: orchVoteB.targetId,
      hunterShootAccuse: shootA.targetId,
      hunterShootTrust: shootB.targetId,
    },
  };
};

const runCaseP2 = (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): PairedCaseResult => {
  const vs = def.visibleState as {
    round: number;
    speakerId: number;
    listenerId: number;
    trustTargetId: number;
    accuseTargetId: number;
    zhSpeech: string;
    enSpeech: string;
    zhSwappedSpeech: string;
    enSwappedSpeech: string;
  };
  const failures: string[] = [];
  const players = buildPlayers(templates);
  const listener = players.find(p => p.id === vs.listenerId)!;

  const evalBranch = (
    label: string,
    speech: string,
    expectedTrustId: number,
    expectedAccuseId: number,
    seedOffset: number,
  ) => {
    const tracker = new BeliefTracker();
    tracker.init(players);
    tracker.updateFromSpeech(vs.speakerId, speech, players, {
      round: vs.round,
      eventId: `p2-${label}`,
    });
    const trustSus = round6(tracker.getSuspicion(vs.listenerId, expectedTrustId));
    const accuseSus = round6(tracker.getSuspicion(vs.listenerId, expectedAccuseId));
    const vote = selectAction(listener, players, tracker, 'VOTE', vs.round, [], def.actionAccuracy, {
      rng: createSeededRng(def.seed + seedOffset),
      phase: GamePhase.DAY_VOTING,
    });
    recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: vote });

    if (!(trustSus < 0.5)) failures.push(`${label}: trusted seat ${expectedTrustId} suspicion ${trustSus} not < 0.5`);
    if (!(accuseSus > 0.5)) failures.push(`${label}: accused seat ${expectedAccuseId} suspicion ${accuseSus} not > 0.5`);
    if (vote.targetId !== expectedAccuseId) {
      failures.push(`${label}: vote picked ${vote.targetId}, expected ${expectedAccuseId}`);
    }
    return { trustSus, accuseSus, voteTargetId: vote.targetId };
  };

  const zh = evalBranch('zh', vs.zhSpeech, vs.trustTargetId, vs.accuseTargetId, 0);
  const en = evalBranch('en', vs.enSpeech, vs.trustTargetId, vs.accuseTargetId, 1);
  const zhSwapped = evalBranch('zh-swapped', vs.zhSwappedSpeech, vs.accuseTargetId, vs.trustTargetId, 2);
  const enSwapped = evalBranch('en-swapped', vs.enSwappedSpeech, vs.accuseTargetId, vs.trustTargetId, 3);

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `zh/en vote=${zh.voteTargetId}/${en.voteTargetId}; swapped=${zhSwapped.voteTargetId}/${enSwapped.voteTargetId}`,
    details: { zh, en, zhSwapped, enSwapped },
  };
};

const runCaseP3 = (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): PairedCaseResult => {
  const vs = def.visibleState as {
    round: number;
    speakerId: number;
    listenerId: number;
    targetA: number;
    targetB: number;
    affirmativeA: string;
    negationA: string;
    affirmativeB: string;
    quotationRebuttalB: string;
    hypotheticalGoodA: string;
    hypotheticalAccuseA: string;
  };
  const failures: string[] = [];
  const players = buildPlayers(templates);
  const listener = players.find(p => p.id === vs.listenerId)!;

  const evalSpeech = (label: string, speech: string, targetId: number, seedOffset: number) => {
    const tracker = new BeliefTracker();
    tracker.init(players);
    tracker.updateFromSpeech(vs.speakerId, speech, players, {
      round: vs.round,
      eventId: `p3-${label}`,
    });
    const sus = round6(tracker.getSuspicion(vs.listenerId, targetId));
    const vote = selectAction(listener, players, tracker, 'VOTE', vs.round, [], def.actionAccuracy, {
      rng: createSeededRng(def.seed + seedOffset),
      phase: GamePhase.DAY_VOTING,
    });
    recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: vote });
    return { sus, voteTargetId: vote.targetId };
  };

  const affA = evalSpeech('aff-a', vs.affirmativeA, vs.targetA, 0);
  const negA = evalSpeech('neg-a', vs.negationA, vs.targetA, 1);
  const affB = evalSpeech('aff-b', vs.affirmativeB, vs.targetB, 2);
  const quoteB = evalSpeech('quote-b', vs.quotationRebuttalB, vs.targetB, 3);
  const hypGoodA = evalSpeech('hyp-good-a', vs.hypotheticalGoodA, vs.targetA, 4);
  const hypAccuseA = evalSpeech('hyp-accuse-a', vs.hypotheticalAccuseA, vs.targetA, 5);

  if (!(affA.sus > 0.5 && affA.voteTargetId === vs.targetA)) {
    failures.push(`affirmativeA failed: sus=${affA.sus}, vote=${affA.voteTargetId}`);
  }
  if (!(negA.sus <= 0.5 && negA.voteTargetId !== vs.targetA)) {
    failures.push(`negationA rose suspicion or voted target: sus=${negA.sus}, vote=${negA.voteTargetId}`);
  }
  if (!(affB.sus > 0.5 && affB.voteTargetId === vs.targetB)) {
    failures.push(`affirmativeB failed: sus=${affB.sus}, vote=${affB.voteTargetId}`);
  }
  if (!(quoteB.sus <= 0.5 && quoteB.voteTargetId !== vs.targetB)) {
    failures.push(`quotationRebuttalB rose suspicion or voted target: sus=${quoteB.sus}, vote=${quoteB.voteTargetId}`);
  }
  if (hypGoodA.sus !== 0.5) {
    failures.push(`hypotheticalGoodA mutated suspicion to ${hypGoodA.sus} (expected 0.5)`);
  }
  if (hypAccuseA.sus !== 0.5) {
    failures.push(`hypotheticalAccuseA mutated suspicion to ${hypAccuseA.sus} (expected 0.5)`);
  }

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `neg=${negA.sus} vs aff=${affA.sus}; quote=${quoteB.sus} vs aff=${affB.sus}; hyp=${hypGoodA.sus}/${hypAccuseA.sus}`,
    details: { affA, negA, affB, quoteB, hypGoodA, hypAccuseA },
  };
};

const runCaseP4 = (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): PairedCaseResult => {
  const vs = def.visibleState as {
    round: number;
    listenerId: number;
    independentTargetId: number;
    spamTargetId: number;
    independentSpeeches: Array<{ speakerId: number; eventId: string; text: string }>;
    baseSpamSpeech: { speakerId: number; eventId: string; text: string };
    sameEventIdReplays: number;
    paraphraseSpamSpeeches: string[];
  };
  const failures: string[] = [];
  const players = buildPlayers(templates);
  const listener = players.find(p => p.id === vs.listenerId)!;

  const setupBase = () => {
    const tracker = new BeliefTracker();
    tracker.init(players);
    for (const sp of vs.independentSpeeches) {
      tracker.updateFromSpeech(sp.speakerId, sp.text, players, {
        round: vs.round,
        eventId: sp.eventId,
      });
    }
    tracker.updateFromSpeech(vs.baseSpamSpeech.speakerId, vs.baseSpamSpeech.text, players, {
      round: vs.round,
      eventId: vs.baseSpamSpeech.eventId,
    });
    return tracker;
  };

  // Branch A: single clean pass
  const trackerSingle = setupBase();
  const singleSpamSus = round6(trackerSingle.getSuspicion(vs.listenerId, vs.spamTargetId));
  const singleIndSus = round6(trackerSingle.getSuspicion(vs.listenerId, vs.independentTargetId));
  const voteSingle = selectAction(listener, players, trackerSingle, 'VOTE', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: voteSingle });

  // Branch B: replay same eventId N times + same-round paraphrases
  const trackerSpam = setupBase();
  for (let i = 0; i < vs.sameEventIdReplays; i += 1) {
    trackerSpam.updateFromSpeech(vs.baseSpamSpeech.speakerId, vs.baseSpamSpeech.text, players, {
      round: vs.round,
      eventId: vs.baseSpamSpeech.eventId,
    });
  }
  vs.paraphraseSpamSpeeches.forEach((text, index) => {
    trackerSpam.updateFromSpeech(vs.baseSpamSpeech.speakerId, text, players, {
      round: vs.round,
      eventId: `p4-paraphrase-${index}`,
    });
  });

  const spamSus = round6(trackerSpam.getSuspicion(vs.listenerId, vs.spamTargetId));
  const spamIndSus = round6(trackerSpam.getSuspicion(vs.listenerId, vs.independentTargetId));
  const voteSpam = selectAction(listener, players, trackerSpam, 'VOTE', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: listener, players, actionType: 'VOTE', round: vs.round, decision: voteSpam });

  if (spamSus !== singleSpamSus) {
    failures.push(`duplicate/paraphrase spam shifted suspicion from ${singleSpamSus} to ${spamSus}`);
  }
  if (!(spamIndSus > spamSus)) {
    failures.push(`independent target sus ${spamIndSus} did not stay above spammed target ${spamSus}`);
  }
  if (voteSingle.targetId !== vs.independentTargetId || voteSpam.targetId !== vs.independentTargetId) {
    failures.push(`votes did not target independent suspect ${vs.independentTargetId}: single=${voteSingle.targetId}, spam=${voteSpam.targetId}`);
  }

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `spamSus=${spamSus} (exact match ${singleSpamSus}) < independentSus=${spamIndSus}; vote=${voteSpam.targetId}`,
    details: {
      singleSpamSus,
      spamSus,
      independentSus: spamIndSus,
      voteSingle: voteSingle.targetId,
      voteSpam: voteSpam.targetId,
    },
  };
};

const runCaseP5 = (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): PairedCaseResult => {
  const vs = def.visibleState as {
    round: number;
    actorId: number;
    trials: number;
    expectedCandidateCount: number;
    maxSeatShare: number;
    maxUniformDeviation: number;
  };
  const failures: string[] = [];

  const runPermutation = (orderedTemplates: readonly PairedSeatTemplate[]) => {
    const players = buildPlayers(orderedTemplates);
    const actor = players.find(p => p.id === vs.actorId)!;
    const tracker = new BeliefTracker();
    tracker.init(players);
    const rng = createSeededRng(def.seed);
    const counts: Record<number, number> = {};
    let allTieBroken = true;

    for (let i = 0; i < vs.trials; i += 1) {
      const decision = selectAction(actor, players, tracker, 'VOTE', vs.round, [], def.actionAccuracy, {
        rng,
        phase: GamePhase.DAY_VOTING,
      });
      recordDecision(collector, { actor, players, actionType: 'VOTE', round: vs.round, decision });
      if (!decision.tieBroken) allTieBroken = false;
      if (decision.targetId !== null) {
        counts[decision.targetId] = (counts[decision.targetId] ?? 0) + 1;
      }
    }

    const expectedShare = 1 / vs.expectedCandidateCount;
    const shares = Object.values(counts).map(c => c / vs.trials);
    const maxShare = Math.max(...shares);
    const maxDeviation = Math.max(...shares.map(s => Math.abs(s - expectedShare)));
    const tvd = 0.5 * Object.values(counts).reduce((sum, c) => sum + Math.abs(c / vs.trials - expectedShare), 0);
    const seat1Share = round6((counts[1] ?? 0) / vs.trials);

    return {
      counts,
      coveredSeats: Object.keys(counts).length,
      allTieBroken,
      seat1Share,
      maxShare: round6(maxShare),
      maxDeviation: round6(maxDeviation),
      uniformity: round6(Math.max(0, 1 - tvd)),
    };
  };

  const asc = runPermutation(templates);
  const desc = runPermutation([...templates].reverse());

  collector.tieBreakUniformity = round6((asc.uniformity + desc.uniformity) / 2);

  for (const [label, res] of [['asc', asc], ['desc', desc]] as const) {
    if (!res.allTieBroken) failures.push(`${label}: not every tied trial set tieBroken=true`);
    if (res.coveredSeats !== vs.expectedCandidateCount) {
      failures.push(`${label}: covered ${res.coveredSeats}/${vs.expectedCandidateCount} tied seats`);
    }
    if (res.maxShare > vs.maxSeatShare) {
      failures.push(`${label}: max seat share ${res.maxShare} exceeded ${vs.maxSeatShare}`);
    }
    if (res.maxDeviation > vs.maxUniformDeviation) {
      failures.push(`${label}: max uniform deviation ${res.maxDeviation} exceeded ${vs.maxUniformDeviation}`);
    }
  }
  if (Math.abs(asc.seat1Share - desc.seat1Share) > vs.maxUniformDeviation) {
    failures.push(`Seat-1 share drifted across permutations: asc=${asc.seat1Share}, desc=${desc.seat1Share}`);
  }

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `asc/desc covered=${asc.coveredSeats}/${desc.coveredSeats}, seat1=${asc.seat1Share}/${desc.seat1Share}, uniformity=${collector.tieBreakUniformity}`,
    details: { asc, desc, uniformity: collector.tieBreakUniformity },
  };
};

const runCaseP6 = async (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): Promise<PairedCaseResult> => {
  const vs = def.visibleState as {
    round: number;
    witchId: number;
    wolfKillId: number;
    revealedSeatId: number;
    highSuspectTargetId: number;
    mildSpeeches: Array<{ speakerId: number; round: number; eventId: string; text: string }>;
    highSuspicionSpeeches: Array<{ speakerId: number; round: number; eventId: string; text: string }>;
  };
  const failures: string[] = [];
  const players = buildPlayers(templates, {
    [vs.revealedSeatId]: { isRevealed: true },
  });
  const witch = players.find(p => p.id === vs.witchId)!;
  const excluded = new Set([vs.wolfKillId]);

  let holdDecision: ActionDecision;
  let poisonDecision: ActionDecision;
  let night1SelfSave: ActionDecision;
  let night2SelfSaveHold: ActionDecision;
  let mildMaxSus = 0;
  let highTargetSus = 0;

  try {
    setAIDifficulty(def.actionAccuracy);

    // Branch A: Mild suspicion (<= 0.70) -> active HOLD, zero fallback
    globalBeliefTracker.init(players);
    for (const sp of vs.mildSpeeches) {
      globalBeliefTracker.updateFromSpeech(sp.speakerId, sp.text, players, {
        round: sp.round,
        eventId: sp.eventId,
      });
    }
    mildMaxSus = round6(globalBeliefTracker.getSuspicion(vs.witchId, vs.highSuspectTargetId));
    holdDecision = await generateAIAction(witch, players, [], 'POISON', [], vs.round, {
      rng: createSeededRng(def.seed),
      excludedTargetIds: excluded,
      phase: GamePhase.NIGHT_WITCH,
    });
    recordDecision(collector, {
      actor: witch,
      players,
      actionType: 'POISON',
      round: vs.round,
      decision: holdDecision,
      excludedTargetIds: excluded,
    });

    // Branch B: High suspicion (> 0.70) -> ACT on target excluding wolfKillId & isRevealed
    globalBeliefTracker.init(players);
    for (const sp of vs.highSuspicionSpeeches) {
      globalBeliefTracker.updateFromSpeech(sp.speakerId, sp.text, players, {
        round: sp.round,
        eventId: sp.eventId,
      });
    }
    highTargetSus = round6(globalBeliefTracker.getSuspicion(vs.witchId, vs.highSuspectTargetId));
    poisonDecision = await generateAIAction(witch, players, [], 'POISON', [], vs.round, {
      rng: createSeededRng(def.seed + 1),
      excludedTargetIds: excluded,
      phase: GamePhase.NIGHT_WITCH,
    });
    recordDecision(collector, {
      actor: witch,
      players,
      actionType: 'POISON',
      round: vs.round,
      decision: poisonDecision,
      excludedTargetIds: excluded,
    });

    // Witch SAVE Night 1 self-save ACT vs Night 2 self-save HOLD
    globalBeliefTracker.init(players);
    night1SelfSave = await generateAIAction(witch, players, [], 'SAVE', [], 1, {
      rng: createSeededRng(def.seed + 2),
      wolfKillId: vs.witchId,
      hasSave: true,
      phase: GamePhase.NIGHT_WITCH,
    });
    recordDecision(collector, {
      actor: witch,
      players,
      actionType: 'SAVE',
      round: 1,
      decision: night1SelfSave,
      wolfKillId: vs.witchId,
      hasSave: true,
    });

    night2SelfSaveHold = await generateAIAction(witch, players, [], 'SAVE', [], 2, {
      rng: createSeededRng(def.seed + 3),
      wolfKillId: vs.witchId,
      hasSave: true,
      phase: GamePhase.NIGHT_WITCH,
    });
    recordDecision(collector, {
      actor: witch,
      players,
      actionType: 'SAVE',
      round: 2,
      decision: night2SelfSaveHold,
      wolfKillId: vs.witchId,
      hasSave: true,
    });
  } finally {
    globalBeliefTracker.reset();
    setAIDifficulty(0.85);
  }

  if (!(mildMaxSus <= 0.7)) failures.push(`mild suspicion ${mildMaxSus} unexpectedly > 0.70`);
  if (holdDecision.outcome !== 'HOLD' || holdDecision.targetId !== null || holdDecision.trace?.fallback) {
    failures.push(`low-suspicion poison did not cleanly HOLD: outcome=${holdDecision.outcome}, target=${holdDecision.targetId}, fallback=${holdDecision.trace?.fallback}`);
  }
  if (!(highTargetSus > 0.7)) failures.push(`high suspicion ${highTargetSus} did not exceed 0.70`);
  if (poisonDecision.outcome !== 'ACT' || poisonDecision.targetId !== vs.highSuspectTargetId) {
    failures.push(`high-suspicion poison picked outcome=${poisonDecision.outcome}, target=${poisonDecision.targetId}, expected ACT on ${vs.highSuspectTargetId}`);
  }
  if (poisonDecision.targetId === vs.wolfKillId || poisonDecision.targetId === vs.revealedSeatId) {
    failures.push(`poison targeted excluded wolfKillId (${vs.wolfKillId}) or revealed seat (${vs.revealedSeatId})`);
  }
  if (night1SelfSave.outcome !== 'ACT' || night1SelfSave.targetId !== vs.witchId) {
    failures.push(`Night 1 self-save failed: outcome=${night1SelfSave.outcome}, target=${night1SelfSave.targetId}`);
  }
  if (night2SelfSaveHold.outcome !== 'HOLD' || night2SelfSaveHold.targetId !== null) {
    failures.push(`Night 2 self-save did not HOLD: outcome=${night2SelfSaveHold.outcome}, target=${night2SelfSaveHold.targetId}`);
  }

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `poison HOLD(${mildMaxSus})->ACT(${poisonDecision.targetId} @ ${highTargetSus}); save N1=${night1SelfSave.outcome}/N2=${night2SelfSaveHold.outcome}`,
    details: {
      mildMaxSus,
      holdOutcome: holdDecision.outcome,
      holdTargetId: holdDecision.targetId,
      highTargetSus,
      poisonOutcome: poisonDecision.outcome,
      poisonTargetId: poisonDecision.targetId,
      night1SelfSave: night1SelfSave.targetId,
      night2SelfSaveHold: night2SelfSaveHold.outcome,
    },
  };
};

const runCaseP7 = (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): PairedCaseResult => {
  const vs = def.visibleState as {
    seerId: number;
    observerId: number;
    primaryTargetId: number;
    secondaryTargetId: number;
    publicDefenseOnWolf: string;
  };
  const failures: string[] = [];
  const players = buildPlayers(templates);
  const seer = players.find(p => p.id === vs.seerId)!;

  // Branch A: Night 1 checks primaryTargetId as WOLF (1.0) -> Night 2 excludes primaryTargetId
  const trackerWolf = new BeliefTracker();
  trackerWolf.init(players);
  const checkN1 = selectAction(seer, players, trackerWolf, 'CHECK', 1, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed),
    phase: GamePhase.NIGHT_SEER,
  });
  recordDecision(collector, {
    actor: seer,
    players,
    actionType: 'CHECK',
    round: 1,
    decision: checkN1,
    checkedTargetIds: new Set(),
  });

  trackerWolf.recordSeerCheck(vs.seerId, vs.primaryTargetId, false, {
    round: 1,
    eventId: 'p7-check-wolf',
  });
  const checkedAfterN1 = new Set(trackerWolf.getCheckedTargets(vs.seerId));
  const seerSusWolf = round6(trackerWolf.getSuspicion(vs.seerId, vs.primaryTargetId));
  const observerSusWolf = round6(trackerWolf.getSuspicion(vs.observerId, vs.primaryTargetId));

  // Public defense must not overwrite Seer's hard wolf check
  trackerWolf.updateFromSpeech(vs.observerId, vs.publicDefenseOnWolf, players, {
    round: 1,
    eventId: 'p7-defense-on-wolf',
  });
  const seerSusWolfAfterDefense = round6(trackerWolf.getSuspicion(vs.seerId, vs.primaryTargetId));

  const voteWolf = selectAction(seer, players, trackerWolf, 'VOTE', 1, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed + 1),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: seer, players, actionType: 'VOTE', round: 1, decision: voteWolf });

  const checkN2 = selectAction(seer, players, trackerWolf, 'CHECK', 2, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed + 2),
    phase: GamePhase.NIGHT_SEER,
  });
  recordDecision(collector, {
    actor: seer,
    players,
    actionType: 'CHECK',
    round: 2,
    decision: checkN2,
    checkedTargetIds: checkedAfterN1,
  });

  // Record Night 2 check on secondaryTargetId as GOOD (0.0) -> Night 3 excludes both
  trackerWolf.recordSeerCheck(vs.seerId, vs.secondaryTargetId, true, {
    round: 2,
    eventId: 'p7-check-good-n2',
  });
  const checkedAfterN2 = new Set(trackerWolf.getCheckedTargets(vs.seerId));
  const seerSusSecondaryGood = round6(trackerWolf.getSuspicion(vs.seerId, vs.secondaryTargetId));
  const checkN3 = selectAction(seer, players, trackerWolf, 'CHECK', 3, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed + 3),
    phase: GamePhase.NIGHT_SEER,
  });
  recordDecision(collector, {
    actor: seer,
    players,
    actionType: 'CHECK',
    round: 3,
    decision: checkN3,
    checkedTargetIds: checkedAfterN2,
  });

  // Check privacy isolation for observer on seer-check events
  for (const p of players) {
    if (p.id === vs.seerId) continue;
    collector.privacyProbes += 1;
    const leaked = (trackerWolf.getSeatMemory(p.id)?.visibleEvents ?? []).some(e => e.kind === 'seer-check');
    if (leaked) {
      collector.unauthorizedReads += 1;
      failures.push(`seat ${p.id} unexpectedly saw private seer-check event`);
    }
  }

  // Branch B (paired counterfactual): Night 1 checks primaryTargetId as GOOD (0.0) -> VOTE flips away
  const trackerGood = new BeliefTracker();
  trackerGood.init(players);
  trackerGood.recordSeerCheck(vs.seerId, vs.primaryTargetId, true, {
    round: 1,
    eventId: 'p7-check-good',
  });
  const seerSusGood = round6(trackerGood.getSuspicion(vs.seerId, vs.primaryTargetId));
  const observerSusGood = round6(trackerGood.getSuspicion(vs.observerId, vs.primaryTargetId));
  const voteGood = selectAction(seer, players, trackerGood, 'VOTE', 1, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed + 1),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: seer, players, actionType: 'VOTE', round: 1, decision: voteGood });

  if (seerSusWolf !== 1.0 || seerSusWolfAfterDefense !== 1.0) {
    failures.push(`Seer wolf check did not stay polarized at 1.0: before=${seerSusWolf}, afterDefense=${seerSusWolfAfterDefense}`);
  }
  if (seerSusGood !== 0.0 || seerSusSecondaryGood !== 0.0) {
    failures.push(`Seer good check did not polarize to 0.0: primary=${seerSusGood}, secondary=${seerSusSecondaryGood}`);
  }
  if (observerSusWolf !== 0.5 || observerSusGood !== 0.5) {
    failures.push(`Observer suspicion leaked private Seer check: wolf=${observerSusWolf}, good=${observerSusGood}`);
  }
  if (voteWolf.targetId !== vs.primaryTargetId) {
    failures.push(`Seer wolf-check vote picked ${voteWolf.targetId}, expected ${vs.primaryTargetId}`);
  }
  if (voteGood.targetId === vs.primaryTargetId) {
    failures.push(`Seer good-check vote failed to avoid verified good seat ${vs.primaryTargetId}`);
  }
  if (checkN2.targetId === vs.primaryTargetId) {
    failures.push(`Night 2 CHECK re-checked already verified seat ${vs.primaryTargetId}`);
  }
  if (checkN3.targetId === vs.primaryTargetId || checkN3.targetId === vs.secondaryTargetId) {
    failures.push(`Night 3 CHECK re-checked already verified seat ${checkN3.targetId}`);
  }

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `polar=${seerSusWolf}/${seerSusGood}, obs=${observerSusWolf}/${observerSusGood}, checks=N2:${checkN2.targetId}/N3:${checkN3.targetId}, vote=${voteWolf.targetId}->${voteGood.targetId}`,
    details: {
      seerSusWolf,
      seerSusWolfAfterDefense,
      seerSusGood,
      observerSusWolf,
      observerSusGood,
      voteWolf: voteWolf.targetId,
      voteGood: voteGood.targetId,
      checkN2: checkN2.targetId,
      checkN3: checkN3.targetId,
    },
  };
};

const runCaseP8 = (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): PairedCaseResult => {
  const vs = def.visibleState as {
    round: number;
    wolfActorId: number;
    teammateId: number;
    otherTeammateId: number;
    seerClaimerId: number;
    villagerPushId: number;
    bussingSpeeches: Array<{ round: number; eventId: string; text: string }>;
    normalVillagePushSpeech: { speakerId: number; round: number; eventId: string; text: string };
    publicSeerClaimSpeech: { speakerId: number; round: number; eventId: string; text: string };
    doomedPileSpeakers: number[];
    doomedPileText: string;
    doomedBussingSpeech: string;
  };
  const failures: string[] = [];
  const players = buildPlayers(templates);
  const wolfActor = players.find(p => p.id === vs.wolfActorId)!;
  const wolfTeamIds = new Set([vs.wolfActorId, vs.teammateId, vs.otherTeammateId]);

  // Branch A: Repeated public bussing on non-doomed teammate
  const trackerNormal = new BeliefTracker();
  trackerNormal.init(players);
  for (const sp of vs.bussingSpeeches) {
    trackerNormal.updateFromSpeech(vs.wolfActorId, sp.text, players, {
      round: sp.round,
      eventId: sp.eventId,
    });
  }
  trackerNormal.updateFromSpeech(
    vs.normalVillagePushSpeech.speakerId,
    vs.normalVillagePushSpeech.text,
    players,
    { round: vs.normalVillagePushSpeech.round, eventId: vs.normalVillagePushSpeech.eventId },
  );
  trackerNormal.updateFromSpeech(
    vs.publicSeerClaimSpeech.speakerId,
    vs.publicSeerClaimSpeech.text,
    players,
    { round: vs.publicSeerClaimSpeech.round, eventId: vs.publicSeerClaimSpeech.eventId },
  );

  const actorOnTmNormal = round6(trackerNormal.getSuspicion(vs.wolfActorId, vs.teammateId));
  const tmOnActorNormal = round6(trackerNormal.getSuspicion(vs.teammateId, vs.wolfActorId));
  const otherOnTmNormal = round6(trackerNormal.getSuspicion(vs.otherTeammateId, vs.teammateId));

  const normalVote = selectAction(wolfActor, players, trackerNormal, 'VOTE', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: wolfActor, players, actionType: 'VOTE', round: vs.round, decision: normalVote });

  const nightKill = selectAction(wolfActor, players, trackerNormal, 'KILL', vs.round + 1, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed + 1),
    phase: GamePhase.NIGHT_WEREWOLVES,
  });
  recordDecision(collector, { actor: wolfActor, players, actionType: 'KILL', round: vs.round + 1, decision: nightKill });

  // Branch B: Doomed-teammate bussing under overwhelming village heat
  const trackerDoomed = new BeliefTracker();
  trackerDoomed.init(players);
  for (const speakerId of vs.doomedPileSpeakers) {
    trackerDoomed.updateFromSpeech(speakerId, vs.doomedPileText, players, {
      round: vs.round,
      eventId: `p8-pile-${speakerId}`,
    });
  }
  trackerDoomed.updateFromSpeech(vs.wolfActorId, vs.doomedBussingSpeech, players, {
    round: vs.round,
    eventId: 'p8-doomed-bus',
  });

  const actorOnTmDoomed = round6(trackerDoomed.getSuspicion(vs.wolfActorId, vs.teammateId));
  const doomedVote = selectAction(wolfActor, players, trackerDoomed, 'VOTE', vs.round, [], def.actionAccuracy, {
    rng: createSeededRng(def.seed),
    phase: GamePhase.DAY_VOTING,
  });
  recordDecision(collector, { actor: wolfActor, players, actionType: 'VOTE', round: vs.round, decision: doomedVote });

  if (actorOnTmNormal > WOLF_TEAMMATE_SUSPICION || tmOnActorNormal > WOLF_TEAMMATE_SUSPICION || otherOnTmNormal > WOLF_TEAMMATE_SUSPICION) {
    failures.push(`teammate suspicion exceeded ${WOLF_TEAMMATE_SUSPICION}: ${actorOnTmNormal}/${tmOnActorNormal}/${otherOnTmNormal}`);
  }
  if (normalVote.targetId === null || wolfTeamIds.has(normalVote.targetId)) {
    failures.push(`normal wolf vote targeted teammate ${normalVote.targetId}`);
  }
  if (nightKill.targetId !== vs.seerClaimerId || wolfTeamIds.has(nightKill.targetId)) {
    failures.push(`wolf night kill picked ${nightKill.targetId}, expected public Seer claimer ${vs.seerClaimerId}`);
  }
  if (actorOnTmDoomed > WOLF_TEAMMATE_SUSPICION) {
    failures.push(`doomed-teammate bussing raised internal suspicion to ${actorOnTmDoomed}`);
  }
  if (doomedVote.targetId !== vs.teammateId || !doomedVote.reason.includes('倒钩')) {
    failures.push(`doomed-teammate vote did not trigger 倒钩 on ${vs.teammateId}: target=${doomedVote.targetId}, reason=${doomedVote.reason}`);
  }

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `tmSus=${actorOnTmNormal}/${actorOnTmDoomed}; vote normal=${normalVote.targetId}->doomed=${doomedVote.targetId}(倒钩); kill=${nightKill.targetId}`,
    details: {
      actorOnTmNormal,
      tmOnActorNormal,
      otherOnTmNormal,
      actorOnTmDoomed,
      normalVote: normalVote.targetId,
      doomedVote: doomedVote.targetId,
      doomedReason: doomedVote.reason,
      nightKill: nightKill.targetId,
    },
  };
};

interface LeakageProbe {
  id: string;
  lang: 'zh' | 'en' | 'ja';
  role: Role;
  speech: string;
  expectLeak: boolean;
  expectLegacyLeak: boolean;
}

const runCaseP9 = (
  def: PairedCaseDefinition,
  templates: readonly PairedSeatTemplate[],
  collector: MetricsCollector,
): PairedCaseResult => {
  const vs = def.visibleState as {
    round: number;
    seerId: number;
    witchId: number;
    wolfActorId: number;
    observerId: number;
    checkedTargetId: number;
    savedTargetId: number;
    wolfPlanText: string;
    leakageProbes: LeakageProbe[];
  };
  const failures: string[] = [];
  const players = buildPlayers(templates);

  // Part A: Private-info visibility isolation
  const tracker = new BeliefTracker();
  tracker.init(players);
  tracker.recordSeerCheck(vs.seerId, vs.checkedTargetId, false, {
    round: vs.round,
    eventId: 'p9-private-seer',
  });
  tracker.recordWitchInfo(
    vs.witchId,
    { wolfKillId: vs.savedTargetId, saved: true },
    { round: vs.round, eventId: 'p9-private-witch' },
  );
  const wolfPlanEvent: VisibleEvent = {
    eventId: 'p9-private-wolf-plan',
    seq: 999,
    round: vs.round,
    phase: GamePhase.NIGHT_WEREWOLVES,
    visibility: 'wolf-team',
    kind: 'wolf-plan',
    actorId: vs.wolfActorId,
    payload: { message: vs.wolfPlanText, targetId: vs.seerId },
  };
  tracker.ingestEvent(wolfPlanEvent, players);

  for (const player of players) {
    const seatMem = tracker.getSeatMemory(player.id)!;
    const events = seatMem.visibleEvents;

    // Seer-private probe
    if (player.id !== vs.seerId) {
      collector.privacyProbes += 1;
      if (events.some(e => e.eventId === 'p9-private-seer')) {
        collector.unauthorizedReads += 1;
        failures.push(`seat ${player.id} read private seer-check`);
      }
    }
    // Witch-private probe
    if (player.id !== vs.witchId) {
      collector.privacyProbes += 1;
      if (events.some(e => e.eventId === 'p9-private-witch')) {
        collector.unauthorizedReads += 1;
        failures.push(`seat ${player.id} read private witch-info`);
      }
    }
    // Wolf-team probe
    if (player.role !== Role.WEREWOLF) {
      collector.privacyProbes += 1;
      if (events.some(e => e.eventId === 'p9-private-wolf-plan') || canSeatRead(seatMem, wolfPlanEvent)) {
        collector.unauthorizedReads += 1;
        failures.push(`non-wolf seat ${player.id} read wolf-team plan`);
      }
    }
  }

  // Verify Witch silver-water belief updated privately for Witch only
  const witchSavedSus = round6(tracker.getSuspicion(vs.witchId, vs.savedTargetId));
  const observerSavedSus = round6(tracker.getSuspicion(vs.observerId, vs.savedTargetId));
  if (!(witchSavedSus < 0.5)) {
    failures.push(`Witch silver-water suspicion did not drop: ${witchSavedSus}`);
  }
  if (observerSavedSus !== 0.5) {
    failures.push(`Observer suspicion leaked Witch silver-water: ${observerSavedSus}`);
  }

  // Part B: Multilingual leakage detection (zh + en + ja) & legacy compatibility
  const probeResults: Array<{ id: string; lang: string; multilingualRules: string[]; legacyRules: string[] }> = [];
  for (const probe of vs.leakageProbes) {
    const actor = players.find(p => p.role === probe.role)!;
    const multi = detectInfoLeakage(actor, probe.speech, { multilingual: true });
    const legacy = detectInfoLeakage(actor, probe.speech);
    probeResults.push({ id: probe.id, lang: probe.lang, multilingualRules: multi, legacyRules: legacy });

    const multiDetected = multi.length > 0;
    const legacyDetected = legacy.length > 0;
    if (multiDetected !== probe.expectLeak) {
      failures.push(`multilingual leakage mismatch on ${probe.id}: expected=${probe.expectLeak}, got=${JSON.stringify(multi)}`);
    }
    if (legacyDetected !== probe.expectLegacyLeak) {
      failures.push(`legacy leakage mismatch on ${probe.id}: expected=${probe.expectLegacyLeak}, got=${JSON.stringify(legacy)}`);
    }
  }

  return {
    id: def.id,
    title: def.title,
    category: def.category,
    evidenceSwap: def.evidenceSwap,
    seed: def.seed,
    passed: failures.length === 0,
    failures,
    summary: `privacy unauthorized=${collector.unauthorizedReads}/${collector.privacyProbes}; leakage probes=${vs.leakageProbes.length}/${vs.leakageProbes.length}`,
    details: {
      witchSavedSus,
      observerSavedSus,
      probeCount: probeResults.length,
      probeResults,
    },
  };
};

// ─── Public Benchmark API ───────────────────────────────────────────────────

/** Run all 9 deterministic paired-evidence cases (P1–P9) and aggregate non-winrate metrics. */
export const runPairedBenchmark = async (
  dataset: PairedCasesDataset = loadPairedCases(),
): Promise<PairedBenchmarkReport> => {
  const collector = createMetricsCollector();
  const results: PairedCaseResult[] = [];

  for (const def of dataset.cases) {
    const templates = dataset.boardTemplates[def.boardId];
    if (!templates) {
      throw new Error(`Paired case ${def.id} references unknown board template "${def.boardId}"`);
    }

    switch (def.id) {
      case 'P1':
        results.push(await runCaseP1(def, templates, collector));
        break;
      case 'P2':
        results.push(runCaseP2(def, templates, collector));
        break;
      case 'P3':
        results.push(runCaseP3(def, templates, collector));
        break;
      case 'P4':
        results.push(runCaseP4(def, templates, collector));
        break;
      case 'P5':
        results.push(runCaseP5(def, templates, collector));
        break;
      case 'P6':
        results.push(await runCaseP6(def, templates, collector));
        break;
      case 'P7':
        results.push(runCaseP7(def, templates, collector));
        break;
      case 'P8':
        results.push(runCaseP8(def, templates, collector));
        break;
      case 'P9':
        results.push(runCaseP9(def, templates, collector));
        break;
    }
  }

  const casesPassed = results.filter(r => r.passed).length;
  const casesTotal = results.length;
  const evidenceSwapCases = results.filter(r => r.evidenceSwap);
  const evidenceSwapPassed = evidenceSwapCases.filter(r => r.passed).length;
  const sortedLatencies = [...collector.latenciesMs].sort((a, b) => a - b);

  const summary: PairedBenchmarkSummary = {
    datasetVersion: dataset.datasetVersion,
    casesPassed,
    casesTotal,
    evidenceSensitivityRate: round6(
      evidenceSwapCases.length === 0 ? 1 : evidenceSwapPassed / evidenceSwapCases.length,
    ),
    roleActionDistribution: collector.roleActionDistribution,
    tieBreakUniformity: collector.tieBreakUniformity,
    tieBreakRate: round6(
      collector.totalDecisions === 0 ? 0 : collector.tieBrokenCount / collector.totalDecisions,
    ),
    fallbackRate: round6(
      collector.totalDecisions === 0 ? 0 : collector.fallbackCount / collector.totalDecisions,
    ),
    illegalActionRate: round6(
      collector.totalDecisions === 0 ? 0 : collector.illegalActionCount / collector.totalDecisions,
    ),
    unauthorizedInfoReadRate: round6(
      collector.privacyProbes === 0 ? 0 : collector.unauthorizedReads / collector.privacyProbes,
    ),
    decisionLatencyMs: {
      p50: computePercentile(sortedLatencies, 0.5),
      p95: computePercentile(sortedLatencies, 0.95),
      max: computePercentile(sortedLatencies, 1.0),
    },
  };

  return { summary, cases: results };
};

/**
 * Run a replay through `evaluation.ts` with opt-in counterfactual selector
 * comparison and multilingual leakage auditing enabled.
 */
export const runCounterfactualPolicyComparison = (
  input: ReplayInput,
): CounterfactualPolicySummary => {
  const report = runReplay({
    ...input,
    multilingualLeakage: input.multilingualLeakage ?? true,
    trackCounterfactualSelector: true,
  });
  const comparisons = report.counterfactualComparisons ?? [];
  const totalActions = comparisons.length;
  const divergedCount = comparisons.filter(c => c.diverged).length;
  const agreedCount = totalActions - divergedCount;

  return {
    gameId: report.gameId,
    totalActions,
    agreedCount,
    divergedCount,
    agreementRate: round6(totalActions === 0 ? 1 : agreedCount / totalActions),
    divergenceRate: round6(totalActions === 0 ? 0 : divergedCount / totalActions),
    multilingualLeakageRate: round6(report.infoLeakageRate),
    leakageFindingCount: report.leakageFindings.length,
    comparisons,
  };
};

/** Strip wall-clock latency jitter so repeated runs can be compared byte-for-byte. */
export const toDeterministicPairedReport = (
  report: PairedBenchmarkReport,
): DeterministicPairedBenchmarkReport => {
  const { decisionLatencyMs: _omit, ...stableSummary } = report.summary;
  return {
    summary: stableSummary,
    cases: report.cases,
  };
};

export const formatPairedBenchmarkJson = (
  report: PairedBenchmarkReport,
  options: { deterministic?: boolean } = {},
): string => {
  const payload = options.deterministic ? toDeterministicPairedReport(report) : report;
  return `${JSON.stringify(payload, null, 2)}\n`;
};

export const formatPairedBenchmarkMarkdown = (report: PairedBenchmarkReport): string => {
  const { summary, cases } = report;
  const dist = summary.roleActionDistribution;
  const lines: string[] = [
    `# AI Decision Paired Benchmark Report (${summary.datasetVersion})`,
    '',
    '## Summary Metrics',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Paired cases passed | ${summary.casesPassed}/${summary.casesTotal} |`,
    `| Evidence sensitivity rate | ${summary.evidenceSensitivityRate} |`,
    `| Tie-break uniformity | ${summary.tieBreakUniformity} |`,
    `| Tie-break rate | ${summary.tieBreakRate} |`,
    `| Fallback rate | ${summary.fallbackRate} |`,
    `| Illegal action rate | ${summary.illegalActionRate} |`,
    `| Unauthorized info-read rate | ${summary.unauthorizedInfoReadRate} |`,
    `| Decision latency (ms) | p50=${summary.decisionLatencyMs.p50}, p95=${summary.decisionLatencyMs.p95}, max=${summary.decisionLatencyMs.max} |`,
    '',
    '## Role Action Distribution',
    '',
    '| VOTE | KILL | CHECK | POISON | HOLD | SAVE | SHOOT |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${dist.VOTE} | ${dist.KILL} | ${dist.CHECK} | ${dist.POISON} | ${dist.HOLD} | ${dist.SAVE} | ${dist.SHOOT} |`,
    '',
    '## Paired Cases (P1–P9)',
    '',
    '| Case | Status | Seed | Summary |',
    '| --- | --- | ---: | --- |',
    ...cases.map(c => `| ${c.id} | ${c.passed ? 'PASS' : 'FAIL'} | ${c.seed} | ${c.summary} |`),
    '',
  ];
  return lines.join('\n');
};

/** Gate used by `scripts/ai-decision-eval.mjs --check` and Vitest. */
export const checkPairedBenchmarkReport = (
  report: PairedBenchmarkReport,
  secondReport?: PairedBenchmarkReport,
): PairedBenchmarkCheckOutcome => {
  const problems: string[] = [];
  const notes: string[] = [];
  const { summary, cases } = report;

  if (summary.casesTotal !== 9) {
    problems.push(`expected 9 paired cases, got ${summary.casesTotal}`);
  }
  if (summary.casesPassed !== summary.casesTotal) {
    problems.push(`paired cases passed ${summary.casesPassed}/${summary.casesTotal}`);
  }
  if (summary.evidenceSensitivityRate !== 1) {
    problems.push(`evidenceSensitivityRate ${summary.evidenceSensitivityRate} !== 1`);
  }
  if (summary.illegalActionRate !== 0) {
    problems.push(`illegalActionRate ${summary.illegalActionRate} !== 0`);
  }
  if (summary.unauthorizedInfoReadRate !== 0) {
    problems.push(`unauthorizedInfoReadRate ${summary.unauthorizedInfoReadRate} !== 0`);
  }
  if (summary.fallbackRate !== 0) {
    problems.push(`fallbackRate ${summary.fallbackRate} !== 0`);
  }
  if (!(summary.decisionLatencyMs.p50 >= 0 && summary.decisionLatencyMs.p95 >= summary.decisionLatencyMs.p50)) {
    problems.push(`invalid decisionLatencyMs stats: ${JSON.stringify(summary.decisionLatencyMs)}`);
  }

  for (const c of cases) {
    notes.push(`${c.id} (${c.category}): ${c.passed ? 'OK' : 'FAIL'} — ${c.summary}`);
    if (!c.passed) {
      for (const failure of c.failures) {
        problems.push(`${c.id}: ${failure}`);
      }
    }
  }

  if (secondReport) {
    const firstDet = formatPairedBenchmarkJson(report, { deterministic: true });
    const secondDet = formatPairedBenchmarkJson(secondReport, { deterministic: true });
    if (firstDet !== secondDet) {
      problems.push('deterministic paired benchmark output is not byte-stable across two runs');
    }
  }

  return { ok: problems.length === 0, problems, notes };
};

// --- END OF FILE src/ai/pairedBenchmark.ts ---
