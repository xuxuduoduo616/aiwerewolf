import React from 'react';
import LobbySideMenus from './LobbySideMenus';
import LobbyActionButtons from './LobbyActionButtons';
import ActivityBanner from './ActivityBanner';

interface Props {
  onBuildRoom: () => void;
  onJoinRoom: () => void;
  onSpectate: () => void;
}

/* ─── SVG sub-components ──────────────────────────────────────────────── */

const GenderFemale = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="#f472b6" strokeWidth="1.6" style={{ width: 12, height: 12 }}>
    <circle cx="6" cy="6" r="4.5" strokeLinecap="round"/>
    <path d="M10 10l5 5" strokeLinecap="round"/>
    <path d="M13 11v4h-4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const LevelBadge = ({ level }: { level: number }) => (
  <div style={{
    position: 'absolute', bottom: -2, left: -2,
    width: 22, height: 22, borderRadius: '50%',
    background: 'linear-gradient(135deg, #c9a44b, #8b6914)',
    border: '2px solid #0d0d10',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 8, fontWeight: 900, color: '#fff',
    boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
  }}>
    {level}
  </div>
);

/* ─── Lobby Home ─────────────────────────────────────────────────────── */

const LobbyHome: React.FC<Props> = ({ onBuildRoom, onJoinRoom, onSpectate }) => {
  return (
    <div style={{ paddingBottom: 16, position: 'relative', minHeight: '100%' }}>
      {/* ── User Profile Panel (top-left) ───────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 12px 8px',
      }}>
        {/* Avatar */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
            border: '2px solid rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" style={{ width: 28, height: 28 }}>
              <circle cx="12" cy="8" r="4" strokeLinecap="round"/>
              <path d="M4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" strokeLinecap="round"/>
            </svg>
          </div>
          <LevelBadge level={10} />
        </div>

        {/* Name, title, rank */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>狼村旅人</span>
            <GenderFemale />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {/* Honor title */}
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: '#fbbf24',
              background: 'rgba(251,191,36,0.12)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 4, padding: '1px 6px',
            }}>
              真相洞悉
            </span>
            {/* Rank badge */}
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: '#c084fc',
              background: 'rgba(192,132,252,0.12)',
              border: '1px solid rgba(192,132,252,0.25)',
              borderRadius: 4, padding: '1px 6px',
              display: 'inline-flex', alignItems: 'center', gap: 2,
            }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 10, height: 10 }}>
                <path d="M8 2l2 4 4 .5-3 3 .5 4.5-3.5-2-3.5 2 .5-4.5-3-3 4-.5z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              二阶 5星
            </span>
          </div>
        </div>
      </div>

      {/* ── Side Menus & Character Showcase ──────────────────────────── */}
      <div style={{
        position: 'relative',
        display: 'flex',
        minHeight: 320,
        padding: '0 8px',
      }}>
        {/* Left sidebar */}
        <LobbySideMenus side="left" />

        {/* Center character showcase */}
        <div style={{
          flex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {/* Character silhouette placeholder */}
          <div style={{
            width: '70%', maxWidth: 220, aspectRatio: '3/4',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            {/* Stylized character silhouette */}
            <svg viewBox="0 0 100 140" fill="none" style={{ width: '60%', opacity: 0.15 }}>
              <ellipse cx="50" cy="30" rx="16" ry="18" stroke="white" strokeWidth="1.5"/>
              <path d="M20 130V90c0-10 5-18 15-25h30c10 7 15 15 15 25v40" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M8 55l12 10M92 55l-12 10" stroke="white" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            {/* Skin name label */}
            <div style={{
              position: 'absolute', bottom: 8,
              fontSize: 10, fontWeight: 600,
              color: 'rgba(255,255,255,0.35)',
            }}>
              默认时装
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <LobbySideMenus side="right" />
      </div>

      {/* ── Activity Banner Carousel ─────────────────────────────────── */}
      <div style={{ padding: '0 12px', marginTop: 4 }}>
        <ActivityBanner />
      </div>

      {/* ── Chat preview + Action buttons row ────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        padding: '12px',
        marginTop: 8,
      }}>
        {/* Lobby chat preview */}
        <div style={{
          flex: 1,
          minWidth: 0,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
          padding: '8px 10px',
          position: 'relative',
        }}>
          {/* Unread dot */}
          <div style={{
            position: 'absolute', top: 6, right: 8,
            width: 7, height: 7, borderRadius: '50%',
            background: '#ef4444',
            boxShadow: '0 0 4px rgba(239,68,68,0.6)',
          }} />
          <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
            大厅聊天
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', lineHeight: 1.5 }}>
            <div>夜行者：有人一起开黑吗？</div>
            <div style={{ marginTop: 1 }}>魔法少女：求带新手场~</div>
          </div>
        </div>

        {/* Action buttons */}
        <LobbyActionButtons
          onBuildRoom={onBuildRoom}
          onJoinRoom={onJoinRoom}
          onSpectate={onSpectate}
        />
      </div>
    </div>
  );
};

export default LobbyHome;
