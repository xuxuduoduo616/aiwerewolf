import React, { useState } from 'react';

interface Props {
  onBuildRoom: () => void;
  onJoinRoom: () => void;
  onSpectate: () => void;
}

const BuildIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 20, height: 20 }}>
    <path d="M3 10l1 11h16l1-11" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 10h20" strokeLinecap="round"/>
    <path d="M7 10V7a5 5 0 0110 0v3" strokeLinecap="round"/>
  </svg>
);

const JoinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 20, height: 20 }}>
    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13 12H3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SpectateIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 20, height: 20 }}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round"/>
    <circle cx="12" cy="12" r="3" strokeLinecap="round"/>
  </svg>
);

const LobbyActionButtons: React.FC<Props> = ({ onBuildRoom, onJoinRoom, onSpectate }) => {
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  const btnStyle = (color: string, bgRgb: string) => ({
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center' as const, gap: 4,
    width: 62, height: 62,
    borderRadius: 14,
    background: hoveredBtn === color ? `rgba(${bgRgb},0.22)` : `rgba(${bgRgb},0.12)`,
    border: hoveredBtn === color ? `1px solid rgba(${bgRgb},0.5)` : `1px solid rgba(${bgRgb},0.3)`,
    color: hoveredBtn === color ? '#fff' : color,
    fontSize: 10, fontWeight: 700 as const,
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    transition: 'all 180ms ease',
  });

  return (
    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
      {/* 建房 */}
      <button
        type="button"
        onClick={onBuildRoom}
        onMouseEnter={() => setHoveredBtn('#c9a44b')}
        onMouseLeave={() => setHoveredBtn(null)}
        style={btnStyle('#c9a44b', '201,164,75')}
      >
        <BuildIcon />
        <span>建房</span>
      </button>

      {/* 跟房 */}
      <button
        type="button"
        onClick={onJoinRoom}
        onMouseEnter={() => setHoveredBtn('#4ae0a6')}
        onMouseLeave={() => setHoveredBtn(null)}
        style={btnStyle('#4ae0a6', '74,224,166')}
      >
        <JoinIcon />
        <span>跟房</span>
      </button>

      {/* 观战 */}
      <button
        type="button"
        onClick={onSpectate}
        onMouseEnter={() => setHoveredBtn('#a78bfa')}
        onMouseLeave={() => setHoveredBtn(null)}
        style={btnStyle('#a78bfa', '167,139,250')}
      >
        <SpectateIcon />
        <span>观战</span>
      </button>
    </div>
  );
};

export default LobbyActionButtons;
