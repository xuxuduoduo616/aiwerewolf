import React from 'react';
import { Crosshair, Eye, FlaskConical, Skull, Vote } from 'lucide-react';
import { GamePhase, NightState, Player, Role } from '../types';

const MY_PLAYER_ID = 1;

const ActionBar = ({
  phase,
  me,
  selectedPlayer,
  isProcessingAI,
  witchStatus,
  nightState,
  onAction,
  onVoteSkip,
  onWitchSave,
  onWitchSkip,
}: {
  phase: GamePhase;
  me?: Player;
  selectedPlayer?: Player;
  isProcessingAI: boolean;
  witchStatus: { hasSave: boolean; hasPoison: boolean };
  nightState: NightState;
  onAction: () => void;
  onVoteSkip: () => void;
  onWitchSave: () => void;
  onWitchSkip: () => void;
}) => {
  const selectedAlive = Boolean(selectedPlayer?.isAlive && selectedPlayer.id !== MY_PLAYER_ID);

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {phase === GamePhase.NIGHT_WEREWOLVES && me?.role === Role.WEREWOLF && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedAlive || selectedPlayer?.role === Role.WEREWOLF} className="action-button danger"><Skull className="w-4 h-4" />KILL</button>
      )}
      {phase === GamePhase.NIGHT_SEER && me?.role === Role.SEER && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedAlive} className="action-button"><Eye className="w-4 h-4" />CHECK</button>
      )}
      {phase === GamePhase.NIGHT_WITCH && me?.role === Role.WITCH && (
        <>
          <button onClick={onWitchSave} disabled={isProcessingAI || !witchStatus.hasSave || !nightState.wolfKillId} className="action-button"><FlaskConical className="w-4 h-4" />SAVE</button>
          <button onClick={onAction} disabled={isProcessingAI || !witchStatus.hasPoison || !selectedAlive} className="action-button danger"><Skull className="w-4 h-4" />POISON</button>
          <button onClick={onWitchSkip} disabled={isProcessingAI} className="action-button muted">PASS</button>
        </>
      )}
      {phase === GamePhase.DAY_HUNTER_SHOT && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedAlive} className="action-button danger"><Crosshair className="w-4 h-4" />SHOOT</button>
      )}
      {phase === GamePhase.DAY_VOTING && (
        <>
          <button onClick={onAction} disabled={isProcessingAI || !selectedAlive || !me?.canVote} className="action-button"><Vote className="w-4 h-4" />VOTE</button>
          {!me?.canVote && <button onClick={onVoteSkip} disabled={isProcessingAI} className="action-button muted">NO VOTE</button>}
        </>
      )}
    </div>
  );
};

export default ActionBar;
