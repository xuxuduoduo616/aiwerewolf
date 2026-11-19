import React from 'react';
import { Player, Role } from '../types';

export const WOLF_STRATEGIES = [
  'Lead the Push', 'Bus a Teammate', 'Claim Seer',
  'Stay Under the Radar', 'Assign Teammate Roles', 'Suggest a Night Kill',
] as const;
export type WolfStrategy = typeof WOLF_STRATEGIES[number];

export const wolfStrategyTemplate = (
  strategy: WolfStrategy, players: Player[], selectedPlayer?: Pick<Player, 'id'> | null,
): string => {
  const teammates = players.filter(player => player.isAlive && player.role === Role.WEREWOLF && !player.isHuman);
  const preferredTeammate = teammates.find(player => player.id === selectedPlayer?.id) ?? teammates[0];
  const others = teammates.filter(player => player.id !== preferredTeammate?.id);
  const ally = preferredTeammate ? `Player ${preferredTeammate.id}` : 'our team';
  switch (strategy) {
    case 'Lead the Push': return `I will lead the push tomorrow and defend ${ally} with specific public evidence. ${others[0] ? `Player ${others[0].id}, keep your reasoning independent and challenge weak accusations.` : 'Keep your reasoning independent rather than repeating my arguments.'}`;
    case 'Bus a Teammate': return preferredTeammate
      ? `I will distance myself from ${ally} tomorrow and question their weakest public argument. ${ally}, respond calmly; we need to look independent without getting a teammate eliminated.`
      : 'I will keep my public reasoning independent and avoid obvious connections to the pack. Let us discuss how much pressure is useful before committing.';
    case 'Claim Seer': return `I will claim Seer tomorrow and keep my check story consistent. ${teammates[0] ? `Player ${teammates[0].id}, lead the push and defend the claim with public evidence.` : 'Let us compare the risks before committing.'} Do not make a second Seer claim.`;
    case 'Stay Under the Radar': return `I will stay under the radar and keep my comments brief. ${teammates[0] ? `Player ${teammates[0].id}, lead the discussion` : 'Let us keep our public reasoning independent'}${teammates[1] ? ` while Player ${teammates[1].id} handles backup` : ''}.`;
    case 'Assign Teammate Roles': return teammates.length
      ? `${teammates.map((player, index) => `Player ${player.id}, ${index === 0 ? 'please claim Seer tomorrow' : index === 1 ? 'lead the push and defend the claim with public evidence' : 'stay under the radar and provide backup only when needed'}.`).join(' ')} I will keep a low profile and help maintain our story.`
      : 'I will handle the public discussion and keep my story consistent. Let us check the risks before making any claims.';
    case 'Suggest a Night Kill': {
      const targets = players.filter(player => player.isAlive && player.role !== Role.WEREWOLF);
      const target = targets.find(player => player.id === selectedPlayer?.id) ?? targets[0];
      return target ? `I suggest we kill Player ${target.id} tonight. Discuss the risk of protection and explain any better option before I confirm the target.`
        : "No legal night-kill target remains. Let us focus on tomorrow's public story.";
    }
  }
};

export const appendWolfTemplate = (draft: string, template: string): string =>
  draft.trim() ? `${draft.trim()}\n${template}` : template;

const WolfStrategyChips = ({ players, selectedPlayer, value, onChange }: {
  players: Player[]; selectedPlayer?: Pick<Player, 'id'> | null; value: string; onChange: (value: string) => void;
}) => (
  <div>
    <div className="wolf-strategy-chips" aria-label="Wolf strategy suggestions">
      {WOLF_STRATEGIES.map(strategy => (
        <button key={strategy} type="button" className="game-quick-speech-button rounded-full border border-red-900/70 px-2.5 py-1 text-xs text-red-200 hover:bg-red-950/40"
          onClick={() => onChange(appendWolfTemplate(value, wolfStrategyTemplate(strategy, players, selectedPlayer)))}>{strategy}</button>
      ))}
    </div>
    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
      <span>Chips add to your draft. Edit before sending.</span>
      {value.trim() && <button type="button" className="min-h-11 shrink-0 underline" onClick={() => onChange('')}>Clear draft</button>}
    </div>
  </div>
);
export default WolfStrategyChips;
