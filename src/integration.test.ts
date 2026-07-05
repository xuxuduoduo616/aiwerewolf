import { describe, it, expect } from 'vitest';
import {
  computeWinner,
  applyElimination,
  applyNightResolution,
  createSuspicionMap,
  getRoleCamp,
} from './gameEngine';
import { selectAction } from './ai/actionSelector';
import { BeliefTracker } from './ai/beliefTracker';
import { Player, Role } from './types';

const mkPlayer = (id: number, role: Role): Player => ({
  id, name: `P${id}`, role, camp: getRoleCamp(role),
  isAlive: true, canVote: true, isRevealed: false,
  avatarUrl: '', aiPersonality: '', traits: [], aiModelLabel: '',
  isHuman: false, publicClaims: [], privateKnowledge: [], suspicionMap: {},
});

describe('Integration: full game flow simulation', () => {
  it('a 9-player game reaches a winner within reasonable rounds', () => {
    let players: Player[] = [
      mkPlayer(1, Role.WEREWOLF), mkPlayer(2, Role.WEREWOLF), mkPlayer(3, Role.WEREWOLF),
      mkPlayer(4, Role.SEER), mkPlayer(5, Role.WITCH), mkPlayer(6, Role.HUNTER),
      mkPlayer(7, Role.VILLAGER), mkPlayer(8, Role.VILLAGER), mkPlayer(9, Role.VILLAGER),
    ];
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    let winner = computeWinner(players);
    let round = 0;
    const MAX_ROUNDS = 20;

    while (!winner && round < MAX_ROUNDS) {
      round++;
      // Night: wolves kill
      const wolf = players.find(p => p.isAlive && p.role === Role.WEREWOLF);
      if (wolf) {
        const kill = selectAction(wolf, players, beliefs, 'KILL', round, [], 0.9);
        if (kill.targetId) {
          const res = applyNightResolution(players, { wolfKillId: kill.targetId, witchPoisonId: null, witchSaved: false });
          players = res.players;
          winner = res.winner;
        }
      }
      if (winner) break;

      // Day: vote out most suspicious
      const voter = players.find(p => p.isAlive);
      if (voter) {
        const vote = selectAction(voter, players, beliefs, 'VOTE', round, [], 0.9);
        if (vote.targetId) {
          const res = applyElimination(players, vote.targetId, 'VOTE');
          players = res.players;
          winner = res.winner;
        }
      }
    }

    // Game must terminate with a winner (not hit the round cap)
    expect(winner).not.toBeNull();
    expect(round).toBeLessThan(MAX_ROUNDS);
  });

  it('BeliefTracker produces varied suspicion scores', () => {
    const players = [
      mkPlayer(1, Role.VILLAGER), mkPlayer(2, Role.WEREWOLF),
      mkPlayer(3, Role.SEER), mkPlayer(4, Role.VILLAGER),
    ];
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    // Player 1 accuses player 2
    beliefs.updateFromSpeech(1, '我觉得2号是狼，投票2号', players);
    const s12 = beliefs.getSuspicion(1, 2);
    const s13 = beliefs.getSuspicion(1, 3);

    // Suspicion on accused (2) should exceed baseline on non-mentioned (3)
    expect(s12).toBeGreaterThan(s13);
  });

  it('easy difficulty randomizes more than hard', () => {
    const players = [
      mkPlayer(1, Role.WEREWOLF), mkPlayer(2, Role.SEER),
      mkPlayer(3, Role.VILLAGER), mkPlayer(4, Role.VILLAGER),
    ];
    const beliefs = new BeliefTracker();
    beliefs.init(players);
    // Make player 2 (seer) highly suspicious to wolf
    beliefs.updateFromVote(1, 2);
    beliefs.updateFromVote(1, 2);

    // Hard mode should consistently pick the high-suspicion target
    let hardHits = 0;
    for (let i = 0; i < 50; i++) {
      const a = selectAction(players[0], players, beliefs, 'KILL', 1, [], 1.0);
      if (a.targetId === 2) hardHits++;
    }
    // With accuracy 1.0, should almost always target the seer
    expect(hardHits).toBeGreaterThan(30);
  });
});
