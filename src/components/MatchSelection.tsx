import React, { useState } from 'react';
import { GAME_MODES } from '../constants';
import type { GameConfig } from '../types';
import type { Role } from '../types';
import MatchWideCard from './MatchWideCard';
import MatchGridCard from './MatchGridCard';
import MatchSubTabs from './MatchSubTabs';
import { getTabId, getTabPanelId } from './TabBar';
import { ArrowLeft, HelpCircle } from 'lucide-react';

type SubTab = 'home' | 'beginner' | 'entertainment' | 'advanced';

interface Props {
  onBack: () => void;
  onSelectBoard: (config: GameConfig) => void;
  onMultiMatch?: () => void;
  onLimitedSelect?: () => void;
}

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

const MATCH_TABS: readonly SubTab[] = ['home', 'beginner', 'entertainment', 'advanced'];

/* ─── Component ──────────────────────────────────────────────────────── */

const MatchSelection: React.FC<Props> = ({ onBack, onSelectBoard }) => {
  const [subTab, setSubTab] = useState<SubTab>('home');

  return (
    <section className="wol-match-view" aria-label="快速游戏">
      {/* Top bar */}
      <div className="wol-match-header" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 12px 4px',
      }}>
        <button
          type="button"
          onClick={onBack}
          className="wol-match-header-action"
        >
          <ArrowLeft aria-hidden="true" />
          <span>返回</span>
        </button>

        <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>快速游戏</span>

        <button
          type="button"
          className="wol-match-header-action wol-match-header-action--icon"
          title="帮助"
          aria-label="帮助"
        >
          <HelpCircle aria-hidden="true" />
        </button>
      </div>

      {/* Sub-tabs */}
      <MatchSubTabs active={subTab} onSelect={setSubTab} />

      {MATCH_TABS.filter(tab => tab !== subTab).map(tab => (
        <div
          key={tab}
          id={getTabPanelId('match', tab)}
          role="tabpanel"
          aria-labelledby={getTabId('match', tab)}
          hidden
        />
      ))}

      {/* Content area */}
      <div
        id={getTabPanelId('match', subTab)}
        role="tabpanel"
        aria-labelledby={getTabId('match', subTab)}
        tabIndex={0}
        className="wol-match-content wol-tabpanel"
      >
        {/* ── Wide card stack (常驻开放场) ────────────────────────── */}
        <div style={{ marginBottom: 12 }}>
          <div className="wol-section-title" style={{ padding: '0 0 10px' }}>
            常驻开放场
          </div>
          <div className="wol-match-wide-grid">
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
          disabled
          title="多选匹配未开放"
        >
          多选匹配 · 未开放
        </button>

        {/* ── Grid columns (限时活动场) ──────────────────────────────────── */}
        <div>
          <div className="wol-section-title" style={{ padding: '0 0 10px' }}>
            限时活动场
          </div>
          <div className="wol-grid-2 wol-match-limited-grid">
            {LIMITED_BOARDS.map(board => (
              <MatchGridCard
                key={board.id}
                name={board.name}
                roleSummary={board.roleSummary}
                season={board.season}
                deadline={board.deadline}
                disabled
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default MatchSelection;
export { ROLE_COLORS, ROLE_SHORT, countRoles };
