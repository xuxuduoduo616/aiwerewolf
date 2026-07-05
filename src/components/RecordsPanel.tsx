import React, { useMemo } from 'react';
import { History, TrendingUp, Shield, Skull } from 'lucide-react';
import type { GameRecord } from '../types';

interface Props {
  records: GameRecord[];
  show: boolean;
  error?: string;
  compact?: boolean;
}

const RecordsPanel: React.FC<Props> = ({ records, show, error, compact }) => {
  if (!show) return null;

  const stats = useMemo(() => {
    if (records.length === 0) return null;
    const wins = records.filter(r => r.result === 'WIN').length;
    const roleCounts: Record<string, number> = {};
    for (const r of records) {
      roleCounts[r.role] = (roleCounts[r.role] || 0) + 1;
    }
    const topRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0];
    return {
      total: records.length,
      wins,
      winRate: Math.round((wins / records.length) * 100),
      topRole: topRole?.[0] || '-',
    };
  }, [records]);

  return (
    <section className={`${compact ? 'p-4' : 'bg-black/45 border border-zinc-800 rounded-lg p-5 backdrop-blur'} min-h-0 overflow-y-auto`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <History className="w-4 h-4" />
        <h3 className="font-bold text-sm">我的战绩</h3>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-amber-200 border border-amber-900 bg-amber-950/25 rounded p-2 mb-3">
          {error}
        </p>
      )}

      {/* Stats summary */}
      {stats && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2 text-center">
            <div className="text-lg font-black text-zinc-100">{stats.total}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">对局</div>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2 text-center">
            <div className={`text-lg font-black ${stats.winRate >= 50 ? 'text-emerald-300' : 'text-red-300'}`}>
              {stats.winRate}%
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">胜率</div>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded p-2 text-center">
            <div className="text-xs font-bold text-zinc-200 truncate">{stats.topRole}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">常用</div>
          </div>
        </div>
      )}

      {/* Records list */}
      {records.length === 0 ? (
        <p className="text-sm text-zinc-500">暂无历史对局。完成一局后会显示在这里。</p>
      ) : (
        <div className="space-y-2">
          {records.map(record => (
            <article key={record.id} className="border border-zinc-800 bg-zinc-950/70 rounded p-3">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <div className="flex items-center gap-1.5">
                  {record.result === 'WIN'
                    ? <TrendingUp className="w-3 h-3 text-emerald-400" />
                    : <Skull className="w-3 h-3 text-red-400" />}
                  <span className={record.result === 'WIN' ? 'text-emerald-300 font-bold' : 'text-red-300 font-bold'}>
                    {record.result}
                  </span>
                  <span className="text-zinc-500">·</span>
                  <Shield className="w-3 h-3 text-zinc-500" />
                  <span className="text-zinc-400">{record.role}</span>
                </div>
                <span className="text-zinc-600">{new Date(record.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400 line-clamp-2">{record.summary}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default RecordsPanel;
