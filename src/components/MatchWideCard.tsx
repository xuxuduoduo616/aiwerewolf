import React from 'react';
import type { GameConfig, Role } from '../types';
import { ROLE_COLORS, ROLE_SHORT } from './MatchSelection';

interface Props {
  config: GameConfig;
  roleCounts: { role: Role; count: number }[];
  onSelect: () => void;
}

const MatchWideCard: React.FC<Props> = ({ config, roleCounts, onSelect }) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        width: '100%',
        textAlign: 'left',
        background: 'rgba(22,22,28,0.94)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: '14px',
        cursor: 'pointer',
        transition: 'all 180ms ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            {config.displayName}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>
            {config.description.length > 40 ? config.description.slice(0, 40) + '...' : config.description}
          </div>
        </div>

        {/* Role badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {roleCounts.map(({ role, count }) => (
            <div
              key={role}
              style={{
                display: 'flex', alignItems: 'center', gap: 2,
                fontSize: 9, fontWeight: 700,
                color: ROLE_COLORS[role] || '#a1a1aa',
                background: `${ROLE_COLORS[role] || '#a1a1aa'}15`,
                border: `1px solid ${ROLE_COLORS[role] || '#a1a1aa'}25`,
                borderRadius: 6, padding: '2px 6px',
              }}
            >
              {count > 1 && (
                <span style={{
                  fontSize: 8, fontWeight: 900,
                  color: '#fff', marginRight: 1,
                }}>
                  {count}
                </span>
              )}
              {ROLE_SHORT[role] || role}
            </div>
          ))}
        </div>

        {/* Season tag */}
        <div style={{ marginTop: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: 4, padding: '1px 6px',
          }}>
            逐浪季
          </span>
        </div>
      </div>

      {/* Right: character illustration placeholder */}
      <div style={{
        flexShrink: 0, width: 80, marginLeft: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 70, height: 90,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg viewBox="0 0 40 60" fill="none" style={{ width: 32, opacity: 0.12 }}>
            <ellipse cx="20" cy="14" rx="8" ry="9" stroke="white" strokeWidth="1"/>
            <path d="M8 56V40c0-5 3-9 7-12h10c4 3 7 7 7 12v16" stroke="white" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </button>
  );
};

export default MatchWideCard;
