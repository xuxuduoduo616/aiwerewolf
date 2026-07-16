import { describe, it, expect } from 'vitest';
import { shouldAutoResolveVote } from './hooks/useGameState';
import { getRoleCamp } from './gameEngine';
import { GamePhase, Player, Role } from './types';

/**
 * Regression tests for dead-player-vote-autoresolve (P0).
 *
 * Bug (browser-verified, cycle 2 finding #1): the phase-transition driver in
 * useGameState.ts had no DAY_VOTING branch, and finishVote only fired from a
 * human click. When the human was dead, day voting never auto-resolved — the
 * game stalled 4+ minutes until the dead spectator clicked "NO VOTE".
 *
 * Fix: the driver now calls finishVote(null) when shouldAutoResolveVote()
 * says the human has no vote. A living human with a vote is still waited on.
 */

const mkPlayer = (id: number, role: Role, isHuman = false): Player => ({
  id, name: isHuman ? 'Guest' : `P${id}`, role, camp: getRoleCamp(role),
  isAlive: true, canVote: true, isRevealed: false,
  avatarUrl: '', aiPersonality: '', traits: [], aiModelLabel: '',
  isHuman, publicClaims: [], privateKnowledge: [], suspicionMap: {},
});

// 9-player standard board: 3 villagers, 3 wolves, seer, witch, hunter
const make9PlayerBoard = (): Player[] => [
  mkPlayer(1, Role.VILLAGER, true),
  mkPlayer(2, Role.WEREWOLF), mkPlayer(3, Role.WEREWOLF), mkPlayer(4, Role.WEREWOLF),
  mkPlayer(5, Role.SEER), mkPlayer(6, Role.WITCH), mkPlayer(7, Role.HUNTER),
  mkPlayer(8, Role.VILLAGER), mkPlayer(9, Role.VILLAGER),
];

// 12-player board: 4 villagers, 4 wolves, seer, witch, hunter, idiot
const make12PlayerBoard = (): Player[] => [
  mkPlayer(1, Role.VILLAGER, true),
  mkPlayer(2, Role.WEREWOLF), mkPlayer(3, Role.WEREWOLF),
  mkPlayer(4, Role.WEREWOLF), mkPlayer(5, Role.WEREWOLF),
  mkPlayer(6, Role.SEER), mkPlayer(7, Role.WITCH), mkPlayer(8, Role.HUNTER),
  mkPlayer(9, Role.IDIOT),
  mkPlayer(10, Role.VILLAGER), mkPlayer(11, Role.VILLAGER), mkPlayer(12, Role.VILLAGER),
];

const boards: Array<[string, () => Player[]]> = [
  ['9-player board', make9PlayerBoard],
  ['12-player board', make12PlayerBoard],
];

describe('shouldAutoResolveVote — phase driver DAY_VOTING branch', () => {
  describe.each(boards)('%s', (_label, makeBoard) => {
    it('dead human during DAY_VOTING → auto-resolve', () => {
      const players = makeBoard();
      const me = { ...players[0], isAlive: false, canVote: false };
      expect(shouldAutoResolveVote(GamePhase.DAY_VOTING, me)).toBe(true);
    });

    it('living human with a vote during DAY_VOTING → wait for their click', () => {
      const players = makeBoard();
      const me = players[0]; // alive, canVote
      expect(shouldAutoResolveVote(GamePhase.DAY_VOTING, me)).toBe(false);
    });

    it('living human without a vote (revealed Idiot) → auto-resolve', () => {
      const players = makeBoard();
      const me = { ...players[0], isAlive: true, canVote: false };
      expect(shouldAutoResolveVote(GamePhase.DAY_VOTING, me)).toBe(true);
    });

    it('never fires outside DAY_VOTING, even for a dead human', () => {
      const players = makeBoard();
      const deadMe = { ...players[0], isAlive: false, canVote: false };
      const otherPhases = [
        GamePhase.NIGHT_START, GamePhase.NIGHT_WEREWOLVES, GamePhase.NIGHT_SEER,
        GamePhase.NIGHT_WITCH, GamePhase.DAY_ANNOUNCE, GamePhase.DAY_HUNTER_CHECK,
        GamePhase.DAY_DISCUSSION, GamePhase.DAY_HUNTER_SHOT, GamePhase.GAME_OVER,
        GamePhase.LOGIN, GamePhase.LOBBY,
      ];
      for (const phase of otherPhases) {
        expect(shouldAutoResolveVote(phase, deadMe)).toBe(false);
        expect(shouldAutoResolveVote(phase, players[0])).toBe(false);
      }
    });
  });

  it('missing human player is treated as no vote (defensive)', () => {
    expect(shouldAutoResolveVote(GamePhase.DAY_VOTING, undefined)).toBe(true);
  });
});

describe('phase driver guard — finishVote fires at most once', () => {
  /**
   * Faithful simulation of the driver contract in useGameState.ts:
   *   if (winner || !players.length || isProcessingAI) return;
   *   ... else if (shouldAutoResolveVote(phase, me)) finishVote(null);
   * finishVote sets isProcessingAI = true as its first statement, so any
   * driver re-run while the vote is being processed must be a no-op.
   */
  type DriverState = {
    phase: GamePhase;
    players: Player[];
    winner: string | null;
    isProcessingAI: boolean;
  };

  const driverTick = (state: DriverState, finishVote: () => void) => {
    const me = state.players.find(p => p.id === 1);
    if (state.winner || !state.players.length || state.isProcessingAI) return;
    if (shouldAutoResolveVote(state.phase, me)) finishVote();
  };

  it('dead human: driver re-runs during vote processing do not double-fire', () => {
    const players = make9PlayerBoard();
    players[0] = { ...players[0], isAlive: false, canVote: false };
    const state: DriverState = {
      phase: GamePhase.DAY_VOTING, players, winner: null, isProcessingAI: false,
    };

    let finishVoteCalls = 0;
    const finishVote = () => {
      finishVoteCalls++;
      state.isProcessingAI = true; // finishVote's first statement
    };

    // First driver tick fires the auto-resolve; the effect re-runs several
    // times while AI votes are collected (players/nightState changes) — every
    // re-run must be blocked by the isProcessingAI guard.
    for (let tick = 0; tick < 5; tick++) driverTick(state, finishVote);
    expect(finishVoteCalls).toBe(1);

    // finishVote completes: isProcessingAI false again, phase leaves voting.
    state.isProcessingAI = false;
    state.phase = GamePhase.NIGHT_START;
    driverTick(state, finishVote);
    expect(finishVoteCalls).toBe(1);
  });

  it('living human: driver never calls finishVote no matter how often it re-runs', () => {
    const state: DriverState = {
      phase: GamePhase.DAY_VOTING, players: make12PlayerBoard(),
      winner: null, isProcessingAI: false,
    };
    let finishVoteCalls = 0;
    for (let tick = 0; tick < 10; tick++) driverTick(state, () => finishVoteCalls++);
    expect(finishVoteCalls).toBe(0);
  });

  it('driver skips when the game is already decided or not started', () => {
    const players = make9PlayerBoard();
    players[0] = { ...players[0], isAlive: false, canVote: false };
    let finishVoteCalls = 0;

    driverTick(
      { phase: GamePhase.DAY_VOTING, players, winner: 'WEREWOLVES', isProcessingAI: false },
      () => finishVoteCalls++
    );
    driverTick(
      { phase: GamePhase.DAY_VOTING, players: [], winner: null, isProcessingAI: false },
      () => finishVoteCalls++
    );
    expect(finishVoteCalls).toBe(0);
  });
});
