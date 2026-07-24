import React from 'react';

interface Props {
  name: string;
  roleSummary: string;
  season: string;
  deadline: string;
  onSelect?: () => void;
  disabled?: boolean;
}

const MatchGridCard: React.FC<Props> = ({ name, roleSummary, season, deadline, onSelect, disabled = false }) => {
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
      <div className="wol-break-text" style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 3 }}>
        {name}
      </div>

      {/* Role config */}
      <div className="wol-break-text" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
        {roleSummary}
      </div>

      {/* Bottom row: season + countdown */}
      <div className="wol-match-grid-meta">
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

  if (onSelect || disabled) {
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        className="wol-match-grid-card"
        disabled={disabled}
        title={disabled ? `${name}未开放` : name}
      >
        {cardContent}
        {disabled && <span className="wol-match-unavailable">未开放</span>}
      </button>
    );
  }

  return <div className="wol-match-grid-card">{cardContent}</div>;
};

export default MatchGridCard;
