import React, { useState } from 'react';
import { GAME_MODES } from '../constants';
import type { GameConfig } from '../types';
import { ROLE_LABELS } from '../constants';
import type { Role } from '../types';
import MatchWideCard from './MatchWideCard';
import MatchGridCard from './MatchGridCard';
import MatchSubTabs from './MatchSubTabs';

type SubTab = 'home' | 'beginner' | 'entertainment' | 'advanced';

interface Props {
  onBack: () => void;
  onSelectBoard: (config: GameConfig) => void;
}

/* ─── Help icon ──────────────────────────────────────────────────────── */

const HelpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 20, height: 20 }}>
    <circle cx="12" cy="12" r="10" strokeLinecap="round"/>
    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
  </svg>
);

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
    <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ─── Role badge data ────────────────────────────────────────────────── */

const ROLE_COLORS: Record<string, string> = {
  Werewolf: '#ef4444',
  Villager: '#a1a1aa',
  Seer: '#c084fc',
  Witch: '#f472b6',
  Hunter: '#fb923c',
  Idiot: '#22d3ee',
};

const ROLE_SHORT: Record<string, string> = {
  Werewolf: '狼',
  Villager: '民',
  Seer: '预',
  Witch: '女',
  Hunter: '猎',
  Idiot: '白',
};

/* ─── Count role config ──────────────────────────────────────────────── */

const countRoles = (roles: Role[]): { role: Role; count: number }[] => {
  const tally = new Map<Role, number>();
  for (const r of roles) tally.set(r, (tally.get(r) || 0) + 1);
  return Array.from(tally.entries()).map(([role, count]) => ({ role, count }));
};

/* ─── Limited-time boards (hardcoded test data) ──────────────────────── */

const LIMITED_BOARDS = [
  { id: 'limited-1', name: '12人觉醒摄梦人', season: '逐浪季', deadline: '剩余3天10小时', roleSummary: '4狼/4民/预/女/猎/摄梦人' },
  { id: 'limited-2', name: '9人血月猎魔人', season: '逐浪季', deadline: '剩余1天6小时', roleSummary: '3狼/3民/预/女/猎魔人' },
];

/* ─── Component ──────────────────────────────────────────────────────── */

const MatchSelection: React.FC<Props> = ({ onBack, onSelectBoard }) => {
  const [subTab, setSubTab] = useState<SubTab>('home');

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 12px 4px',
      }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', padding: '4px 0',
          }}
        >
          <BackIcon />
          <span>返回</span>
        </button>

        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>快速游戏</span>

        <button
          type="button"
          style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
            padding: 4,
          }}
          title="帮助"
          aria-label="帮助"
        >
          <HelpIcon />
        </button>
      </div>

      {/* Sub-tabs */}
      <MatchSubTabs active={subTab} onSelect={setSubTab} />

      {/* Content area */}
      <div style={{ padding: '12px' }}>
        {/* ── Wide card stack (常驻开放场) ────────────────────────── */}
        <div style={{ marginBottom: 12 }}>
          <div className="wol-section-title" style={{ padding: '0 0 10px' }}>
            常驻开放场
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {GAME_MODES.map(mode => {
              const roleCounts = countRoles(mode.roles);
              return (
                <MatchWideCard
                  key={mode.id}
                  config={mode}
                  roleCounts={roleCounts}
                  onSelect={() => onSelectBoard(mode)}
                />
              );
            })}
          </div>
        </div>

        {/* ── 多选匹配 button ───────────────────────────────────── */}
        <button
          type="button"
          className="wol-btn wol-btn--primary wol-btn--lg"
          style={{ width: '100%', marginBottom: 20, fontSize: 15, fontWeight: 800 }}
        >
          多选匹配
        </button>

        {/* ── Grid columns (限时活动场) ──────────────────────────────────── */}
        <div>
          <div className="wol-section-title" style={{ padding: '0 0 10px' }}>
            限时活动场
          </div>
          <div className="wol-grid-2">
            {LIMITED_BOARDS.map(board => (
              <MatchGridCard
                key={board.id}
                name={board.name}
                roleSummary={board.roleSummary}
                season={board.season}
                deadline={board.deadline}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MatchSelection;
export { ROLE_COLORS, ROLE_SHORT, countRoles };
