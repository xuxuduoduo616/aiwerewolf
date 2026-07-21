import React, { useState } from 'react';
import FilterChipBar from './FilterChipBar';

/* ─── Hardcoded test outfit data ──────────────────────────────────────── */

interface Outfit {
  id: string;
  name: string;
  quality: 'common' | 'advanced' | 'rare' | 'epic' | 'legendary';
  status: string;
  owned: boolean;
}

const OUTFITS: Outfit[] = [
  { id: 'default', name: '默认时装', quality: 'common', status: '永久拥有', owned: true },
  { id: 'launch', name: '新服盛典限定时装', quality: 'advanced', status: '永久拥有', owned: true },
];

const QUALITY_LABELS: Record<string, string> = {
  common: '普通',
  advanced: '高级',
  rare: '稀有',
  epic: '极品',
  legendary: '传说',
};

type FilterKey = 'my' | 'common' | 'advanced' | 'rare' | 'epic';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'my', label: '我的' },
  { key: 'common', label: '普通' },
  { key: 'advanced', label: '高级' },
  { key: 'rare', label: '稀有' },
  { key: 'epic', label: '极品' },
];

const OutfitsPanel: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('my');
  const [selectedOutfit, setSelectedOutfit] = useState<string>('default');

  return (
    <div>
      {/* ── Fitting room preview ──────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 12,
        padding: '16px 12px',
      }}>
        {/* Character preview */}
        <div style={{
          flex: 1,
          minHeight: 200,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005))',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {/* Character silhouette placeholder */}
          <svg viewBox="0 0 60 100" fill="none" style={{ width: 60, opacity: 0.12 }}>
            <ellipse cx="30" cy="22" rx="12" ry="13" stroke="white" strokeWidth="1.5"/>
            <path d="M12 90V62c0-7 4-13 10-18h16c6 5 10 11 10 18v28" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M4 38l8 7M56 38l-8 7" stroke="white" strokeWidth="1" strokeLinecap="round"/>
          </svg>

          {/* Selected outfit name */}
          <div style={{
            position: 'absolute', bottom: 8,
            fontSize: 10, fontWeight: 600,
            color: 'rgba(255,255,255,0.35)',
          }}>
            {OUTFITS.find(o => o.id === selectedOutfit)?.name || '默认时装'}
          </div>
        </div>

        {/* Equipped status */}
        <div style={{
          flexShrink: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          padding: '8px 0',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(74,224,160,0.12)',
            border: '2px solid rgba(74,224,160,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#4ae0a6" strokeWidth="2.5" style={{ width: 20, height: 20 }}>
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontSize: 9, fontWeight: 600, color: '#4ae0a6' }}>已穿戴</span>
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <FilterChipBar chips={FILTERS} active={activeFilter} onSelect={setActiveFilter} />

      {/* ── Outfit grid ───────────────────────────────────────────── */}
      <div style={{ padding: '0 12px' }}>
        <div className="wol-grid-3">
          {OUTFITS.map(outfit => {
            const isSelected = selectedOutfit === outfit.id;
            return (
              <button
                key={outfit.id}
                type="button"
                onClick={() => setSelectedOutfit(outfit.id)}
                style={{
                  display: 'flex', flexDirection: 'column',
                  background: 'rgba(22,22,28,0.94)',
                  border: isSelected
                    ? '2px solid rgba(201,164,75,0.7)'
                    : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 10,
                  padding: '10px 8px',
                  cursor: 'pointer',
                  transition: 'all 180ms ease',
                  boxShadow: isSelected ? '0 0 12px rgba(201,164,75,0.15)' : 'none',
                }}
              >
                {/* Outfit icon placeholder */}
                <div style={{
                  width: '100%', aspectRatio: '1/1',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 8,
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" style={{ width: 24, height: 24 }}>
                    <path d="M12 2l3 7h7l-5 4 2 7-7-4-7 4 2-7-5-4h7z" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>

                {/* Name */}
                <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 4, textAlign: 'center' }}>
                  {outfit.name}
                </div>

                {/* Quality badge */}
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <span className={`wol-quality wol-quality--${outfit.quality}`}>
                    {QUALITY_LABELS[outfit.quality]}
                  </span>
                </div>

                {/* Status */}
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
                  {outfit.status}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default OutfitsPanel;
