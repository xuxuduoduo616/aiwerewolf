import React from 'react';
import type { ShellView } from './GlobalShell';

interface Props {
  side: 'left' | 'right';
  onNavigate: (view: ShellView) => void;
}

/* ─── SVG icons ───────────────────────────────────────────────────────── */

const ActivityIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 18, height: 18 }}>
    <path d="M12 2l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const FactionIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 18, height: 18 }}>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round"/>
    <circle cx="9" cy="7" r="4" strokeLinecap="round"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round"/>
  </svg>
);

const EntertainmentIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 18, height: 18 }}>
    <circle cx="12" cy="12" r="10" strokeLinecap="round"/>
    <path d="M8 12l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 18, height: 18 }}>
    <circle cx="5" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
  </svg>
);

const TaskIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 18, height: 18 }}>
    <rect x="3" y="3" width="18" height="18" rx="3" strokeLinecap="round"/>
    <path d="M8 12l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PassIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 18, height: 18 }}>
    <rect x="3" y="7" width="18" height="12" rx="2" strokeLinecap="round"/>
    <path d="M7 13l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const FirstChargeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 18, height: 18 }}>
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* ─── Menu definitions ────────────────────────────────────────────────── */

interface MenuItem {
  label: string;
  Icon: React.FC;
  hasRedDot?: boolean;
  targetView?: ShellView;
}

const LEFT_MENUS: MenuItem[] = [
  { label: '活动', Icon: ActivityIcon, hasRedDot: true, targetView: 'shop' },
  { label: '阵营应援', Icon: FactionIcon },
  { label: '限时娱乐', Icon: EntertainmentIcon, hasRedDot: true, targetView: 'wolfvillage' },
];

const RIGHT_MENUS: MenuItem[] = [
  { label: '功能菜单', Icon: MenuIcon },
  { label: '任务', Icon: TaskIcon, hasRedDot: true },
  { label: '通行证', Icon: PassIcon },
  { label: '首充', Icon: FirstChargeIcon, hasRedDot: true, targetView: 'shop' },
];

/* ─── Component ───────────────────────────────────────────────────────── */

const LobbySideMenus: React.FC<Props> = ({ side, onNavigate }) => {
  const menus = side === 'left' ? LEFT_MENUS : RIGHT_MENUS;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      justifyContent: 'center',
      padding: '0 2px',
      zIndex: 5,
    }}>
      {menus.map(item => (
        <button
          key={item.label}
          type="button"
          className="wol-icon-circle"
          style={{ position: 'relative' }}
          onClick={() => item.targetView ? onNavigate(item.targetView) : undefined}
          aria-label={item.label}
        >
          <item.Icon />
          <span style={{ fontSize: 8, lineHeight: 1.2 }}>{item.label}</span>
          {item.hasRedDot && (
            <div style={{
              position: 'absolute', top: 3, right: 5,
              width: 6, height: 6, borderRadius: '50%',
              background: '#ef4444',
              boxShadow: '0 0 4px rgba(239,68,68,0.5)',
            }} />
          )}
        </button>
      ))}
    </div>
  );
};

export default LobbySideMenus;
