import React from 'react';
import type { ShellView } from './GlobalShell';

interface Props {
  activeView: ShellView;
  onNavigate: (view: ShellView) => void;
}

/* ─── SVG Icons (inline — no external deps) ──────────────────────────── */

const HomeIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={active ? 'currentColor' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8}>
    <path d="M3 12l9-9 9 9" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 10v10a1 1 0 001 1h5v-5a1 1 0 011-1h2a1 1 0 011 1v5h4a1 1 0 001-1V10" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const FriendsIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={active ? 'currentColor' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8}>
    <circle cx="9" cy="7" r="3" strokeLinecap="round"/>
    <circle cx="17" cy="7" r="3" strokeLinecap="round"/>
    <path d="M5 21c0-4 2.5-6 4-6" strokeLinecap="round"/>
    <path d="M15 21c0-4-2.5-6-4-6" strokeLinecap="round"/>
    <path d="M19 21c0-4 2.5-6 4-6" strokeLinecap="round"/>
  </svg>
);

const VillageIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={active ? 'currentColor' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8}>
    <path d="M12 3L4 9v12h6v-6h4v6h6V9z" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 12h4" strokeLinecap="round"/>
    <circle cx="17" cy="5" r="1.5" fill={active ? 'currentColor' : 'none'} />
    <path d="M17 3.5v-2" strokeLinecap="round"/>
    <path d="M19.5 5h-2" strokeLinecap="round"/>
  </svg>
);

const ShopIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={active ? 'currentColor' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8}>
    <path d="M3 10l1 11h16l1-11" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 10h20" strokeLinecap="round"/>
    <path d="M7 10V7a5 5 0 0110 0v3" strokeLinecap="round"/>
    <path d="M9 14h2v6H9z" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14 14h2v6h-2z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ProfileIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={active ? 'currentColor' : 'currentColor'} strokeWidth={active ? 2.2 : 1.8}>
    <circle cx="12" cy="8" r="4" strokeLinecap="round"/>
    <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" strokeLinecap="round"/>
  </svg>
);

/* ─── Tab definitions ─────────────────────────────────────────────────── */

interface TabDef {
  view: ShellView;
  label: string;
  Icon: React.FC<{ active: boolean }>;
}

const TABS: TabDef[] = [
  { view: 'home',        label: '首页',   Icon: HomeIcon },
  { view: 'friends',     label: '好友',   Icon: FriendsIcon },
  { view: 'wolfvillage', label: '狼村',   Icon: VillageIcon },
  { view: 'shop',        label: '商店街', Icon: ShopIcon },
  { view: 'profile',     label: '我的',   Icon: ProfileIcon },
];

/* ─── Component ───────────────────────────────────────────────────────── */

const BottomNav: React.FC<Props> = ({ activeView, onNavigate }) => {
  return (
    <nav className="wol-bottom-nav" role="navigation" aria-label="主导航">
      {TABS.map(tab => {
        const isActive = activeView === tab.view;
        return (
          <button
            key={tab.view}
            type="button"
            className={`wol-nav-tab${isActive ? ' wol-nav-tab--active' : ''}`}
            onClick={() => onNavigate(tab.view)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
          >
            <tab.Icon active={isActive} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
