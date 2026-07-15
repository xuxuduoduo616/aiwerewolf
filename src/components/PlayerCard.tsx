import React from 'react';
import { Player, Role } from '../types';
import { ROLE_LABELS } from '../constants';
import { User, Eye, FlaskConical, Crosshair, Skull, Mic, Cpu, BadgeHelp, PawPrint, Moon } from 'lucide-react';

interface PlayerCardProps {
  player: Player;
  isMe: boolean;
  revealRole: boolean;
  onClick: () => void;
  isSelected?: boolean;
  isSpeaking?: boolean;
  compact?: boolean;
  customBadge?: React.ReactNode;
  isWolfTeammate?: boolean;
}

const RoleIcon = ({ role }: { role: Role }) => {
  switch (role) {
    case Role.WEREWOLF: return <Skull className="w-4 h-4 text-red-400" />;
    case Role.SEER: return <Eye className="w-4 h-4 text-purple-300" />;
    case Role.WITCH: return <FlaskConical className="w-4 h-4 text-fuchsia-300" />;
    case Role.HUNTER: return <Crosshair className="w-4 h-4 text-orange-300" />;
    case Role.IDIOT: return <BadgeHelp className="w-4 h-4 text-cyan-300" />;
    case Role.VILLAGER: return <User className="w-4 h-4 text-zinc-300" />;
    default: return <User className="w-4 h-4 text-zinc-300" />;
  }
};

const AIModelBadge = ({ label }: { label: string }) => {
  return (
    <div className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-zinc-600 bg-zinc-950/80 text-zinc-300 uppercase font-bold tracking-wide shadow-sm">
      <Cpu className="w-2 h-2" />
      <span className="truncate max-w-[58px]">{label.split(' ')[0]}</span>
    </div>
  );
};

export const PlayerCard: React.FC<PlayerCardProps> = ({
  player,
  isMe,
  revealRole,
  onClick,
  isSelected,
  isSpeaking,
  compact,
  customBadge,
  isWolfTeammate,
}) => {
  const showRole = revealRole || isMe || player.isRevealed;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative flex flex-col items-center transition-all duration-300 cursor-pointer border text-left
        ${compact ? 'w-[108px] min-h-[132px] p-2 rounded-lg' : 'h-40 p-2 rounded-xl'}
        ${!player.isAlive ? 'opacity-60 grayscale brightness-[0.5] border-zinc-800' : 'hover:-translate-y-1 hover:shadow-xl'}
        ${isSelected ? 'border-zinc-100 bg-zinc-800 shadow-[0_0_16px_rgba(244,244,245,0.35)]' : 'border-zinc-700/70 bg-zinc-900/78'}
        ${isSpeaking ? 'ring-2 ring-zinc-100 shadow-[0_0_22px_rgba(244,244,245,0.45)] scale-105 z-10 speaking-ring' : ''}
      `}
    >
      <div className="absolute -top-2 -left-2 bg-black border border-zinc-500 text-zinc-100 w-7 h-7 flex items-center justify-center rounded-full z-20 shadow-lg text-xs font-bold">
        {player.id}
      </div>

      {!player.canVote && player.isAlive && (
        <div className="absolute -top-2 -right-2 bg-cyan-950 border border-cyan-500 text-cyan-200 text-[9px] px-1.5 py-0.5 rounded-full z-20">
          无票
        </div>
      )}

      <div className="relative mt-2">
        <img
          src={player.avatarUrl}
          alt={player.name}
          className={`${compact ? 'w-14 h-14' : 'w-16 h-16'} rounded-full object-cover border-2 border-zinc-600 bg-zinc-950 shadow-md`}
        />
        {customBadge && <div className="absolute -top-2 -right-2 z-10">{customBadge}</div>}
        {isWolfTeammate && (
          <div
            className="absolute -bottom-1 -left-1 z-10 bg-red-950/90 border border-red-700 rounded-full p-1 shadow-lg"
            aria-label="狼队友"
          >
            <PawPrint className="w-3 h-3 text-red-300" />
          </div>
        )}
        {!player.isAlive && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 rounded-full backdrop-blur-[1px]">
            <Skull className="text-red-500 w-8 h-8 drop-shadow-md" />
          </div>
        )}
        {isSpeaking && (
          <div className="absolute -bottom-1 -right-1 bg-zinc-100 rounded-full p-1.5 shadow-lg border border-zinc-400">
            <Mic className="w-3 h-3 text-black" />
          </div>
        )}
      </div>

      <div className="mt-2 w-full text-center flex flex-col items-center gap-1">
        <div className="text-xs font-bold text-zinc-100 truncate w-full px-1 flex items-center justify-center gap-1">
          {isMe ? 'YOU' : player.name}
          {isMe && player.role === Role.WEREWOLF && (
            <Moon className="w-3 h-3 text-red-400 shrink-0" aria-label="我是狼人" />
          )}
        </div>

        {!isMe && player.isAlive && <AIModelBadge label={player.aiModelLabel} />}

        {showRole && (
          <div className="mt-1 flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wide bg-black/55 px-2 py-0.5 rounded-full w-fit border border-white/10">
            <RoleIcon role={player.role} />
            <span className={player.role === Role.WEREWOLF ? 'text-red-300' : 'text-zinc-200'}>
              {ROLE_LABELS[player.role]}
            </span>
          </div>
        )}

        {!player.isAlive && (
          <div className="mt-1 text-[9px] font-bold text-red-400 uppercase tracking-widest">OUT</div>
        )}
      </div>
    </button>
  );
};
