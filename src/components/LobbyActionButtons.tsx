import React from 'react';

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
  return (
    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
      {/* 建房 */}
      <button
        type="button"
        onClick={onBuildRoom}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          width: 62, height: 62,
          borderRadius: 14,
          background: 'rgba(201,164,75,0.15)',
          border: '1px solid rgba(201,164,75,0.3)',
          color: '#c9a44b',
          fontSize: 10, fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          transition: 'all 180ms ease',
        }}
      >
        <BuildIcon />
        <span>建房</span>
      </button>

      {/* 跟房 */}
      <button
        type="button"
        onClick={onJoinRoom}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          width: 62, height: 62,
          borderRadius: 14,
          background: 'rgba(59,140,110,0.12)',
          border: '1px solid rgba(59,140,110,0.3)',
          color: '#4ae0a6',
          fontSize: 10, fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          transition: 'all 180ms ease',
        }}
      >
        <JoinIcon />
        <span>跟房</span>
      </button>

      {/* 观战 */}
      <button
        type="button"
        onClick={onSpectate}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          width: 62, height: 62,
          borderRadius: 14,
          background: 'rgba(123,111,223,0.12)',
          border: '1px solid rgba(123,111,223,0.3)',
          color: '#a78bfa',
          fontSize: 10, fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          transition: 'all 180ms ease',
        }}
      >
        <SpectateIcon />
        <span>观战</span>
      </button>
    </div>
  );
};

export default LobbyActionButtons;
