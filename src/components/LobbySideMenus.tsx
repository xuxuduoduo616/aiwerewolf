import React from 'react';
import type { ShellView } from './GlobalShell';
import {
  BadgeCheck,
  Gamepad2,
  ListChecks,
  MoreHorizontal,
  Sparkles,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

interface Props {
  side: 'left' | 'right';
  onNavigate: (view: ShellView) => void;
}

/* ─── Menu definitions ────────────────────────────────────────────────── */

interface MenuItem {
  label: string;
  Icon: LucideIcon;
  hasRedDot?: boolean;
  targetView?: ShellView;
}

const LEFT_MENUS: MenuItem[] = [
  { label: '活动', Icon: Sparkles, hasRedDot: true, targetView: 'shop' },
  { label: '阵营应援', Icon: UsersRound },
  { label: '限时娱乐', Icon: Gamepad2, hasRedDot: true, targetView: 'wolfvillage' },
];

const RIGHT_MENUS: MenuItem[] = [
  { label: '功能菜单', Icon: MoreHorizontal },
  { label: '任务', Icon: ListChecks, hasRedDot: true },
  { label: '通行证', Icon: BadgeCheck },
  { label: '首充', Icon: Zap, hasRedDot: true, targetView: 'shop' },
];

/* ─── Component ───────────────────────────────────────────────────────── */

const LobbySideMenus: React.FC<Props> = ({ side, onNavigate }) => {
  const menus = side === 'left' ? LEFT_MENUS : RIGHT_MENUS;

  return (
    <div className={`wol-side-menu wol-side-menu--${side}`} style={{
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
          <item.Icon aria-hidden="true" />
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
