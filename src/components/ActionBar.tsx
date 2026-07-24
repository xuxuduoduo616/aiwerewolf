import React from 'react';
import { Crosshair, Eye, FlaskConical, Skull, Vote } from 'lucide-react';
import { GamePhase, NightState, Player, Role } from '../types';
import type { DisplayLanguage } from '../i18n';

const MY_PLAYER_ID = 1;

export type ActionLabelKey =
  | 'KILL'
  | 'CHECK'
  | 'SAVE'
  | 'POISON'
  | 'PASS'
  | 'SHOOT'
  | 'VOTE'
  | 'NO_VOTE';

const ACTION_LABELS: Record<ActionLabelKey, string> = {
  KILL: 'KILL',
  CHECK: 'CHECK',
  SAVE: 'SAVE',
  POISON: 'POISON',
  PASS: 'PASS',
  SHOOT: 'SHOOT',
  VOTE: 'VOTE',
  NO_VOTE: 'NO VOTE',
};

export const actionLabel = (key: ActionLabelKey, _language: DisplayLanguage): string =>
  ACTION_LABELS[key];

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
  const language: DisplayLanguage = 'en';
  const selectedAlive = Boolean(selectedPlayer?.isAlive && selectedPlayer.id !== MY_PLAYER_ID);

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {phase === GamePhase.NIGHT_WEREWOLVES && me?.role === Role.WEREWOLF && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedAlive || selectedPlayer?.role === Role.WEREWOLF} className="action-button danger"><Skull className="w-4 h-4" />{actionLabel('KILL', language)}</button>
      )}
      {phase === GamePhase.NIGHT_SEER && me?.role === Role.SEER && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedAlive} className="action-button"><Eye className="w-4 h-4" />{actionLabel('CHECK', language)}</button>
      )}
      {phase === GamePhase.NIGHT_WITCH && me?.role === Role.WITCH && (
        <>
          <button onClick={onWitchSave} disabled={isProcessingAI || !witchStatus.hasSave || !nightState.wolfKillId} className="action-button"><FlaskConical className="w-4 h-4" />{actionLabel('SAVE', language)}</button>
          <button onClick={onAction} disabled={isProcessingAI || !witchStatus.hasPoison || !selectedAlive} className="action-button danger"><Skull className="w-4 h-4" />{actionLabel('POISON', language)}</button>
          <button onClick={onWitchSkip} disabled={isProcessingAI} className="action-button muted">{actionLabel('PASS', language)}</button>
        </>
      )}
      {phase === GamePhase.DAY_HUNTER_SHOT && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedAlive} className="action-button danger"><Crosshair className="w-4 h-4" />{actionLabel('SHOOT', language)}</button>
      )}
      {phase === GamePhase.DAY_VOTING && (
        <>
          <button onClick={onAction} disabled={isProcessingAI || !selectedAlive || !me?.canVote} className="action-button"><Vote className="w-4 h-4" />{actionLabel('VOTE', language)}</button>
          {!me?.canVote && <button onClick={onVoteSkip} disabled={isProcessingAI} className="action-button muted">{actionLabel('NO_VOTE', language)}</button>}
        </>
      )}
    </div>
  );
};

export default ActionBar;
