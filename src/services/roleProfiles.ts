// --- START OF FILE src/services/roleProfiles.ts ---
//
// Role behavior profiles.
//
// These configs shape *how* an AI player expresses itself and how willing it is
// to take a stance. They NEVER decide or execute game actions — the rule layer
// (`gameEngine` / `beliefTracker` / `actionSelector`) always owns legality and
// final actions. A profile only tunes prompt emphasis and stance thresholds.

import { Role } from '../types';
import type {
  ClaimTiming,
  RoleBehaviorParams,
  SourcedClaimTiming,
  SourcedNumber,
} from '../ai/behaviorSchema';

export type BehaviorVariant = 'cautious' | 'balanced' | 'aggressive';

// Source-tag helpers. NO AIWolf data has been downloaded (log reuse license is
// unresolved — see memory/coordination/reports/p2-aiwolf-feasibility.md), so no
// value below may be labeled 'aiwolf-distilled'. Werewolf/Villager/Seer use
// 'heuristic' (hand-authored, distillation pending license confirmation);
// Witch/Hunter/Idiot have no AIWolf equivalent and use 'synthetic' templates.
const heuristic = (value: number): SourcedNumber => ({ value, source: 'heuristic' });
const synthetic = (value: number): SourcedNumber => ({ value, source: 'synthetic' });
const heuristicClaim = (value: ClaimTiming): SourcedClaimTiming => ({ value, source: 'heuristic' });
const syntheticClaim = (value: ClaimTiming): SourcedClaimTiming => ({ value, source: 'synthetic' });

export interface RoleBehaviorProfile {
  role: Role;
  variant: BehaviorVariant;
  /** Prompt modifier describing the speaking posture. */
  speechStyle: string;
  /** 0–1: confidence threshold required before openly accusing someone. */
  accusationConfidence: number;
  /** 0–1: how readily the witch spends the save potion (higher = saves more). */
  poisonSaveThreshold: number;
  /** 0–1: how evidence-based the vote decision is (higher = more rational). */
  voteRationality: number;
  /** 0–1: for wolves, how often to bluff a god claim. Non-wolves stay near 0. */
  bluffProbability: number;
  /** Brief role-specific instruction appended to the system prompt. */
  systemPromptAddendum: string;
  /** Source-tagged behavioral parameters (see src/ai/behaviorSchema.ts). */
  params: RoleBehaviorParams;
}

// Profiles are keyed by role, then variant. Cautious vs aggressive for the same
// role always differ by >= 0.2 in at least two numeric params (enforced by test).
export const ROLE_BEHAVIOR_PROFILES: Record<Role, Record<BehaviorVariant, RoleBehaviorProfile>> = {
  [Role.SEER]: {
    cautious: {
      role: Role.SEER,
      variant: 'cautious',
      speechStyle: '稳健预言家：先隐藏身份，确认信息充分后再报验人。',
      accusationConfidence: 0.8,
      poisonSaveThreshold: 0,
      voteRationality: 0.85,
      bluffProbability: 0,
      systemPromptAddendum: '你是稳健的预言家，优先积累查验信息，不轻易开票，避免暴露给狼队。',
      params: {
        claimTiming: heuristicClaim('when-pressured'),
        voteFollowsSuspicion: heuristic(0.85),
        speechAggressiveness: heuristic(0.3),
      },
    },
    balanced: {
      role: Role.SEER,
      variant: 'balanced',
      speechStyle: '标准预言家：适时跳出，报出金水查杀并盘逻辑。',
      accusationConfidence: 0.6,
      poisonSaveThreshold: 0,
      voteRationality: 0.75,
      bluffProbability: 0,
      systemPromptAddendum: '你是标准预言家，按节奏跳身份、报查验，带好人推狼。',
      params: {
        claimTiming: heuristicClaim('day2'),
        voteFollowsSuspicion: heuristic(0.75),
        speechAggressiveness: heuristic(0.55),
      },
    },
    aggressive: {
      role: Role.SEER,
      variant: 'aggressive',
      speechStyle: '强势预言家：第一时间起跳，强推查杀，压制悍跳狼。',
      accusationConfidence: 0.45,
      poisonSaveThreshold: 0,
      voteRationality: 0.6,
      bluffProbability: 0,
      systemPromptAddendum: '你是强势预言家，果断起跳报查杀，主导票型，压制悍跳狼。',
      params: {
        claimTiming: heuristicClaim('day1'),
        voteFollowsSuspicion: heuristic(0.6),
        speechAggressiveness: heuristic(0.85),
      },
    },
  },
  [Role.WITCH]: {
    cautious: {
      role: Role.WITCH,
      variant: 'cautious',
      speechStyle: '保守女巫：留药自保，只在关键神职被刀时才救。',
      accusationConfidence: 0.75,
      poisonSaveThreshold: 0.3,
      voteRationality: 0.85,
      bluffProbability: 0,
      systemPromptAddendum: '你是保守女巫，倾向留药，只在明确神职被刀时才动救药，毒药慎用。',
      params: {
        claimTiming: syntheticClaim('never'),
        voteFollowsSuspicion: synthetic(0.85),
        speechAggressiveness: synthetic(0.25),
        saveThreshold: synthetic(0.3),
        poisonThreshold: synthetic(0.85),
      },
    },
    balanced: {
      role: Role.WITCH,
      variant: 'balanced',
      speechStyle: '标准女巫：按局势判断救人和用毒。',
      accusationConfidence: 0.6,
      poisonSaveThreshold: 0.55,
      voteRationality: 0.75,
      bluffProbability: 0,
      systemPromptAddendum: '你是标准女巫，权衡刀口价值决定是否救，锁定狼人后果断用毒。',
      params: {
        claimTiming: syntheticClaim('when-pressured'),
        voteFollowsSuspicion: synthetic(0.75),
        speechAggressiveness: synthetic(0.5),
        saveThreshold: synthetic(0.55),
        poisonThreshold: synthetic(0.7),
      },
    },
    aggressive: {
      role: Role.WITCH,
      variant: 'aggressive',
      speechStyle: '激进女巫：早救早毒，主动推进游戏节奏。',
      accusationConfidence: 0.45,
      poisonSaveThreshold: 0.8,
      voteRationality: 0.6,
      bluffProbability: 0,
      systemPromptAddendum: '你是激进女巫，倾向早用药推进节奏，锁定嫌疑就毒。',
      params: {
        claimTiming: syntheticClaim('day2'),
        voteFollowsSuspicion: synthetic(0.6),
        speechAggressiveness: synthetic(0.8),
        saveThreshold: synthetic(0.8),
        poisonThreshold: synthetic(0.55),
      },
    },
  },
  [Role.HUNTER]: {
    cautious: {
      role: Role.HUNTER,
      variant: 'cautious',
      speechStyle: '低调猎人：隐藏枪牌，关键时刻精准带人。',
      accusationConfidence: 0.8,
      poisonSaveThreshold: 0,
      voteRationality: 0.85,
      bluffProbability: 0,
      systemPromptAddendum: '你是低调猎人，隐藏身份到关键时刻，出枪只带高置信度的狼。',
      params: {
        claimTiming: syntheticClaim('never'),
        voteFollowsSuspicion: synthetic(0.85),
        speechAggressiveness: synthetic(0.3),
        shootThreshold: synthetic(0.8),
      },
    },
    balanced: {
      role: Role.HUNTER,
      variant: 'balanced',
      speechStyle: '标准猎人：按局势决定是否亮牌施压。',
      accusationConfidence: 0.6,
      poisonSaveThreshold: 0,
      voteRationality: 0.75,
      bluffProbability: 0,
      systemPromptAddendum: '你是标准猎人，视局势亮牌施压，出枪目标以证据为准。',
      params: {
        claimTiming: syntheticClaim('when-pressured'),
        voteFollowsSuspicion: synthetic(0.75),
        speechAggressiveness: synthetic(0.55),
        shootThreshold: synthetic(0.65),
      },
    },
    aggressive: {
      role: Role.HUNTER,
      variant: 'aggressive',
      speechStyle: '强势猎人：公开亮枪，用枪牌逼迫狼人。',
      accusationConfidence: 0.45,
      poisonSaveThreshold: 0,
      voteRationality: 0.6,
      bluffProbability: 0,
      systemPromptAddendum: '你是强势猎人，公开亮牌用枪压制狼队，敢于强推可疑位。',
      params: {
        claimTiming: syntheticClaim('day1'),
        voteFollowsSuspicion: synthetic(0.6),
        speechAggressiveness: synthetic(0.8),
        shootThreshold: synthetic(0.45),
      },
    },
  },
  [Role.VILLAGER]: {
    cautious: {
      role: Role.VILLAGER,
      variant: 'cautious',
      speechStyle: '稳健村民：多听少说，确认逻辑后再站边。',
      accusationConfidence: 0.8,
      poisonSaveThreshold: 0,
      voteRationality: 0.85,
      bluffProbability: 0,
      systemPromptAddendum: '你是稳健村民，先观察盘逻辑，证据充分才表态和投票。',
      params: {
        claimTiming: heuristicClaim('never'),
        voteFollowsSuspicion: heuristic(0.85),
        speechAggressiveness: heuristic(0.25),
      },
    },
    balanced: {
      role: Role.VILLAGER,
      variant: 'balanced',
      speechStyle: '标准村民：正常表水，跟随可信神职。',
      accusationConfidence: 0.6,
      poisonSaveThreshold: 0,
      voteRationality: 0.75,
      bluffProbability: 0,
      systemPromptAddendum: '你是标准村民，正常表水、盘逻辑，跟随可信预言家推票。',
      params: {
        claimTiming: heuristicClaim('never'),
        voteFollowsSuspicion: heuristic(0.7),
        speechAggressiveness: heuristic(0.5),
      },
    },
    aggressive: {
      role: Role.VILLAGER,
      variant: 'aggressive',
      speechStyle: '冲锋村民：主动带节奏，敢于抛出怀疑。',
      accusationConfidence: 0.45,
      poisonSaveThreshold: 0,
      voteRationality: 0.6,
      bluffProbability: 0,
      systemPromptAddendum: '你是冲锋村民，主动带节奏、抛怀疑，敢于领投推动出局。',
      params: {
        claimTiming: heuristicClaim('never'),
        voteFollowsSuspicion: heuristic(0.55),
        speechAggressiveness: heuristic(0.8),
      },
    },
  },
  [Role.WEREWOLF]: {
    cautious: {
      role: Role.WEREWOLF,
      variant: 'cautious',
      speechStyle: '深水狼：伪装好人，低调倒钩隐藏身份。',
      accusationConfidence: 0.8,
      poisonSaveThreshold: 0,
      voteRationality: 0.85,
      bluffProbability: 0.15,
      systemPromptAddendum: '你是深水狼，尽量伪装普通好人，倒钩藏身，少跳身份多埋点。',
      params: {
        claimTiming: heuristicClaim('never'),
        voteFollowsSuspicion: heuristic(0.8),
        speechAggressiveness: heuristic(0.25),
        firstNightTargetPriority: heuristic(0.6),
      },
    },
    balanced: {
      role: Role.WEREWOLF,
      variant: 'balanced',
      speechStyle: '标准狼：视需要冲锋或悍跳，配合狼队。',
      accusationConfidence: 0.6,
      poisonSaveThreshold: 0,
      voteRationality: 0.7,
      bluffProbability: 0.45,
      systemPromptAddendum: '你是标准狼，按狼队策略冲锋或悍跳，制造好人内斗。',
      params: {
        claimTiming: heuristicClaim('when-pressured'),
        voteFollowsSuspicion: heuristic(0.65),
        speechAggressiveness: heuristic(0.55),
        firstNightTargetPriority: heuristic(0.8),
      },
    },
    aggressive: {
      role: Role.WEREWOLF,
      variant: 'aggressive',
      speechStyle: '悍跳狼：高频悍跳预言家，强行带节奏。',
      accusationConfidence: 0.45,
      poisonSaveThreshold: 0,
      voteRationality: 0.55,
      bluffProbability: 0.85,
      systemPromptAddendum: '你是悍跳狼，果断悍跳神职，强行倒推真预言家，主导错误票型。',
      params: {
        claimTiming: heuristicClaim('day1'),
        voteFollowsSuspicion: heuristic(0.5),
        speechAggressiveness: heuristic(0.9),
        firstNightTargetPriority: heuristic(0.95),
      },
    },
  },
  // IDIOT is not a driven behavioral role here; provide a neutral profile set so
  // the map stays exhaustive over Role without inventing distinct strategies.
  [Role.IDIOT]: {
    cautious: {
      role: Role.IDIOT,
      variant: 'cautious',
      speechStyle: '白痴：像普通好人发言，不主动暴露身份。',
      accusationConfidence: 0.7,
      poisonSaveThreshold: 0,
      voteRationality: 0.8,
      bluffProbability: 0,
      systemPromptAddendum: '你是白痴，像普通好人发言，被抗推时翻牌免死。',
      params: {
        claimTiming: syntheticClaim('when-pressured'),
        voteFollowsSuspicion: synthetic(0.8),
        speechAggressiveness: synthetic(0.35),
      },
    },
    balanced: {
      role: Role.IDIOT,
      variant: 'balanced',
      speechStyle: '白痴：像普通好人发言，不主动暴露身份。',
      accusationConfidence: 0.6,
      poisonSaveThreshold: 0,
      voteRationality: 0.75,
      bluffProbability: 0,
      systemPromptAddendum: '你是白痴，像普通好人发言，被抗推时翻牌免死。',
      params: {
        claimTiming: syntheticClaim('when-pressured'),
        voteFollowsSuspicion: synthetic(0.75),
        speechAggressiveness: synthetic(0.5),
      },
    },
    aggressive: {
      role: Role.IDIOT,
      variant: 'aggressive',
      speechStyle: '白痴：像普通好人发言，敢于表达怀疑。',
      accusationConfidence: 0.5,
      poisonSaveThreshold: 0,
      voteRationality: 0.7,
      bluffProbability: 0,
      systemPromptAddendum: '你是白痴，像普通好人发言，被抗推时翻牌免死。',
      params: {
        claimTiming: syntheticClaim('when-pressured'),
        voteFollowsSuspicion: synthetic(0.7),
        speechAggressiveness: synthetic(0.65),
      },
    },
  },
};

/** Get the behavior profile for a role + variant. */
export const getRoleBehaviorProfile = (
  role: Role,
  variant: BehaviorVariant,
): RoleBehaviorProfile => ROLE_BEHAVIOR_PROFILES[role][variant];

// --- END OF FILE src/services/roleProfiles.ts ---
