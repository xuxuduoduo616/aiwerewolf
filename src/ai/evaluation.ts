// --- START OF FILE src/ai/evaluation.ts ---
//
// Offline evaluation harness for AI role behavior.
//
// A deterministic mock provider plus a local replay runner that plays scripted
// game turns through the REAL BeliefTracker / actionSelector (imported
// read-only) under a given behavior variant. Evaluation only observes — it
// never mutates game rules or engine behavior. Zero network, zero timers,
// no wall-clock dependence: repeated runs on the same fixture yield identical
// reports.

import { GamePhase, Role, type Player, type VoteRecord } from '../types';
import { BeliefTracker } from './beliefTracker';
import { selectAction, type ActionOutcome, type ActionType } from './actionSelector';
import { getRoleBehaviorProfile, type BehaviorVariant, type RoleBehaviorProfile } from '../services/roleProfiles';

// ─── Mock provider ───────────────────────────────────────────────────────────

export interface EvalProviderCall {
  prompt: string;
  response: string;
}

/**
 * Provider abstraction used by the replay runner. In a replay the "LLM output"
 * is the scripted speech, so `complete` receives it and returns the text that
 * is actually spoken. Implementations must be deterministic and offline.
 */
export interface EvalProvider {
  complete(prompt: string, scriptedResponse: string): string;
  readonly calls: ReadonlyArray<EvalProviderCall>;
}

/** Deterministic mock provider: echoes the scripted response and records every call. */
export const createMockProvider = (): EvalProvider => {
  const calls: EvalProviderCall[] = [];
  return {
    calls,
    complete(prompt: string, scriptedResponse: string): string {
      calls.push({ prompt, response: scriptedResponse });
      return scriptedResponse;
    },
  };
};

// ─── Cost estimation ─────────────────────────────────────────────────────────

/** ~4 chars per token — same heuristic as `netlify/functions/model-adapter.js`. */
export const estimateTokens = (text: string): number => Math.ceil((text || '').length / 4);

/** Estimated USD cost for a set of provider calls at a per-1k-token rate. */
export const estimateEvalCostUSD = (
  calls: ReadonlyArray<EvalProviderCall>,
  costPer1kTokens: number,
): number => {
  const tokens = calls.reduce(
    (sum, c) => sum + estimateTokens(c.prompt) + estimateTokens(c.response),
    0,
  );
  return (tokens / 1000) * costPer1kTokens;
};

// ─── Info-leakage detection ──────────────────────────────────────────────────

export interface LeakageRule {
  id: string;
  description: string;
  appliesTo: (actor: Player) => boolean;
  pattern: RegExp;
}

/**
 * Simple keyword/regex rules for role knowledge that must not appear in public
 * speech. A true seer reporting checks is legitimate and is not flagged.
 */
export const LEAKAGE_RULES: ReadonlyArray<LeakageRule> = [
  {
    id: 'wolf-self-reveal',
    description: 'A werewolf openly states they are a wolf.',
    appliesTo: p => p.role === Role.WEREWOLF,
    pattern: /我(就|们)?是狼/,
  },
  {
    id: 'wolf-teammate-reveal',
    description: 'A werewolf refers to wolf teammates in public speech.',
    appliesTo: p => p.role === Role.WEREWOLF,
    pattern: /队友|我们狼/,
  },
  {
    id: 'non-seer-check-claim',
    description: 'A non-seer states seer check results or claims to be the seer.',
    appliesTo: p => p.role !== Role.SEER,
    pattern: /我是预言家|[查验]了\s*\d+\s*号|我的?(金水|查杀)/,
  },
  {
    id: 'witch-potion-reveal',
    description: 'The witch reveals save/poison potion state in public speech.',
    appliesTo: p => p.role === Role.WITCH,
    pattern: /解药|毒药|我(救|毒)了/,
  },
];

export interface InfoLeakageOptions {
  /** When true, evaluate zh + en + ja rules (`MULTILINGUAL_LEAKAGE_RULES`). Default: false (zh-only `LEAKAGE_RULES`). */
  multilingual?: boolean;
}

/**
 * Extended multi-language leakage rules (Chinese + English + Japanese).
 * Opt-in via `detectInfoLeakage(actor, speech, { multilingual: true })` or
 * `ReplayInput.multilingualLeakage` so legacy H2-C golden fixtures stay unchanged.
 */
export const MULTILINGUAL_LEAKAGE_RULES: ReadonlyArray<LeakageRule> = [
  ...LEAKAGE_RULES,
  {
    id: 'wolf-self-reveal-en',
    description: 'A werewolf openly states they are a wolf in English.',
    appliesTo: p => p.role === Role.WEREWOLF,
    pattern: /\b(?:i\s+am|i'm|we\s+are|we're)\s+(?:actually\s+|really\s+)?(?:a\s+|the\s+)?(?:werewolf|werewolves|wolf|wolves)\b/i,
  },
  {
    id: 'wolf-self-reveal-ja',
    description: 'A werewolf openly states they are a wolf in Japanese.',
    appliesTo: p => p.role === Role.WEREWOLF,
    pattern: /(?:(?:私|僕|俺|自分)(?:は|が)?\s*(?:実は)?(?:人狼|狼)(?:です|だ)|(?:^|[。！？\s])(?:実は)?人狼です)/,
  },
  {
    id: 'wolf-teammate-reveal-en',
    description: 'A werewolf refers to wolf teammates or night kill plans in English.',
    appliesTo: p => p.role === Role.WEREWOLF,
    pattern: /\b(?:my\s+(?:wolf\s+)?teammates?|my\s+fellow\s+(?:were)?wol(?:f|ves)|our\s+(?:wolf\s+)?pack|wolf\s+teammates?|night\s+kill\s+plan)\b/i,
  },
  {
    id: 'wolf-teammate-reveal-ja',
    description: 'A werewolf discusses night attack or wolf partners in Japanese.',
    appliesTo: p => p.role === Role.WEREWOLF,
    pattern: /襲撃は|狼仲間|相方(?:の狼|と相談)|夜(?:の襲撃|チャット)/,
  },
  {
    id: 'non-seer-check-claim-en',
    description: 'A non-seer states seer check results or claims to be the seer in English.',
    appliesTo: p => p.role !== Role.SEER,
    pattern: /\b(?:(?:i\s+am|i'm)\s+(?:the\s+|a\s+)?(?:real\s+|true\s+)?seer|i\s+(?:checked|inspected|scanned)\s+(?:player|seat)\s*\d+|my\s+(?:night\s+)?check\s+(?:on|showed|was))\b/i,
  },
  {
    id: 'non-seer-check-claim-ja',
    description: 'A non-seer states seer check results or claims to be the seer in Japanese.',
    appliesTo: p => p.role !== Role.SEER,
    pattern: /(?:(?:私|僕|俺)(?:は|が)(?:本物の|自分が)?占い師|占って|昨夜の(?:私|僕|俺)の占いで)/,
  },
  {
    id: 'witch-potion-reveal-en',
    description: 'The witch reveals save/poison potion state in English.',
    appliesTo: p => p.role === Role.WITCH,
    pattern: /\b(?:my\s+(?:antidote|poison|healing\s+potion|save\s+potion)|i\s+(?:saved|healed|poisoned)\s+(?:player|seat)\s*\d+|i\s+(?:still\s+have|used)\s+(?:my\s+|the\s+)?(?:antidote|poison))\b/i,
  },
  {
    id: 'witch-potion-reveal-ja',
    description: 'The witch reveals save/poison potion state in Japanese.',
    appliesTo: p => p.role === Role.WITCH,
    pattern: /(?:解毒薬|毒薬|私が(?:救った|毒殺した))/,
  },
];

/** Rule ids that a given actor's speech violates. Empty array = clean. */
export const detectInfoLeakage = (
  actor: Player,
  speech: string,
  options?: InfoLeakageOptions,
): string[] => {
  const rules = options?.multilingual ? MULTILINGUAL_LEAKAGE_RULES : LEAKAGE_RULES;
  return rules.filter(r => r.appliesTo(actor) && r.pattern.test(speech)).map(r => r.id);
};

// ─── Scripted replay fixtures ────────────────────────────────────────────────

export type ScriptedTurn =
  | {
      kind: 'speech';
      round: number;
      actorId: number;
      /** Scripted speech text — what the mock provider "generates" this turn. */
      speech: string;
    }
  | {
      kind: 'action';
      round: number;
      actorId: number;
      actionType: ActionType;
      /**
       * Target the (mock) model proposes. `null` means pass — the runner then
       * falls back to the real actionSelector, mirroring the live pipeline.
       */
      proposedTargetId: number | null;
    };

export interface ReplayInput {
  gameId: string;
  players: Player[];
  turns: ScriptedTurn[];
  variant: BehaviorVariant;
  /** Defaults to the deterministic mock provider. */
  provider?: EvalProvider;
  /** Per-1k-token rate for the cost estimator. Mock provider default: 0. */
  costPer1kTokens?: number;
  /** Opt-in: evaluate zh + en + ja leakage rules. Default: false (preserves H2-C golden fixtures). */
  multilingualLeakage?: boolean;
  /** Opt-in: record counterfactual selector vs proposed target divergence per action turn. */
  trackCounterfactualSelector?: boolean;
}

// ─── Report ──────────────────────────────────────────────────────────────────

export interface LeakageFinding {
  round: number;
  actorId: number;
  ruleId: string;
}

export interface IllegalActionRecord {
  round: number;
  actorId: number;
  actionType: ActionType;
  proposedTargetId: number;
}

export interface ResolvedActionRecord {
  round: number;
  actorId: number;
  actionType: ActionType;
  targetId: number | null;
  /** 'proposed' = scripted target accepted; 'selector' = real actionSelector decided. */
  source: 'proposed' | 'selector';
}

export interface CounterfactualComparison {
  round: number;
  actorId: number;
  actionType: ActionType;
  proposedTargetId: number | null;
  selectorTargetId: number | null;
  selectorOutcome: ActionOutcome;
  diverged: boolean;
}

/**
 * Typed evaluation report. Field names/semantics for `illegalActionRate`,
 * `speechRepetitionRate`, and `estimatedCostUSD` match `GameBenchmarkResult`
 * in `benchmark.ts`; `infoLeakageRate` matches its optional field there.
 */
export interface RoleEvaluationReport {
  gameId: string;
  variant: BehaviorVariant;
  speechTurns: number;
  actionTurns: number;
  /** 0–1: fraction of proposed actions rejected by the validity filter. Lower is better. */
  illegalActionRate: number;
  /** 0–1: fraction of speeches leaking hidden role knowledge. Lower is better. */
  infoLeakageRate: number;
  /** 0–1: fraction of repeated/duplicate speeches across turns. Lower is better. */
  speechRepetitionRate: number;
  /** Token heuristic × per-1k cost across all provider calls. Mock provider: 0. */
  estimatedCostUSD: number;
  leakageFindings: LeakageFinding[];
  illegalActions: IllegalActionRecord[];
  resolvedActions: ResolvedActionRecord[];
  /** Populated only when `ReplayInput.trackCounterfactualSelector` is true. */
  counterfactualComparisons?: CounterfactualComparison[];
}

// ─── Replay runner ───────────────────────────────────────────────────────────

/** Validity filter mirroring `generateAIAction` in aiOrchestrator (observer copy). */
const validTargetsFor = (actor: Player, players: Player[], type: ActionType): number[] =>
  players
    .filter(p => {
      if (!p.isAlive || p.id === actor.id) return false;
      if (type === 'KILL') return p.role !== Role.WEREWOLF;
      return true;
    })
    .map(p => p.id);

const buildSpeechPrompt = (
  actor: Player,
  profile: RoleBehaviorProfile,
  round: number,
  players: Player[],
): string => {
  const alive = players.filter(p => p.isAlive).map(p => `${p.id}号`).join('、');
  return `【离线回放】第${round}轮，${actor.id}号发言。行为风格（${profile.variant}）：${profile.speechStyle} 存活：${alive}。`;
};

const normalizeSpeech = (speech: string): string => speech.replace(/\s+/g, '').trim();

/**
 * Play scripted turns through the real BeliefTracker / actionSelector with the
 * given behavior variant and compute the four evaluation metrics.
 *
 * Determinism notes:
 * - Uses a fresh, locally-initialized BeliefTracker (never the global singleton).
 * - Calls selectAction with actionAccuracy = 1 so the difficulty randomizer is
 *   disabled; all remaining selector paths are deterministic once beliefs exist.
 */
export const runReplay = (input: ReplayInput): RoleEvaluationReport => {
  const { gameId, players, turns, variant } = input;
  const provider = input.provider ?? createMockProvider();
  const costPer1kTokens = input.costPer1kTokens ?? 0;
  const multilingualLeakage = input.multilingualLeakage ?? false;
  const trackCounterfactualSelector = input.trackCounterfactualSelector ?? false;

  const tracker = new BeliefTracker();
  tracker.init(players);

  const voteRecords: VoteRecord[] = [];
  const seenSpeeches = new Set<string>();
  const leakageFindings: LeakageFinding[] = [];
  const illegalActions: IllegalActionRecord[] = [];
  const resolvedActions: ResolvedActionRecord[] = [];
  const counterfactualComparisons: CounterfactualComparison[] = [];

  let speechTurns = 0;
  let actionTurns = 0;
  let leakedSpeeches = 0;
  let repeatedSpeeches = 0;

  for (const turn of turns) {
    const actor = players.find(p => p.id === turn.actorId);
    if (!actor) throw new Error(`Replay fixture references unknown player ${turn.actorId}`);
    const profile = getRoleBehaviorProfile(actor.role, variant);

    if (turn.kind === 'speech') {
      speechTurns += 1;
      const prompt = buildSpeechPrompt(actor, profile, turn.round, players);
      const speech = provider.complete(prompt, turn.speech);

      const violations = multilingualLeakage
        ? detectInfoLeakage(actor, speech, { multilingual: true })
        : detectInfoLeakage(actor, speech);
      if (violations.length > 0) {
        leakedSpeeches += 1;
        for (const ruleId of violations) {
          leakageFindings.push({ round: turn.round, actorId: actor.id, ruleId });
        }
      }

      const normalized = normalizeSpeech(speech);
      if (seenSpeeches.has(normalized)) {
        repeatedSpeeches += 1;
      } else {
        seenSpeeches.add(normalized);
      }

      tracker.updateFromSpeech(actor.id, speech, players);
    } else {
      actionTurns += 1;
      const valid = validTargetsFor(actor, players, turn.actionType);
      const proposed = turn.proposedTargetId;
      const proposedAccepted = proposed !== null && valid.includes(proposed);

      if (proposed !== null && !proposedAccepted) {
        illegalActions.push({
          round: turn.round,
          actorId: actor.id,
          actionType: turn.actionType,
          proposedTargetId: proposed,
        });
      }

      // Real engine decision — actionAccuracy 1 disables the randomizer;
      // rng: () => 0 keeps tie-breaking deterministic for golden replay benchmarks.
      const decision = selectAction(actor, players, tracker, turn.actionType, turn.round, voteRecords, 1, { rng: () => 0 });
      if (trackCounterfactualSelector) {
        counterfactualComparisons.push({
          round: turn.round,
          actorId: actor.id,
          actionType: turn.actionType,
          proposedTargetId: proposed,
          selectorTargetId: decision.targetId,
          selectorOutcome: decision.outcome,
          diverged: decision.targetId !== proposed,
        });
      }
      const targetId = proposedAccepted ? proposed : decision.targetId;
      resolvedActions.push({
        round: turn.round,
        actorId: actor.id,
        actionType: turn.actionType,
        targetId,
        source: proposedAccepted ? 'proposed' : 'selector',
      });

      if (turn.actionType === 'VOTE') {
        tracker.updateFromVote(actor.id, targetId);
        voteRecords.push({
          round: turn.round,
          voterId: actor.id,
          targetId,
          phase: GamePhase.DAY_VOTING,
        });
      }
    }
  }

  return {
    gameId,
    variant,
    speechTurns,
    actionTurns,
    illegalActionRate: illegalActions.length / Math.max(1, actionTurns),
    infoLeakageRate: leakedSpeeches / Math.max(1, speechTurns),
    speechRepetitionRate: repeatedSpeeches / Math.max(1, speechTurns),
    estimatedCostUSD: estimateEvalCostUSD(provider.calls, costPer1kTokens),
    leakageFindings,
    illegalActions,
    resolvedActions,
    ...(trackCounterfactualSelector ? { counterfactualComparisons } : {}),
  };
};

// --- END OF FILE src/ai/evaluation.ts ---
