// --- START OF FILE src/ai/behaviorSchema.ts ---
//
// Structured behavioral-parameter schema for role behavior profiles.
//
// Every parameter value carries a `source` tag describing where the value came
// from. IMPORTANT — data provenance honesty:
//
// - 'aiwolf-distilled': statistics distilled from AIWolf competition logs.
//   NO AIWolf data has been downloaded yet (log redistribution/reuse license is
//   unresolved — see memory/coordination/reports/p2-aiwolf-feasibility.md), so
//   NOTHING may currently carry this tag. It exists so future distilled values
//   are distinguishable once license permission is confirmed.
// - 'synthetic': template values authored from this project's own game rules,
//   used for roles with no AIWolf equivalent (Witch, Hunter, Idiot — AIWolf has
//   no save/poison witch, no death-trigger hunter, no idiot).
// - 'heuristic': hand-authored expert heuristics (used today for the roles the
//   AIWolf corpus does map cleanly — Werewolf, Villager, Seer — until
//   distillation is actually performed).
//
// None of this involves model training; values are parameterization only.
//
// Like `RoleBehaviorProfile`, these parameters shape expression and thresholds
// ONLY. gameEngine / beliefTracker / actionSelector own legality and final
// actions.

import { Role } from '../types';

export type BehaviorSource = 'aiwolf-distilled' | 'synthetic' | 'heuristic';

export const BEHAVIOR_SOURCES: readonly BehaviorSource[] = [
  'aiwolf-distilled',
  'synthetic',
  'heuristic',
];

/** Roles the AIWolf corpus maps cleanly onto. Only these may EVER carry
 *  'aiwolf-distilled' values (per the P2-A feasibility report). */
export const AIWOLF_COVERED_ROLES: readonly Role[] = [
  Role.WEREWOLF,
  Role.VILLAGER,
  Role.SEER,
];

/** A 0–1 numeric behavioral parameter with data provenance. */
export interface SourcedNumber {
  value: number;
  source: BehaviorSource;
}

/** When a role publicly claims its identity during day speech. */
export type ClaimTiming = 'never' | 'when-pressured' | 'day2' | 'day1';

export const CLAIM_TIMINGS: readonly ClaimTiming[] = [
  'never',
  'when-pressured',
  'day2',
  'day1',
];

/** A claim-timing parameter with data provenance. */
export interface SourcedClaimTiming {
  value: ClaimTiming;
  source: BehaviorSource;
}

/**
 * Behavioral parameters for one role × variant. Every parameter is grounded in
 * an existing consumption point:
 *
 * - `claimTiming` — consumer: `aiOrchestrator` prompt shaping (when the AI is
 *   told to reveal/claim its role in day speech).
 * - `voteFollowsSuspicion` — consumer: `actionSelector` VOTE, which today
 *   branches between belief-tracker most-suspicious and the follow-top-voted
 *   fallback; this weights suspicion-driven voting vs herding.
 * - `speechAggressiveness` — consumer: `aiOrchestrator` prompt emphasis
 *   (complements the free-text `speechStyle`).
 * - `firstNightTargetPriority` (Werewolf only) — consumer: `actionSelector`
 *   KILL, which today hardcodes revealed-god priority (Seer > Witch > Hunter);
 *   this weights god-priority targeting vs suspicion/threat-driven targeting.
 * - `saveThreshold` (Witch only) — consumer: `useGameState.handleWitchPhase`
 *   AI save gate (today hardcoded at 0.55). Higher = spends the save potion
 *   more readily.
 * - `poisonThreshold` (Witch only) — consumer: `actionSelector` POISON
 *   suspicion gate (today hardcoded at 0.7). Higher = needs more suspicion
 *   before poisoning.
 * - `shootThreshold` (Hunter only) — consumer: `useGameState.handleHunterCheck`
 *   AI shot target selection (today random). Higher = only shoots
 *   high-confidence wolves.
 */
export interface RoleBehaviorParams {
  claimTiming: SourcedClaimTiming;
  voteFollowsSuspicion: SourcedNumber;
  speechAggressiveness: SourcedNumber;
  firstNightTargetPriority?: SourcedNumber;
  saveThreshold?: SourcedNumber;
  poisonThreshold?: SourcedNumber;
  shootThreshold?: SourcedNumber;
}

const isValidSource = (role: Role, source: unknown): boolean => {
  if (!BEHAVIOR_SOURCES.includes(source as BehaviorSource)) return false;
  // Roles absent from AIWolf can never carry distilled values.
  if (source === 'aiwolf-distilled' && !AIWOLF_COVERED_ROLES.includes(role)) return false;
  return true;
};

const isValidSourcedNumber = (role: Role, p: SourcedNumber | undefined): boolean =>
  !!p &&
  typeof p.value === 'number' &&
  !Number.isNaN(p.value) &&
  p.value >= 0 &&
  p.value <= 1 &&
  isValidSource(role, p.source);

/** Structural + range + provenance validation for one role's parameter set. */
export const isValidRoleBehaviorParams = (role: Role, p: RoleBehaviorParams): boolean => {
  if (!p) return false;
  if (!CLAIM_TIMINGS.includes(p.claimTiming?.value)) return false;
  if (!isValidSource(role, p.claimTiming.source)) return false;
  if (!isValidSourcedNumber(role, p.voteFollowsSuspicion)) return false;
  if (!isValidSourcedNumber(role, p.speechAggressiveness)) return false;
  // Role-specific parameters must be present exactly for the roles whose
  // consumers can read them, and absent everywhere else.
  const roleSpecific: Array<[keyof RoleBehaviorParams, Role]> = [
    ['firstNightTargetPriority', Role.WEREWOLF],
    ['saveThreshold', Role.WITCH],
    ['poisonThreshold', Role.WITCH],
    ['shootThreshold', Role.HUNTER],
  ];
  for (const [key, owner] of roleSpecific) {
    const param = p[key] as SourcedNumber | undefined;
    if (role === owner) {
      if (!isValidSourcedNumber(role, param)) return false;
    } else if (param !== undefined) {
      return false;
    }
  }
  return true;
};

// --- END OF FILE src/ai/behaviorSchema.ts ---
