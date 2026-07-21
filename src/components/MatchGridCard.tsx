import React, { useState } from 'react';

interface Props {
  name: string;
  roleSummary: string;
  season: string;
  deadline: string;
  onSelect?: () => void;
}

const MatchGridCard: React.FC<Props> = ({ name, roleSummary, season, deadline, onSelect }) => {
  const [hovered, setHovered] = useState(false);

  const cardContent = (
    <>
      {/* Top: character placeholder */}
      <div style={{
        width: '100%', aspectRatio: '4/3',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10,
      }}>
        <svg viewBox="0 0 40 60" fill="none" style={{ width: 28, opacity: 0.1 }}>
          <ellipse cx="20" cy="14" rx="8" ry="9" stroke="white" strokeWidth="1"/>
          <path d="M8 56V40c0-5 3-9 7-12h10c4 3 7 7 7 12v16" stroke="white" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      </div>

      {/* Board name */}
      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 3 }}>
        {name}
      </div>

      {/* Role config */}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
        {roleSummary}
      </div>

      {/* Bottom row: season + countdown */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: '#fbbf24',
          background: 'rgba(251,191,36,0.12)',
          border: '1px solid rgba(251,191,36,0.2)',
          borderRadius: 4, padding: '1px 6px',
        }}>
          {season}
        </span>
        <span className="wol-countdown">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 10, height: 10 }}>
            <circle cx="8" cy="8" r="6.5" strokeLinecap="round"/>
            <path d="M8 4.5V8l3 2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {deadline}
        </span>
      </div>
    </>
  );

  const sharedStyle: React.CSSProperties = {
    background: hovered ? 'rgba(30,30,40,0.94)' : 'rgba(22,22,28,0.94)',
    border: hovered ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
    transition: 'all 180ms ease',
    transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
    boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.3)' : 'none',
    textAlign: 'left',
    width: '100%',
  };

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={sharedStyle}
      >
        {cardContent}
      </button>
    );
  }

  return <div style={sharedStyle}>{cardContent}</div>;
};

export default MatchGridCard;
