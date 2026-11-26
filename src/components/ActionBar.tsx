import React from 'react';
import { Crosshair, Eye, FlaskConical, Skull, Vote } from 'lucide-react';
import { GamePhase, NightState, Player, Role } from '../types';
import { canWitchSelfSave } from '../gameEngine';
import type { DisplayLanguage } from '../i18n';

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

/**
 * Single eligibility predicate for the human Witch SAVE button.
 * Self-save is permitted ONLY on Night 1 (`roundCount <= 1`).
 */
export const canHumanWitchSave = ({
  me,
  witchStatus,
  nightState,
  roundCount = 1,
}: {
  me?: Pick<Player, 'id' | 'role' | 'isAlive'>;
  witchStatus: { hasSave: boolean; hasPoison: boolean };
  nightState: Pick<NightState, 'wolfKillId'>;
  roundCount?: number;
}): boolean => {
  if (!me?.isAlive || me.role !== Role.WITCH || !witchStatus.hasSave) return false;
  return canWitchSelfSave(Math.max(1, roundCount), me.id, nightState.wolfKillId);
};

const ActionBar = ({
  phase,
  me,
  selectedPlayer,
  isProcessingAI,
  witchStatus,
  nightState,
  roundCount = 1,
  onAction,
  onVoteSkip,
  onWitchSave,
  onWitchSkip,
  onSkipWolfChat,
}: {
  phase: GamePhase;
  me?: Player;
  selectedPlayer?: Player;
  isProcessingAI: boolean;
  witchStatus: { hasSave: boolean; hasPoison: boolean };
  nightState: NightState;
  roundCount?: number;
  onAction: () => void;
  onVoteSkip: () => void;
  onWitchSave: () => void;
  onWitchSkip: () => void;
  onSkipWolfChat?: () => void;
}) => {
  const language: DisplayLanguage = 'en';
  const selectedAlive = Boolean(selectedPlayer?.isAlive);
  const selectedOther = selectedAlive && selectedPlayer?.id !== me?.id;
  const canSave = canHumanWitchSave({ me, witchStatus, nightState, roundCount });

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {phase === GamePhase.NIGHT_WEREWOLVES && me?.role === Role.WEREWOLF && (
        nightState.wolfKillId === null
          ? <button aria-label="KILL" onClick={onAction} disabled={!me.isAlive || isProcessingAI || !selectedAlive} className="action-button danger"><Skull className="w-4 h-4" />{actionLabel('KILL', language)}</button>
          : <button type="button" onClick={onSkipWolfChat} disabled={!me.isAlive || isProcessingAI} className="action-button muted">Skip night chat</button>
      )}
      {phase === GamePhase.NIGHT_SEER && me?.role === Role.SEER && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedOther} className="action-button"><Eye className="w-4 h-4" />{actionLabel('CHECK', language)}</button>
      )}
      {phase === GamePhase.NIGHT_WITCH && me?.role === Role.WITCH && (
        <>
          <button onClick={onWitchSave} disabled={isProcessingAI || !canSave} className="action-button"><FlaskConical className="w-4 h-4" />{actionLabel('SAVE', language)}</button>
          <button onClick={onAction} disabled={isProcessingAI || !witchStatus.hasPoison || !selectedOther} className="action-button danger"><Skull className="w-4 h-4" />{actionLabel('POISON', language)}</button>
          <button onClick={onWitchSkip} disabled={isProcessingAI} className="action-button muted">{actionLabel('PASS', language)}</button>
        </>
      )}
      {phase === GamePhase.DAY_HUNTER_SHOT && (
        <button onClick={onAction} disabled={isProcessingAI || !selectedOther} className="action-button danger"><Crosshair className="w-4 h-4" />{actionLabel('SHOOT', language)}</button>
      )}
      {phase === GamePhase.DAY_VOTING && (
        <>
          <button onClick={onAction} disabled={isProcessingAI || !selectedAlive || !me?.isAlive || !me.canVote} className="action-button"><Vote className="w-4 h-4" />{actionLabel('VOTE', language)}</button>
          {!me?.canVote && <button onClick={onVoteSkip} disabled={isProcessingAI} className="action-button muted">{actionLabel('NO_VOTE', language)}</button>}
        </>
      )}
    </div>
  );
};

export default ActionBar;
