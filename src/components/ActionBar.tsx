import React from 'react';
import { Crosshair, Eye, FlaskConical, Skull, Vote } from 'lucide-react';
import { GamePhase, NightState, Player, Role } from '../types';
import { useDisplayLanguage, type DisplayLanguage } from '../i18n';

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

const ACTION_LABELS: Record<ActionLabelKey, Record<DisplayLanguage, string>> = {
  KILL: { zh: '刀人', en: 'KILL' },
  CHECK: { zh: '查验', en: 'CHECK' },
  SAVE: { zh: '救人', en: 'SAVE' },
  POISON: { zh: '毒药', en: 'POISON' },
  PASS: { zh: '跳过', en: 'PASS' },
  SHOOT: { zh: '开枪', en: 'SHOOT' },
  VOTE: { zh: '投票', en: 'VOTE' },
  NO_VOTE: { zh: '弃票', en: 'NO VOTE' },
};

export const actionLabel = (key: ActionLabelKey, language: DisplayLanguage): string =>
  ACTION_LABELS[key][language];

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
  const [language] = useDisplayLanguage();
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
