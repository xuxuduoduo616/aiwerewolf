import React from 'react';
import type { ShellView } from './GlobalShell';
import { Castle, Home, Store, UserRound, UsersRound, type LucideIcon } from 'lucide-react';

interface Props {
  activeView: ShellView;
  onNavigate: (view: ShellView) => void;
}

/* ─── Tab definitions ─────────────────────────────────────────────────── */

interface TabDef {
  view: ShellView;
  label: string;
  Icon: LucideIcon;
}

const TABS: TabDef[] = [
  { view: 'home',        label: '首页',   Icon: Home },
  { view: 'friends',     label: '好友',   Icon: UsersRound },
  { view: 'wolfvillage', label: '狼村',   Icon: Castle },
  { view: 'shop',        label: '商店街', Icon: Store },
  { view: 'profile',     label: '我的',   Icon: UserRound },
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
            <tab.Icon aria-hidden="true" strokeWidth={isActive ? 2.2 : 1.8} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
