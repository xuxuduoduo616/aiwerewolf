import { GamePhase, Role, type Winner } from '../types';

export interface TerminalRewardInput {
  phase: GamePhase;
  winner: Winner;
  savedRecordId: string | null;
  role: Role | null;
  hasConfig: boolean;
}

export interface TerminalRewardRequest {
  gameId: string;
  won: boolean;
}

/**
 * Presentation-layer reward gate. It consumes the already-verified terminal
 * outcome and never participates in rules or winner calculation.
 */
export const getTerminalRewardRequest = (input: TerminalRewardInput): TerminalRewardRequest | null => {
  if (
    input.phase !== GamePhase.GAME_OVER
    || !input.winner
    || !input.savedRecordId
    || !input.role
    || !input.hasConfig
  ) return null;

  return {
    gameId: input.savedRecordId,
    won: (input.winner === 'WEREWOLVES' && input.role === Role.WEREWOLF)
      || (input.winner === 'VILLAGERS' && input.role !== Role.WEREWOLF),
  };
};
