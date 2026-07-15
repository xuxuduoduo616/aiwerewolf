import React, { useMemo, useState } from 'react';
import { ChevronDown, Gavel, Skull, Vote } from 'lucide-react';
import type { Player, VoteRecord } from '../types';

interface Props {
  voteRecords: VoteRecord[];
  players: Player[];
  round: number;
  eliminatedPlayerId: number | null;
}

interface TargetGroup {
  targetId: number;
  voterIds: number[];
  count: number;
  percent: number;
}

export interface VoteSummaryData {
  totalVotes: number;
  groups: TargetGroup[];
  abstainVoterIds: number[];
  pairs: { voterId: number; targetId: number | null }[];
}

/**
 * Pure vote-tally computation, extracted for unit testing.
 * Groups this round's votes by target, sorted by descending count,
 * and separates abstentions (targetId === null).
 */
export const computeVoteSummary = (
  voteRecords: VoteRecord[],
  round: number,
): VoteSummaryData => {
  const roundVotes = voteRecords.filter(v => v.round === round);
  const totalVotes = roundVotes.length;

  const byTarget = new Map<number, number[]>();
  const abstainVoterIds: number[] = [];

  for (const vote of roundVotes) {
    if (vote.targetId === null) {
      abstainVoterIds.push(vote.voterId);
    } else {
      const list = byTarget.get(vote.targetId) ?? [];
      list.push(vote.voterId);
      byTarget.set(vote.targetId, list);
    }
  }

  const groups: TargetGroup[] = Array.from(byTarget.entries())
    .map(([targetId, voterIds]) => ({
      targetId,
      voterIds,
      count: voterIds.length,
      percent: totalVotes > 0 ? Math.round((voterIds.length / totalVotes) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.targetId - b.targetId);

  return {
    totalVotes,
    groups,
    abstainVoterIds,
    pairs: roundVotes.map(v => ({ voterId: v.voterId, targetId: v.targetId })),
  };
};

const VoteSummary: React.FC<Props> = ({ voteRecords, players, round, eliminatedPlayerId }) => {
  const [showDetail, setShowDetail] = useState(false);

  const summary = useMemo(() => computeVoteSummary(voteRecords, round), [voteRecords, round]);

  const nameOf = (id: number) => {
    const player = players.find(p => p.id === id);
    return player ? `${player.id}号 ${player.name}` : `${id}号`;
  };
  const shortOf = (id: number) => `${id}号`;

  if (summary.totalVotes === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-center">
        <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-zinc-300">
          <Vote className="w-3.5 h-3.5" />放逐投票结果
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">本轮没有投票记录。</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
          <Vote className="w-3.5 h-3.5" />放逐投票结果
        </div>
        <span className="text-[10px] text-zinc-500">第 {round} 天 · {summary.totalVotes} 票</span>
      </div>

      {/* Grouped by target */}
      <div className="space-y-1.5">
        {summary.groups.map(group => {
          const isExiled = group.targetId === eliminatedPlayerId;
          return (
            <div
              key={group.targetId}
              className={`rounded border p-2 ${isExiled ? 'border-red-700 bg-red-950/40' : 'border-zinc-700 bg-zinc-900'}`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className={`font-bold ${isExiled ? 'text-red-100' : 'text-zinc-200'}`}>
                  {nameOf(group.targetId)}
                </span>
                <span className={isExiled ? 'text-red-200' : 'text-zinc-400'}>
                  {group.count} 票 · {group.percent}%
                </span>
              </div>
              {/* count bar */}
              <div className="mt-1.5 h-1 rounded-full bg-black/40 overflow-hidden">
                <div
                  className={`h-full ${isExiled ? 'bg-red-600' : 'bg-zinc-500'}`}
                  style={{ width: `${group.percent}%` }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {group.voterIds.map(voterId => (
                  <span key={voterId} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                    {shortOf(voterId)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Abstentions */}
      {summary.abstainVoterIds.length > 0 && (
        <div className="rounded border border-zinc-700 bg-zinc-800 p-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-zinc-300">弃票</span>
            <span className="text-zinc-400">{summary.abstainVoterIds.length} 票</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {summary.abstainVoterIds.map(voterId => (
              <span key={voterId} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500 border border-zinc-700">
                {shortOf(voterId)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Exile result focal point */}
      {eliminatedPlayerId !== null ? (
        <div className="rounded-lg border-2 border-red-700 bg-red-950/80 p-2.5 text-center">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-red-300/80 uppercase tracking-wide">
            <Gavel className="w-3 h-3" />放逐出局
          </div>
          <div className="mt-1 flex items-center justify-center gap-1.5 text-sm font-black text-red-100">
            <Skull className="w-4 h-4" />{nameOf(eliminatedPlayerId)}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-600 bg-zinc-800 p-2.5 text-center">
          <div className="text-sm font-bold text-zinc-300">平票 · 无人出局</div>
        </div>
      )}

      {/* Collapsible detail */}
      <div>
        <button
          onClick={() => setShowDetail(v => !v)}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
          详情
        </button>
        {showDetail && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
            {summary.pairs.map(pair => (
              <div key={pair.voterId} className="text-[10px] text-zinc-500 flex justify-between">
                <span>{shortOf(pair.voterId)}</span>
                <span className="text-zinc-600">→</span>
                <span>{pair.targetId === null ? '弃票' : shortOf(pair.targetId)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VoteSummary;
