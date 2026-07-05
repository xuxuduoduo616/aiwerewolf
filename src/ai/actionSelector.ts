/**
 * Layer 1 — ActionSelector
 * Pure TypeScript. Decides kill/check/vote/poison target based on beliefs.
 * Never calls LLM — always returns a decision.
 */

import type { Player, Role, VoteRecord } from '../types';
import { BeliefTracker } from './beliefTracker';

export type ActionType = 'KILL' | 'CHECK' | 'VOTE' | 'POISON';

export interface ActionDecision {
  targetId: number | null;
  reason: string;
}

export const selectAction = (
  actor: Player,
  players: Player[],
  beliefs: BeliefTracker,
  type: ActionType,
  round: number,
  voteRecords: VoteRecord[] = [],
  actionAccuracy = 0.85,
): ActionDecision => {

  const alive = players.filter(p => p.isAlive && p.id !== actor.id);

  // Difficulty gate: with probability (1 - accuracy), pick a random valid target
  // (simulates weaker AI making sub-optimal decisions on easy mode)
  const shouldRandomize = Math.random() > actionAccuracy;
  if (shouldRandomize && alive.length > 0) {
    const pool = type === 'KILL' ? alive.filter(p => p.role !== 'Werewolf') : alive;
    if (pool.length > 0) {
      const rnd = pool[Math.floor(Math.random() * pool.length)];
      return { targetId: rnd.id, reason: '（低难度）随机选择' };
    }
  }

  switch (type) {
    case 'KILL': {
      // Wolves prefer to kill: Seer > Witch > Hunter > Villager
      const godPriority = (role: string) => {
        if (role === 'Seer') return 4;
        if (role === 'Witch') return 3;
        if (role === 'Hunter') return 2;
        if (role === 'Idiot') return 1;
        return 0;
      };

      // Filter out wolf teammates
      const targets = alive.filter(p => p.role !== 'Werewolf');
      if (targets.length === 0) return { targetId: null, reason: '无可击杀目标' };

      // Revealed gods first
      const revealed = targets.filter(p => p.isRevealed);
      if (revealed.length > 0) {
        revealed.sort((a, b) => godPriority(b.role) - godPriority(a.role));
        return {
          targetId: revealed[0].id,
          reason: `优先刀已暴露神职 ${revealed[0].role}`,
        };
      }

      // Otherwise pick highest-suspicion target from belief tracker (most discussed/accused)
      const bestGuess = beliefs.getMostSuspicious(
        actor.id, targets,
        p => p.role !== 'Werewolf'
      );
      if (bestGuess) {
        return {
          targetId: bestGuess.id,
          reason: `信念系统判定 ${bestGuess.id}号 威胁最高`,
        };
      }

      // Fallback: random alive non-wolf
      const fallback = targets[Math.floor(Math.random() * targets.length)];
      return { targetId: fallback.id, reason: 'fallback随机刀口' };
    }

    case 'CHECK': {
      // Seer prefers to verify unknown high-discussion players
      const unchecked = alive.filter(p => !p.isRevealed);
      if (unchecked.length === 0) return { targetId: null, reason: '无未验证目标' };

      // Find the most uncertain (close to 0.5 belief score)
      const uncertain = beliefs.getLeastVerified(actor.id, unchecked);
      if (uncertain) {
        return {
          targetId: uncertain.id,
          reason: `预言家验证不确定目标 ${uncertain.id}号`,
        };
      }

      const pick = unchecked[Math.floor(Math.random() * unchecked.length)];
      return { targetId: pick.id, reason: 'fallback验证' };
    }

    case 'VOTE': {
      // Vote most suspicious player
      const votable = alive.filter(p => p.canVote);
      if (votable.length === 0) return { targetId: null, reason: '无可投票目标' };

      const mostSuspected = beliefs.getMostSuspicious(actor.id, votable);
      if (mostSuspected) {
        return {
          targetId: mostSuspected.id,
          reason: `投可疑度最高的 ${mostSuspected.id}号`,
        };
      }

      // Fallback: vote whoever got most votes this round
      const tally: Record<number, number> = {};
      const thisRound = voteRecords.filter(v => v.round === round);
      for (const v of thisRound) {
        if (v.targetId) tally[v.targetId] = (tally[v.targetId] || 0) + 1;
      }
      const topVoted = Object.entries(tally).sort(([, a], [, b]) => b - a)[0];
      if (topVoted) {
        return { targetId: Number(topVoted[0]), reason: '跟投最多票目标' };
      }

      const fallback = votable[Math.floor(Math.random() * votable.length)];
      return { targetId: fallback.id, reason: 'fallback投票' };
    }

    case 'POISON': {
      // Witch poisons most suspicious alive player (who isn't already wolf-targeted)
      const targets = alive.filter(p => !p.isRevealed);
      if (targets.length === 0) return { targetId: null, reason: '无毒药目标' };

      const mostSuspected = beliefs.getMostSuspicious(actor.id, targets);
      if (mostSuspected && beliefs.getSuspicion(actor.id, mostSuspected.id) > 0.7) {
        return {
          targetId: mostSuspected.id,
          reason: `女巫毒杀高可疑 ${mostSuspected.id}号`,
        };
      }
      return { targetId: null, reason: '可疑度不够高，不用毒' };
    }
  }
};
