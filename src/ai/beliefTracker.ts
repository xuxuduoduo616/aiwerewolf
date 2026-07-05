/**
 * Layer 1 — BeliefTracker
 * Maintains per-player suspicion scores (0.0–1.0) updated each round.
 * Runs in the browser, no LLM needed.
 */

import type { Player, Role, VoteRecord } from '../types';

export class BeliefTracker {
  // playerId -> targetId -> suspicion score
  private beliefs: Map<number, Map<number, number>> = new Map();

  init(players: Player[]): void {
    this.beliefs.clear();
    for (const actor of players) {
      const actorMap = new Map<number, number>();
      for (const target of players) {
        if (target.id === actor.id) continue;
        // Wolves start with low suspicion on teammates
        if (actor.role === 'Werewolf' && target.role === 'Werewolf') {
          actorMap.set(target.id, 0.05);
        } else {
          actorMap.set(target.id, 0.5);
        }
      }
      this.beliefs.set(actor.id, actorMap);
    }
  }

  getSuspicion(actorId: number, targetId: number): number {
    return this.beliefs.get(actorId)?.get(targetId) ?? 0.5;
  }

  /** After someone speaks, update beliefs based on accusation keywords */
  updateFromSpeech(speakerId: number, speech: string, allPlayers: Player[]): void {
    const actorMap = this.beliefs.get(speakerId);
    if (!actorMap) return;

    // Look for player number references in speech (e.g. "Player 3", "3号")
    // Match player references in both languages:
    //   Chinese: "2号", "3 号"
    //   English: "Player 2", "player3"
    const mentions: number[] = [];
    const chineseRefs = [...speech.matchAll(/(\d+)\s*号/g)];
    const englishRefs = [...speech.matchAll(/player\s*(\d+)/gi)];

    for (const m of [...chineseRefs, ...englishRefs]) {
      const num = parseInt(m[1]);
      if (!isNaN(num) && allPlayers.some(p => p.id === num)) {
        mentions.push(num);
      }
    }

    const accusationWords = ['vote', 'wolf', 'suspect', 'lying', '狼', '投', '疑', '骗', '假'];
    const defenseWords = ['trust', 'good', 'village', 'seer', '好人', '信', '金水'];

    const isAccusing = accusationWords.some(w => speech.toLowerCase().includes(w));
    const isDefending = defenseWords.some(w => speech.toLowerCase().includes(w));

    for (const targetId of mentions) {
      const current = actorMap.get(targetId) ?? 0.5;
      if (isAccusing) {
        actorMap.set(targetId, Math.min(1.0, current + 0.12));
      } else if (isDefending) {
        actorMap.set(targetId, Math.max(0.0, current - 0.08));
      }
    }
  }

  /** After a vote, update the voter's suspicion on who they voted for */
  updateFromVote(voterId: number, targetId: number | null): void {
    if (!targetId) return;
    const actorMap = this.beliefs.get(voterId);
    if (!actorMap) return;
    const current = actorMap.get(targetId) ?? 0.5;
    actorMap.set(targetId, Math.min(1.0, current + 0.15));
  }

  /** After a death, update beliefs based on revealed role */
  updateFromDeath(deadId: number, role: Role, allPlayers: Player[]): void {
    const wasWolf = role === 'Werewolf';
    for (const [actorId, actorMap] of this.beliefs) {
      if (actorId === deadId) continue;
      const oldScore = actorMap.get(deadId) ?? 0.5;

      if (wasWolf) {
        // Those who voted the wolf → their credibility improves
        // (handled implicitly: their past accusations were right)
        // Decrease suspicion on players the wolf was accusing
        // (simplification: just mark the dead player 0 suspicion)
        actorMap.set(deadId, 0.0);
      } else {
        // Dead was innocent → those who voted them look bad
        actorMap.set(deadId, 0.0);
      }
    }
  }

  /** Return the most suspicious alive player for a given actor, with optional filter */
  getMostSuspicious(
    actorId: number,
    players: Player[],
    filter: (p: Player) => boolean = () => true,
  ): Player | null {
    const actorMap = this.beliefs.get(actorId);
    if (!actorMap) return null;

    const candidates = players.filter(p => p.isAlive && p.id !== actorId && filter(p));
    if (candidates.length === 0) return null;

    return candidates.reduce((best, p) => {
      const bestScore = actorMap.get(best.id) ?? 0.5;
      const pScore = actorMap.get(p.id) ?? 0.5;
      return pScore > bestScore ? p : best;
    });
  }

  /** Return the least suspicious alive player (for seer to verify) */
  getLeastVerified(actorId: number, players: Player[]): Player | null {
    const actorMap = this.beliefs.get(actorId);
    if (!actorMap) return null;

    const candidates = players.filter(p => p.isAlive && p.id !== actorId);
    if (candidates.length === 0) return null;

    // Find the player with suspicion closest to 0.5 (most uncertain)
    return candidates.reduce((best, p) => {
      const bestDist = Math.abs((actorMap.get(best.id) ?? 0.5) - 0.5);
      const pDist = Math.abs((actorMap.get(p.id) ?? 0.5) - 0.5);
      return pDist < bestDist ? p : best;
    });
  }

  snapshot(actorId: number): Array<{ targetId: number; score: number }> {
    const actorMap = this.beliefs.get(actorId);
    if (!actorMap) return [];
    return [...actorMap.entries()]
      .map(([targetId, score]) => ({ targetId, score }))
      .sort((a, b) => b.score - a.score);
  }
}

// Singleton tracker per game session
export const globalBeliefTracker = new BeliefTracker();
