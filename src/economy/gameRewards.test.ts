import { describe, expect, it } from 'vitest';
import { GamePhase, Role } from '../types';
import { getTerminalRewardRequest } from './gameRewards';

describe('terminal gameplay reward gate', () => {
  it.each([
    ['lobby', GamePhase.LOBBY, null, null],
    ['unfinished match', GamePhase.DAY_DISCUSSION, null, Role.VILLAGER],
    ['winner without saved match id', GamePhase.GAME_OVER, 'VILLAGERS' as const, Role.VILLAGER],
  ])('returns no request for %s', (_label, phase, winner, role) => {
    expect(getTerminalRewardRequest({ phase, winner, savedRecordId: null, role, hasConfig: true })).toBeNull();
  });

  it('uses the stable saved match id and the existing winner/role outcome', () => {
    expect(getTerminalRewardRequest({
      phase: GamePhase.GAME_OVER,
      winner: 'WEREWOLVES',
      savedRecordId: 'local-123',
      role: Role.WEREWOLF,
      hasConfig: true,
    })).toEqual({ gameId: 'local-123', won: true });
    expect(getTerminalRewardRequest({
      phase: GamePhase.GAME_OVER,
      winner: 'VILLAGERS',
      savedRecordId: 'local-456',
      role: Role.WEREWOLF,
      hasConfig: true,
    })).toEqual({ gameId: 'local-456', won: false });
  });
});
