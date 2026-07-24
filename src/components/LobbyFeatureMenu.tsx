import React from 'react';
import {
  ArrowLeft,
  Bell,
  HelpCircle,
  Headphones,
  Info,
  Mail,
  Settings,
  TicketCheck,
  UserRound,
} from 'lucide-react';
import '../styles/lobby-features.css';

export type LobbyFeatureMenuItemId =
  | 'settings'
  | 'announcements'
  | 'mail'
  | 'support'
  | 'help'
  | 'user-center'
  | 'redeem-code'
  | 'about';

interface MenuItem {
  id: LobbyFeatureMenuItemId;
  label: string;
  Icon: typeof Settings;
}

export const LOBBY_FEATURE_MENU_ITEMS: readonly MenuItem[] = [
  { id: 'settings', label: '设置', Icon: Settings },
  { id: 'announcements', label: '公告', Icon: Bell },
  { id: 'mail', label: '邮件', Icon: Mail },
  { id: 'support', label: '客服', Icon: Headphones },
  { id: 'help', label: '帮助', Icon: HelpCircle },
  { id: 'user-center', label: '用户中心', Icon: UserRound },
  { id: 'redeem-code', label: '兑换码', Icon: TicketCheck },
  { id: 'about', label: '关于游戏', Icon: Info },
] as const;

export interface LobbyFeatureMenuProps {
  onSelect: (itemId: LobbyFeatureMenuItemId) => void;
  disabledItems?: readonly LobbyFeatureMenuItemId[];
  onBack?: () => void;
}

const LobbyFeatureMenu: React.FC<LobbyFeatureMenuProps> = ({
  onSelect,
  disabledItems = [],
  onBack,
}) => (
  <main className="lobby-feature-page" aria-labelledby="lobby-feature-menu-title">
    <header className="lobby-feature-header">
      {onBack ? (
        <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="返回" title="返回">
          <ArrowLeft aria-hidden="true" />
        </button>
      ) : <span className="lobby-feature-header-spacer" />}
      <div>
        <h1 id="lobby-feature-menu-title">功能菜单</h1>
        <span className="lobby-feature-kicker">狼村服务</span>
      </div>
      <Settings className="lobby-feature-header-icon" aria-hidden="true" />
    </header>

    <section className="lobby-feature-menu-grid" aria-label="功能列表">
      {LOBBY_FEATURE_MENU_ITEMS.map(({ id, label, Icon }) => {
        const disabled = disabledItems.includes(id);
        return (
          <button
            className="lobby-feature-menu-item"
            type="button"
            key={id}
            disabled={disabled}
            onClick={() => onSelect(id)}
            title={disabled ? `${label}未开放` : label}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {disabled && <small>未开放</small>}
          </button>
        );
      })}
    </section>
  </main>
);

export default LobbyFeatureMenu;
