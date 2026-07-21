import React, { useState } from 'react';
import FilterChipBar from './FilterChipBar';

/* ─── SVG icons ───────────────────────────────────────────────────────── */

const ChevronRight = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ─── Hardcoded skin collection data ──────────────────────────────────── */

interface SkinSet {
  id: string;
  name: string;
  category: 'classic' | 'season' | 'crossover';
  owned: number;
  total: number;
  color: string;
}

const SKIN_SETS: SkinSet[] = [
  { id: 's1', name: '狼村传说', category: 'classic', owned: 0, total: 25, color: '#c9a44b' },
  { id: 's2', name: '月下魅影', category: 'classic', owned: 0, total: 18, color: '#7b6fdf' },
  { id: 's3', name: '逐浪季限定', category: 'season', owned: 0, total: 12, color: '#3b82f6' },
  { id: 's4', name: '冬雪季限定', category: 'season', owned: 0, total: 10, color: '#60a5fa' },
  { id: 's5', name: '国风联名', category: 'crossover', owned: 0, total: 20, color: '#f59e0b' },
];

type SkinTab = 'classic' | 'season' | 'crossover';

const SKIN_TABS: { key: SkinTab; label: string }[] = [
  { key: 'classic', label: '典藏皮肤' },
  { key: 'season', label: '主题季皮肤' },
  { key: 'crossover', label: '联动皮肤' },
];

const SkinCollectionPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SkinTab>('classic');
  const totalOwned = 0;
  const totalSkins = 137;
  const totalThemes = 8;

  return (
    <div>
      {/* Progress header */}
      <div style={{
        padding: '12px 12px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600,
      }}>
        <span>已集齐主题: {totalOwned}/{totalThemes}</span>
        <span>全部皮肤: {totalOwned}/{totalSkins}</span>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 12px', marginBottom: 12 }}>
        <div className="wol-progress-bar" style={{ height: 6 }}>
          <div
            className="wol-progress-bar-fill"
            style={{ width: `${(totalOwned / totalSkins) * 100}%`, height: 6 }}
          />
        </div>
      </div>

      {/* Sub-category tabs */}
      <FilterChipBar chips={SKIN_TABS} active={activeTab} onSelect={setActiveTab} />

      {/* Banner stream */}
      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SKIN_SETS.map(set => {
          const pct = Math.round((set.owned / set.total) * 100);
          return (
            <div
              key={set.id}
              style={{
                display: 'flex', gap: 12,
                background: 'rgba(22,22,28,0.94)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: '12px',
                alignItems: 'center',
              }}
            >
              {/* Thumbnail placeholder */}
              <div style={{
                width: 64, height: 64, borderRadius: 10,
                background: `linear-gradient(135deg, ${set.color}18, ${set.color}06)`,
                border: `1px solid ${set.color}20`,
                flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg viewBox="0 0 24 24" fill="none" stroke={set.color} strokeWidth="1" style={{ width: 24, height: 24, opacity: 0.4 }}>
                  <path d="M12 2l3 7h7l-5 4 2 7-7-4-7 4 2-7-5-4h7z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
                  {set.name}
                </div>
                <div className="wol-progress-bar" style={{ marginBottom: 4 }}>
                  <div
                    className="wol-progress-bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                    {set.owned}/{set.total}
                  </span>
                  <button
                    type="button"
                    onClick={() => { /* Navigate to skin detail */ }}
                    style={{
                      fontSize: 10, fontWeight: 600,
                      color: 'rgba(255,255,255,0.4)',
                      display: 'inline-flex', alignItems: 'center', gap: 2,
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    }}
                    aria-label={`${set.name} 详情`}
                  >
                    详情<ChevronRight />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SkinCollectionPanel;
