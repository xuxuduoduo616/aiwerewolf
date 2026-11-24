import React from 'react';
import { GamePhase, Role, type NightState, type Player } from '../types';

type Viewer = Pick<Player, 'role' | 'isAlive'> | undefined;
type WitchKnowledgeProps = {
  viewer: Viewer;
  phase: GamePhase;
  nightState: NightState;
  /**
   * Unified Witch rule: once the antidote is spent on a previous night,
   * the Witch cannot see subsequent werewolf targets. Defaults to `true`
   * when omitted for backward compatibility with existing callers.
   */
  canSeeWitchVictim?: boolean;
};

const WITCH_KNOWLEDGE_PHASES = new Set([
  GamePhase.NIGHT_WITCH,
  GamePhase.DAY_ANNOUNCE,
  GamePhase.DAY_HUNTER_CHECK,
  GamePhase.DAY_HUNTER_SHOT,
  GamePhase.DAY_DISCUSSION,
  GamePhase.DAY_VOTING,
]);

const witchVictim = ({ viewer, phase, nightState, canSeeWitchVictim = true }: WitchKnowledgeProps) =>
  viewer?.role === Role.WITCH && viewer.isAlive && canSeeWitchVictim && WITCH_KNOWLEDGE_PHASES.has(phase)
    ? nightState.wolfKillId
    : null;

type PlayerKnowledgeBadgeProps = WitchKnowledgeProps & {
  playerId: number;
  seerCheck: { targetId: number; isGood: boolean } | null;
};

export const PlayerKnowledgeBadge = ({
  playerId, seerCheck, ...knowledge
}: PlayerKnowledgeBadgeProps) => {
  let label: string;
  let description: string;
  let color: string;

  // The shared check state may belong to the AI Seer. Other roles must not see it.
  if (knowledge.viewer?.role === Role.SEER && seerCheck?.targetId === playerId) {
    label = seerCheck.isGood ? 'Known Good' : 'Confirmed Wolf';
    description = `Your Seer check: ${seerCheck.isGood ? 'not a werewolf' : 'werewolf'}.`;
    color = seerCheck.isGood
      ? 'bg-emerald-900/90 border-emerald-500 text-emerald-200'
      : 'bg-red-950/90 border-red-500 text-red-200';
  } else if (witchVictim(knowledge) === playerId) {
    label = knowledge.nightState.witchSaved
      ? 'Saved'
      : knowledge.phase === GamePhase.NIGHT_WITCH ? 'Wolf Target' : 'Attacked';
    description = knowledge.nightState.witchSaved
      ? 'Saved with your antidote. Their alignment is unknown.'
      : 'Targeted by the werewolves. Their alignment is unknown.';
    color = 'bg-amber-950/90 border-amber-500 text-amber-200';
  } else {
    return null;
  }

  return (
    <span
      className={`inline-flex whitespace-nowrap border text-[10px] px-1.5 py-0.5 rounded-full font-bold ${color}`}
      title={description}
    >
      {label}
    </span>
  );
};

export const WitchVictimNotice = (knowledge: WitchKnowledgeProps) => {
  const targetId = witchVictim(knowledge);
  if (targetId === null) return null;

  return (
    <p className="mt-2 text-amber-200 text-xs">
      {knowledge.nightState.witchSaved
        ? `You saved Player ${targetId} from the werewolves with your antidote.`
        : knowledge.phase === GamePhase.NIGHT_WITCH
          ? `The werewolves targeted Player ${targetId} tonight.`
          : `Player ${targetId} was attacked by the werewolves last night.`}
    </p>
  );
};
