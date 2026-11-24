/**
 * Layer 1 — ActionSelector
 * Pure TypeScript. Decides kill/check/vote/poison/save/shoot targets using
 * role-specific policies grounded strictly in seat-visible beliefs, and emits
 * a structured DecisionTrace for post-game explainability.
 * Never calls LLM — always returns a decision.
 */

import { canWitchSelfSave } from '../gameEngine';
import { Role, type GamePhase, type Player, type VoteRecord } from '../types';
import { BeliefTracker } from './beliefTracker';
import type { SeatMemory, SpeechEventPayload, VoteEventPayload } from './playerMemory';

export type ActionType = 'KILL' | 'CHECK' | 'VOTE' | 'POISON' | 'SAVE' | 'SHOOT';
export type ActionOutcome = 'ACT' | 'HOLD' | 'NO_TARGET';

export interface DecisionCandidateScore {
  targetId: number;
  score: number;
}

export interface DecisionTrace {
  round: number;
  phase?: GamePhase;
  actorId: number;
  actionType: ActionType;
  outcome: ActionOutcome;
  targetId: number | null;
  candidates: DecisionCandidateScore[];
  evidenceEventIds: string[];
  tieBroken: boolean;
  randomized: boolean;
  fallback: boolean;
  latencyMs: number;
}

export interface ActionDecision {
  targetId: number | null;
  reason: string;
  outcome: ActionOutcome;
  tieBroken?: boolean;
  randomized?: boolean;
  trace?: DecisionTrace;
}

export interface SelectActionOptions {
  rng?: () => number;
  checkedTargetIds?: ReadonlySet<number>;
  excludedTargetIds?: ReadonlySet<number>;
  /** For Witch 'SAVE': tonight's werewolf target (only supplied when Witch still hasSave). */
  wolfKillId?: number | null;
  /** For Witch 'SAVE': whether the antidote is available (defaults to true). */
  hasSave?: boolean;
  /** Optional phase context attached to DecisionTrace. */
  phase?: GamePhase;
  /** When true on VOTE, callers (e.g. simultaneous ballot settlement) defer updateFromVote until all votes are cast. */
  deferVoteBeliefUpdate?: boolean;
  /** Optional difficulty-driven wolf pack coordination probability [0, 1]. */
  wolfCoordination?: number;
  /** Optional difficulty-driven mistake rate [0, 1] controlling suboptimal vote spread. */
  mistakeRate?: number;
}

const TIE_EPSILON = 1e-9;

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const computeSharedPublicThreat = (
  seatMemory: SeatMemory,
  beliefs: BeliefTracker,
  actorId: number,
  target: Player,
): number => {
  let base = 0;
  if (target.isRevealed && target.role !== Role.VILLAGER && target.role !== Role.WEREWOLF) {
    const roleBonus =
      target.role === Role.SEER
        ? 0.4
        : target.role === Role.WITCH
          ? 0.3
          : target.role === Role.HUNTER
            ? 0.2
            : target.role === Role.IDIOT
              ? 0.1
              : 0;
    base += 3.0 + roleBonus;
  } else {
    const claim = seatMemory.publicRoleClaims.get(target.id);
    if (claim && !seatMemory.knownTeammateIds.has(target.id)) {
      switch (claim.claimedRole) {
        case Role.SEER:
          base += claim.contested ? 1.9 : 2.2;
          break;
        case Role.WITCH:
          base += 1.8;
          break;
        case Role.HUNTER:
          base += 1.4;
          break;
        case Role.IDIOT:
          base += 1.1;
          break;
        default:
          break;
      }
    }
  }
  base += 0.5 * beliefs.getPublicInfluence(actorId, target.id);
  return Math.min(1.0, base / 3.0);
};

/**
 * Estimate village-side public suspicion against `targetId` strictly from
 * public events visible in `seatMemory` (zero cross-seat private memory reads).
 * Identical across every living wolf seat in the same round.
 */
const computeNonWolfPublicSus = (
  seatMemory: SeatMemory,
  targetId: number,
  players: readonly Player[],
): number => {
  const aliveIds = new Set(players.filter(p => p.isAlive).map(p => p.id));
  const wolfIds = new Set<number>([seatMemory.seatId, ...seatMemory.knownTeammateIds]);
  let score = 0.5;
  for (const event of seatMemory.visibleEvents) {
    if (event.visibility !== 'public') continue;
    if (event.kind === 'speech') {
      const speakerId = event.actorId;
      if (speakerId === null || speakerId === targetId || wolfIds.has(speakerId)) continue;
      if (!aliveIds.has(speakerId)) continue;
      const payload = event.payload as SpeechEventPayload;
      for (const claim of payload.claims) {
        if (claim.targetId !== targetId || claim.confidence <= 0) continue;
        if (claim.polarity === 'check-wolf') score += 0.22;
        else if (claim.polarity === 'accuse') score += 0.14;
        else if (claim.polarity === 'check-good') score -= 0.18;
        else if (claim.polarity === 'defend') score -= 0.10;
      }
    } else if (event.kind === 'vote') {
      const payload = event.payload as VoteEventPayload;
      if (payload.targetId !== targetId || payload.voterId === targetId || wolfIds.has(payload.voterId)) {
        continue;
      }
      if (!aliveIds.has(payload.voterId)) continue;
      score += 0.08;
    }
  }
  return clamp01(score);
};

/**
 * Purely seat-visible vote-bloc deduction for good players (zero hidden info):
 * spots living seats that voted alongside a seat `actor` already suspects (>= 0.62)
 * or voted against a seat `actor` trusts (<= 0.35). Scaled by `(1 - mistakeRate)`
 * so higher-difficulty good players read coordinated wolf voting blocs better.
 */
const computeGoodBlocSignal = (
  seatMemory: SeatMemory,
  targetId: number,
): number => {
  const votesByRound = new Map<number, Array<{ voterId: number; targetId: number }>>();
  for (const event of seatMemory.visibleEvents) {
    if (event.visibility !== 'public' || event.kind !== 'vote') continue;
    const payload = event.payload as VoteEventPayload;
    if (payload.targetId === null) continue;
    const list = votesByRound.get(event.round) ?? [];
    list.push({ voterId: payload.voterId, targetId: payload.targetId });
    votesByRound.set(event.round, list);
  }

  let signal = 0;
  for (const roundVotes of votesByRound.values()) {
    const myVote = roundVotes.find(v => v.voterId === targetId);
    if (!myVote) continue;
    const votedTargetSus = seatMemory.suspicion.get(myVote.targetId) ?? 0.5;
    // Voting against a seat the actor strongly trusts (e.g. gold/silver water)
    if (votedTargetSus <= 0.35 && myVote.targetId !== seatMemory.seatId) {
      signal += 0.08;
    }
    // Voting on the exact same target as a seat the actor strongly suspects
    const alignedWithSuspect = roundVotes.some(
      other =>
        other.voterId !== targetId &&
        other.voterId !== seatMemory.seatId &&
        other.targetId === myVote.targetId &&
        (seatMemory.suspicion.get(other.voterId) ?? 0.5) >= 0.62,
    );
    if (alignedWithSuspect && votedTargetSus < 0.6) {
      signal += 0.10;
    }
  }
  return Math.min(0.25, signal);
};

const pickPackConsensus = (
  scored: readonly DecisionCandidateScore[],
  round: number,
): { chosen: DecisionCandidateScore; tieBroken: boolean } => {
  let bestScore = -Infinity;
  let tied: DecisionCandidateScore[] = [];
  for (const entry of scored) {
    if (entry.score > bestScore + TIE_EPSILON) {
      bestScore = entry.score;
      tied = [entry];
    } else if (Math.abs(entry.score - bestScore) <= TIE_EPSILON) {
      tied.push(entry);
    }
  }
  if (tied.length === 1) {
    return { chosen: tied[0], tieBroken: false };
  }
  const tieHash = (targetId: number): number => ((round * 131 + targetId * 37) >>> 0) % 97;
  const ordered = [...tied].sort(
    (a, b) => tieHash(a.targetId) - tieHash(b.targetId) || a.targetId - b.targetId,
  );
  return { chosen: ordered[0], tieBroken: true };
};

const pickUniformIndex = (length: number, rng: () => number): number => {
  const raw = rng();
  const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1 - Number.EPSILON) : 0;
  return Math.floor(clamped * length);
};

const pickUniform = <T,>(items: readonly T[], rng: () => number): T =>
  items.length === 1 ? items[0] : items[pickUniformIndex(items.length, rng)];

const pickMaxScored = (
  scored: readonly DecisionCandidateScore[],
  rng: () => number,
): { chosen: DecisionCandidateScore; tieBroken: boolean } => {
  let bestScore = -Infinity;
  let tied: DecisionCandidateScore[] = [];
  for (const entry of scored) {
    if (entry.score > bestScore + TIE_EPSILON) {
      bestScore = entry.score;
      tied = [entry];
    } else if (Math.abs(entry.score - bestScore) <= TIE_EPSILON) {
      tied.push(entry);
    }
  }
  const chosen = pickUniform(tied, rng);
  return { chosen, tieBroken: tied.length > 1 };
};

const collectEvidenceIds = (
  beliefs: BeliefTracker,
  actorId: number,
  targetId: number | null,
): string[] => {
  const targeted = targetId !== null ? beliefs.getRecentReasons(actorId, targetId) : [];
  const source = targeted.length > 0 ? targeted : beliefs.getRecentReasons(actorId);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let i = source.length - 1; i >= 0 && ids.length < 5; i -= 1) {
    const id = source[i].eventId;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.unshift(id);
    }
  }
  return ids;
};

const sortCandidates = (candidates: readonly DecisionCandidateScore[]): DecisionCandidateScore[] =>
  [...candidates]
    .map(c => ({ targetId: c.targetId, score: Math.round(c.score * 1e6) / 1e6 }))
    .sort((a, b) => (b.score - a.score) || (a.targetId - b.targetId));

export const selectAction = (
  actor: Player,
  players: Player[],
  beliefs: BeliefTracker,
  type: ActionType,
  round: number,
  voteRecords: VoteRecord[] = [],
  actionAccuracy = 0.85,
  options: SelectActionOptions = {},
): ActionDecision => {
  const startedAt = nowMs();
  const rng = options.rng ?? Math.random;
  const checkedTargetIds = options.checkedTargetIds ?? beliefs.getCheckedTargets(actor.id);
  const excludedTargetIds = options.excludedTargetIds;
  const seatMemory = beliefs.getSeatMemory(actor.id);

  const finalize = (params: {
    targetId: number | null;
    reason: string;
    outcome: ActionOutcome;
    tieBroken: boolean;
    randomized: boolean;
    fallback: boolean;
    candidates?: readonly DecisionCandidateScore[];
  }): ActionDecision => {
    const latencyMs = Math.max(0, Math.round((nowMs() - startedAt) * 1000) / 1000);
    const trace: DecisionTrace = {
      round: Math.max(1, round),
      ...(options.phase ? { phase: options.phase } : {}),
      actorId: actor.id,
      actionType: type,
      outcome: params.outcome,
      targetId: params.targetId,
      candidates: sortCandidates(params.candidates ?? []),
      evidenceEventIds: collectEvidenceIds(beliefs, actor.id, params.targetId),
      tieBroken: params.tieBroken,
      randomized: params.randomized,
      fallback: params.fallback,
      latencyMs,
    };
    return {
      targetId: params.targetId,
      reason: params.reason,
      outcome: params.outcome,
      tieBroken: params.tieBroken,
      randomized: params.randomized,
      trace,
    };
  };

  // Witch SAVE has its own target (wolfKillId, which may equal actor.id on Night 1).
  if (type === 'SAVE') {
    const hasSave = options.hasSave ?? true;
    const wolfKillId = options.wolfKillId ?? null;
    if (!hasSave || wolfKillId === null) {
      return finalize({
        targetId: null,
        reason: '无解药或今晚无刀口，保留解药',
        outcome: 'HOLD',
        tieBroken: false,
        randomized: false,
        fallback: false,
      });
    }

    const victim = players.find(p => p.id === wolfKillId && p.isAlive);
    if (!victim) {
      return finalize({
        targetId: null,
        reason: '倒牌目标无效，保留解药',
        outcome: 'NO_TARGET',
        tieBroken: false,
        randomized: false,
        fallback: false,
      });
    }

    // Unified Witch rule: self-save allowed ONLY on Night 1.
    if (!canWitchSelfSave(round, actor.id, wolfKillId)) {
      return finalize({
        targetId: null,
        reason: '非首夜不可自救，保留解药',
        outcome: 'HOLD',
        tieBroken: false,
        randomized: false,
        fallback: false,
        candidates: [{ targetId: wolfKillId, score: 0 }],
      });
    }

    // Night 1 self-save is legal and always preferred.
    if (wolfKillId === actor.id) {
      return finalize({
        targetId: wolfKillId,
        reason: '首夜自救使用解药',
        outcome: 'ACT',
        tieBroken: false,
        randomized: false,
        fallback: false,
        candidates: [{ targetId: wolfKillId, score: 1 }],
      });
    }

    // Never peek at unrevealed victim.role; evaluate strictly from public claims & suspicion.
    const suspicion = beliefs.getSuspicion(actor.id, wolfKillId);
    const claim = seatMemory?.publicRoleClaims.get(wolfKillId);
    const isPublicGod =
      victim.isRevealed ||
      beliefs.isConfirmedGood(wolfKillId) ||
      Boolean(
        claim &&
          (claim.claimedRole === Role.SEER ||
            claim.claimedRole === Role.HUNTER ||
            claim.claimedRole === Role.IDIOT),
      );

    const saveScore = Math.max(0, Math.min(1, (1 - suspicion) + (isPublicGod ? 0.25 : 0)));
    const shouldSave = isPublicGod || suspicion <= 0.55;

    if (shouldSave) {
      return finalize({
        targetId: wolfKillId,
        reason: isPublicGod
          ? `女巫使用解药救起明好/跳神 ${wolfKillId}号`
          : round <= 1
            ? `首夜使用解药救起 ${wolfKillId}号`
            : `女巫使用解药救起低可疑 ${wolfKillId}号`,
        outcome: 'ACT',
        tieBroken: false,
        randomized: false,
        fallback: false,
        candidates: [{ targetId: wolfKillId, score: saveScore }],
      });
    }

    return finalize({
      targetId: null,
      reason: `倒牌 ${wolfKillId}号 可疑度偏高，保留解药`,
      outcome: 'HOLD',
      tieBroken: false,
      randomized: false,
      fallback: false,
      candidates: [{ targetId: wolfKillId, score: saveScore }],
    });
  }

  const alive = players.filter(p => p.isAlive && p.id !== actor.id);

  // Legal candidate pool per action type (shared by both difficulty-random and strategy branches)
  const legalPool = (() => {
    const allowed = (p: Player) => !excludedTargetIds?.has(p.id);
    switch (type) {
      case 'KILL':
        return alive.filter(p => p.role !== Role.WEREWOLF && allowed(p));
      case 'CHECK':
        return alive.filter(p => !p.isRevealed && !checkedTargetIds.has(p.id) && allowed(p));
      case 'VOTE':
        // Target legality is alive non-self players (canVote is voter eligibility, not target eligibility)
        return alive.filter(allowed);
      case 'POISON':
        return alive.filter(p => !p.isRevealed && allowed(p));
      case 'SHOOT':
        return alive.filter(allowed);
    }
  })();

  // Difficulty gate: with probability (1 - accuracy), pick a suboptimal/random legal target.
  // Never hijacks POISON (or SAVE above) into forcing a blind potion spend.
  if (type !== 'POISON' && actionAccuracy < 1 && legalPool.length > 0 && rng() > actionAccuracy) {
    if (type === 'VOTE' && actor.role === Role.WEREWOLF && options.wolfCoordination !== undefined && seatMemory) {
      const coord = clamp01(options.wolfCoordination);
      const nonWolves = legalPool.filter(p => !seatMemory.knownTeammateIds.has(p.id));
      if (nonWolves.length > 0 && rng() < coord) {
        const rndNonWolf = pickUniform(nonWolves, rng);
        return finalize({
          targetId: rndNonWolf.id,
          reason: '（难度容错）狼队保护队友随机选择',
          outcome: 'ACT',
          tieBroken: false,
          randomized: true,
          fallback: false,
          candidates: legalPool.map(p => ({ targetId: p.id, score: beliefs.getSuspicion(actor.id, p.id) })),
        });
      }
      const rnd = pickUniform(legalPool, rng);
      return finalize({
        targetId: rnd.id,
        reason: '（低难度）随机选择',
        outcome: 'ACT',
        tieBroken: false,
        randomized: true,
        fallback: false,
        candidates: legalPool.map(p => ({ targetId: p.id, score: beliefs.getSuspicion(actor.id, p.id) })),
      });
    }

    if (type === 'VOTE' && actor.role !== Role.WEREWOLF && options.mistakeRate !== undefined && seatMemory) {
      const mRate = clamp01(options.mistakeRate);
      const scoredGood: DecisionCandidateScore[] = legalPool.map(p => {
        const sus = beliefs.getSuspicion(actor.id, p.id);
        if (beliefs.isConfirmedGood(p.id)) return { targetId: p.id, score: 0.0 };
        if (p.isRevealed && p.role === Role.IDIOT && sus <= 0.5 + TIE_EPSILON) {
          return { targetId: p.id, score: 0.0 };
        }
        return { targetId: p.id, score: sus };
      });
      const ranked = sortCandidates(scoredGood);
      if (rng() >= mRate) {
        const topPlausible = ranked.slice(0, Math.min(3, ranked.length));
        const chosen = pickUniform(topPlausible, rng);
        return finalize({
          targetId: chosen.targetId,
          reason: '（难度容错）次优候选选择',
          outcome: 'ACT',
          tieBroken: topPlausible.length > 1,
          randomized: true,
          fallback: false,
          candidates: scoredGood,
        });
      }
      const rnd = pickUniform(legalPool, rng);
      return finalize({
        targetId: rnd.id,
        reason: '（低难度）随机选择',
        outcome: 'ACT',
        tieBroken: false,
        randomized: true,
        fallback: false,
        candidates: scoredGood,
      });
    }

    const rnd = pickUniform(legalPool, rng);
    return finalize({
      targetId: rnd.id,
      reason: '（低难度）随机选择',
      outcome: 'ACT',
      tieBroken: false,
      randomized: true,
      fallback: false,
      candidates: legalPool.map(p => ({ targetId: p.id, score: beliefs.getSuspicion(actor.id, p.id) })),
    });
  }

  switch (type) {
    case 'KILL': {
      const targets = legalPool;
      if (targets.length === 0) {
        return finalize({
          targetId: null,
          reason: '无可击杀目标',
          outcome: 'NO_TARGET',
          tieBroken: false,
          randomized: false,
          fallback: false,
        });
      }

      if (!seatMemory) {
        const fallback = pickUniform(targets, rng);
        return finalize({
          targetId: fallback.id,
          reason: 'fallback随机刀口',
          outcome: 'ACT',
          tieBroken: targets.length > 1,
          randomized: false,
          fallback: true,
          candidates: targets.map(p => ({ targetId: p.id, score: 0.5 })),
        });
      }

      // Score strictly from legitimate public threat (NEVER peek unrevealed roles):
      // revealed gods > public god claims > vocal village leaders > remaining non-wolves.
      const scored = targets.map(p => ({
        targetId: p.id,
        score: beliefs.getPublicThreatScore(actor.id, p),
      }));
      const { chosen, tieBroken } = pickMaxScored(scored, rng);
      const pickedPlayer = targets.find(p => p.id === chosen.targetId)!;
      const publicClaim = seatMemory.publicRoleClaims.get(pickedPlayer.id);

      let reason: string;
      if (pickedPlayer.isRevealed) {
        reason = `优先刀已暴露神职 ${pickedPlayer.role}`;
      } else if (publicClaim && publicClaim.claimedRole !== Role.VILLAGER) {
        reason = `优先刀公开跳${publicClaim.claimedRole}高威胁 ${pickedPlayer.id}号`;
      } else if (beliefs.getPublicInfluence(actor.id, pickedPlayer.id) > 0) {
        reason = `优先刀高影响力好人 ${pickedPlayer.id}号`;
      } else {
        reason = `信念系统判定 ${pickedPlayer.id}号 威胁最高`;
      }

      return finalize({
        targetId: chosen.targetId,
        reason,
        outcome: 'ACT',
        tieBroken,
        randomized: false,
        fallback: false,
        candidates: scored,
      });
    }

    case 'CHECK': {
      const unchecked = legalPool;
      if (unchecked.length === 0) {
        return finalize({
          targetId: null,
          reason: '无未验证目标',
          outcome: 'NO_TARGET',
          tieBroken: false,
          randomized: false,
          fallback: false,
        });
      }

      if (!seatMemory) {
        const pick = pickUniform(unchecked, rng);
        return finalize({
          targetId: pick.id,
          reason: 'fallback验证',
          outcome: 'ACT',
          tieBroken: unchecked.length > 1,
          randomized: false,
          fallback: true,
          candidates: unchecked.map(p => ({ targetId: p.id, score: 1 })),
        });
      }

      // Information value: opposing/contested Seer claims > uncertain active seats near 0.50 > extremes.
      const scored = unchecked.map(p => {
        const sus = beliefs.getSuspicion(actor.id, p.id);
        const uncertainty = 1 - Math.abs(sus - 0.5) * 2;
        const claim = seatMemory.publicRoleClaims.get(p.id);
        const seerClaimBonus = claim?.claimedRole === Role.SEER ? 0.4 : 0;
        const vocalBonus = 0.15 * beliefs.getPublicInfluence(actor.id, p.id);
        return { targetId: p.id, score: uncertainty + seerClaimBonus + vocalBonus };
      });

      const { chosen, tieBroken } = pickMaxScored(scored, rng);
      const claim = seatMemory.publicRoleClaims.get(chosen.targetId);
      const reason =
        claim?.claimedRole === Role.SEER
          ? `预言家核验对跳预言家 ${chosen.targetId}号`
          : `预言家验证不确定目标 ${chosen.targetId}号`;

      return finalize({
        targetId: chosen.targetId,
        reason,
        outcome: 'ACT',
        tieBroken,
        randomized: false,
        fallback: false,
        candidates: scored,
      });
    }

    case 'VOTE': {
      const votable = legalPool;
      if (votable.length === 0) {
        return finalize({
          targetId: null,
          reason: '无可投票目标',
          outcome: 'NO_TARGET',
          tieBroken: false,
          randomized: false,
          fallback: false,
        });
      }

      if (seatMemory) {
        if (actor.role === Role.WEREWOLF) {
          // Wolf day vote: distinguish faction-gain push vs controlled bussing when a teammate is doomed.
          const isTeammate = (p: Player) => seatMemory.knownTeammateIds.has(p.id);
          const nonWolves = votable.filter(p => !isTeammate(p));
          const nonWolfHeats = nonWolves.map(p => beliefs.getPublicHeat(actor.id, p.id, players));
          const bestNonWolfHeat = nonWolfHeats.length > 0 ? Math.max(...nonWolfHeats) : 0;

          let bussingTargetId: number | null = null;
          const scored: DecisionCandidateScore[] = votable.map(p => {
            if (isTeammate(p)) {
              const tmHeat = beliefs.getPublicHeat(actor.id, p.id, players);
              const publicStance = seatMemory.publicStance.get(p.id);
              const explicitBussingStance =
                publicStance === 'accuse' || publicStance === 'check-wolf';
              const inBussingPosture =
                options.wolfCoordination !== undefined
                  ? explicitBussingStance
                  : explicitBussingStance || !actor.isWolfHopper;
              if (tmHeat >= 0.75 && bestNonWolfHeat < 0.5 && inBussingPosture) {
                bussingTargetId = p.id;
                return { targetId: p.id, score: tmHeat + 0.25 };
              }
              return { targetId: p.id, score: 0.0 };
            }

            const heat = beliefs.getPublicHeat(actor.id, p.id, players);
            const sus = beliefs.getSuspicion(actor.id, p.id);
            const threat = Math.min(1.0, beliefs.getPublicThreatScore(actor.id, p) / 3.0);
            return { targetId: p.id, score: 0.45 * heat + 0.35 * sus + 0.2 * threat };
          });

          if (bussingTargetId === null && nonWolves.length > 0 && options.wolfCoordination !== undefined) {
            const coord = clamp01(options.wolfCoordination);
            const consensusScored: DecisionCandidateScore[] = nonWolves.map(p => {
              const heat = beliefs.getPublicHeat(actor.id, p.id, players);
              const publicThreat = computeSharedPublicThreat(seatMemory, beliefs, actor.id, p);
              const avgGoodSus = computeNonWolfPublicSus(seatMemory, p.id, players);
              return {
                targetId: p.id,
                score: 0.45 * heat + 0.35 * publicThreat + 0.2 * avgGoodSus,
              };
            });
            const { chosen: consensusChosen, tieBroken: consensusTieBroken } = pickPackConsensus(
              consensusScored,
              round,
            );
            if (rng() < coord) {
              return finalize({
                targetId: consensusChosen.targetId,
                reason: `狼队协同冲票 ${consensusChosen.targetId}号`,
                outcome: 'ACT',
                tieBroken: consensusTieBroken,
                randomized: false,
                fallback: false,
                candidates: consensusScored,
              });
            }
            const widerPool = nonWolves;
            const dispersed = pickUniform(widerPool, rng);
            return finalize({
              targetId: dispersed.id,
              reason: `狼队分散推抗推目标 ${dispersed.id}号`,
              outcome: 'ACT',
              tieBroken: widerPool.length > 1,
              randomized: false,
              fallback: false,
              candidates: consensusScored,
            });
          }

          const eligibleScored =
            bussingTargetId === null && nonWolves.length > 0
              ? scored.filter(entry => !seatMemory.knownTeammateIds.has(entry.targetId))
              : scored;
          const { chosen, tieBroken } = pickMaxScored(eligibleScored, rng);
          const isBussing =
            bussingTargetId !== null && seatMemory.knownTeammateIds.has(chosen.targetId);
          return finalize({
            targetId: chosen.targetId,
            reason: isBussing
              ? `策略倒钩保身份（投已暴露队友 ${chosen.targetId}号）`
              : `狼队推抗推高威胁目标 ${chosen.targetId}号`,
            outcome: 'ACT',
            tieBroken,
            randomized: false,
            fallback: false,
            candidates: scored,
          });
        }

        // Good player vote: follow internal suspicion, respecting Seer hard checks & revealed Idiot.
        // Real Seer also recognizes any unverified counter-claiming Seer as a fake Seer (seat-visible only).
        // Fall through to round-scoped vote tally if belief lookup cannot produce a lead.
        if (beliefs.getMostSuspicious(actor.id, votable, undefined, () => 0) !== null) {
          const blocWeight =
            options.mistakeRate !== undefined ? 1 - clamp01(options.mistakeRate) : 0;
          const scored: DecisionCandidateScore[] = votable.map(p => {
            const sus = beliefs.getSuspicion(actor.id, p.id);
            if (beliefs.isConfirmedGood(p.id)) {
              return { targetId: p.id, score: 0.0 };
            }
            if (p.isRevealed && p.role === Role.IDIOT && sus <= 0.5 + TIE_EPSILON) {
              return { targetId: p.id, score: 0.0 };
            }
            if (
              actor.role === Role.SEER &&
              seatMemory.publicRoleClaims.get(p.id)?.claimedRole === Role.SEER &&
              seatMemory.seerChecks.get(p.id) !== true
            ) {
              return { targetId: p.id, score: Math.max(sus, 0.95) };
            }
            if (blocWeight > 0 && !(actor.role === Role.SEER && seatMemory.seerChecks.has(p.id))) {
              const blocBonus = blocWeight * computeGoodBlocSignal(seatMemory, p.id);
              return { targetId: p.id, score: clamp01(sus + blocBonus) };
            }
            return { targetId: p.id, score: sus };
          });

          const { chosen, tieBroken } = pickMaxScored(scored, rng);
          return finalize({
            targetId: chosen.targetId,
            reason: `投可疑度最高的 ${chosen.targetId}号`,
            outcome: 'ACT',
            tieBroken,
            randomized: false,
            fallback: false,
            candidates: scored,
          });
        }
      }

      // Uninitialized tracker fallback: vote whoever got most votes this round among legal alive targets
      const votableIds = new Set(votable.map(p => p.id));
      const tally = new Map<number, number>();
      const thisRound = voteRecords.filter(v => v.round === round);
      for (const v of thisRound) {
        if (v.targetId !== null && votableIds.has(v.targetId)) {
          tally.set(v.targetId, (tally.get(v.targetId) ?? 0) + 1);
        }
      }
      if (tally.size > 0) {
        const tallyScored: DecisionCandidateScore[] = [...tally.entries()].map(([targetId, count]) => ({
          targetId,
          score: count,
        }));
        const { chosen, tieBroken } = pickMaxScored(tallyScored, rng);
        return finalize({
          targetId: chosen.targetId,
          reason: '跟投最多票目标',
          outcome: 'ACT',
          tieBroken,
          randomized: false,
          fallback: true,
          candidates: tallyScored,
        });
      }

      const fallback = pickUniform(votable, rng);
      return finalize({
        targetId: fallback.id,
        reason: 'fallback投票',
        outcome: 'ACT',
        tieBroken: votable.length > 1,
        randomized: false,
        fallback: true,
        candidates: votable.map(p => ({ targetId: p.id, score: 0.5 })),
      });
    }

    case 'POISON': {
      // Witch poisons most suspicious alive unrevealed player (excluding unsaved wolf target when visible)
      const targets = legalPool;
      if (targets.length === 0) {
        return finalize({
          targetId: null,
          reason: '无毒药目标',
          outcome: 'NO_TARGET',
          tieBroken: false,
          randomized: false,
          fallback: false,
        });
      }

      const scored: DecisionCandidateScore[] = targets.map(p => ({
        targetId: p.id,
        score: beliefs.isConfirmedGood(p.id) ? 0.0 : beliefs.getSuspicion(actor.id, p.id),
      }));
      const { chosen, tieBroken } = pickMaxScored(scored, rng);

      if (chosen.score > 0.7) {
        return finalize({
          targetId: chosen.targetId,
          reason: `女巫毒杀高可疑 ${chosen.targetId}号`,
          outcome: 'ACT',
          tieBroken,
          randomized: false,
          fallback: false,
          candidates: scored,
        });
      }

      return finalize({
        targetId: null,
        reason: '可疑度不够高，不用毒',
        outcome: 'HOLD',
        tieBroken: false,
        randomized: false,
        fallback: false,
        candidates: scored,
      });
    }

    case 'SHOOT': {
      const targets = legalPool;
      if (targets.length === 0) {
        return finalize({
          targetId: null,
          reason: '无可开枪目标',
          outcome: 'NO_TARGET',
          tieBroken: false,
          randomized: false,
          fallback: false,
        });
      }

      // Avoid shooting confirmed-good / revealed Idiot whenever other alive targets exist.
      const preferred = targets.filter(
        p => !(p.isRevealed && p.role === Role.IDIOT) && !beliefs.isConfirmedGood(p.id),
      );
      const pool = preferred.length > 0 ? preferred : targets;

      const scored: DecisionCandidateScore[] = pool.map(p => ({
        targetId: p.id,
        score: beliefs.getSuspicion(actor.id, p.id),
      }));
      const { chosen, tieBroken } = pickMaxScored(scored, rng);

      return finalize({
        targetId: chosen.targetId,
        reason: `猎人开枪带走高可疑目标 ${chosen.targetId}号`,
        outcome: 'ACT',
        tieBroken,
        randomized: false,
        fallback: !seatMemory,
        candidates: scored,
      });
    }
  }
};
