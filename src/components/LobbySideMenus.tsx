import React from 'react';
import type { ShellView } from './GlobalShell';
import type { LobbySubview } from '../lobbyFeatures';
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

type SideMenuLobbySubview = Extract<LobbySubview, 'activity' | 'faction-support' | 'battle-pass'>;

export type LobbySideMenuAction =
  | { type: 'shell'; view: ShellView }
  | { type: 'lobby'; subview: SideMenuLobbySubview }
  | { type: 'utility' };

export interface LobbySideMenuHandlers {
  onNavigate: (view: ShellView) => void;
  onOpenSubview: (subview: SideMenuLobbySubview) => void;
  onOpenUtilityMenu: () => void;
}

interface Props extends LobbySideMenuHandlers {
  side: 'left' | 'right';
}

/* ─── Menu definitions ────────────────────────────────────────────────── */

interface MenuItemBase {
  label: string;
  Icon: LucideIcon;
  hasRedDot?: boolean;
}

export type LobbySideMenuItem = MenuItemBase & (
  | { action: LobbySideMenuAction; disabled?: false; unavailableLabel?: never }
  | { action?: never; disabled: true; unavailableLabel: string }
);

export const LEFT_MENUS: readonly LobbySideMenuItem[] = [
  { label: 'Activities', Icon: Sparkles, hasRedDot: true, action: { type: 'lobby', subview: 'activity' } },
  { label: 'Faction Support', Icon: UsersRound, action: { type: 'lobby', subview: 'faction-support' } },
  { label: 'Limited Events', Icon: Gamepad2, hasRedDot: true, action: { type: 'shell', view: 'wolfvillage' } },
];

export const RIGHT_MENUS: readonly LobbySideMenuItem[] = [
  { label: 'Utility Menu', Icon: MoreHorizontal, action: { type: 'utility' } },
  { label: 'Tasks', Icon: ListChecks, disabled: true, unavailableLabel: 'Unavailable' },
  { label: 'Battle Pass', Icon: BadgeCheck, action: { type: 'lobby', subview: 'battle-pass' } },
  { label: 'First Purchase', Icon: Zap, hasRedDot: true, action: { type: 'shell', view: 'shop' } },
];

export const activateLobbySideMenuItem = (
  item: LobbySideMenuItem,
  handlers: LobbySideMenuHandlers,
): boolean => {
  if (item.disabled) return false;

  if (item.action.type === 'shell') handlers.onNavigate(item.action.view);
  if (item.action.type === 'lobby') handlers.onOpenSubview(item.action.subview);
  if (item.action.type === 'utility') handlers.onOpenUtilityMenu();
  return true;
};

/* ─── Component ───────────────────────────────────────────────────────── */

const LobbySideMenus: React.FC<Props> = ({
  side,
  onNavigate,
  onOpenSubview,
  onOpenUtilityMenu,
}) => {
  const menus = side === 'left' ? LEFT_MENUS : RIGHT_MENUS;
  const handlers = { onNavigate, onOpenSubview, onOpenUtilityMenu };

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
          style={{
            position: 'relative',
            opacity: item.disabled ? 0.48 : undefined,
            cursor: item.disabled ? 'not-allowed' : undefined,
          }}
          onClick={item.disabled ? undefined : () => activateLobbySideMenuItem(item, handlers)}
          disabled={item.disabled}
          aria-label={item.disabled ? `${item.label}, ${item.unavailableLabel}` : item.label}
          title={item.disabled ? `${item.label}: ${item.unavailableLabel}` : item.label}
        >
          <item.Icon aria-hidden="true" />
          <span style={{ fontSize: 8, lineHeight: 1.2 }}>{item.label}</span>
          {item.disabled && (
            <small style={{ fontSize: 7, lineHeight: 1.1 }}>{item.unavailableLabel}</small>
          )}
          {item.hasRedDot && (
            <span aria-hidden="true" style={{
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
