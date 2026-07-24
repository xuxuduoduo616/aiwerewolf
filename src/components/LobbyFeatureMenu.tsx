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
  { id: 'settings', label: 'Settings', Icon: Settings },
  { id: 'announcements', label: 'Announcements', Icon: Bell },
  { id: 'mail', label: 'Mail', Icon: Mail },
  { id: 'support', label: 'Support', Icon: Headphones },
  { id: 'help', label: 'Help', Icon: HelpCircle },
  { id: 'user-center', label: 'User Center', Icon: UserRound },
  { id: 'redeem-code', label: 'Redeem Code', Icon: TicketCheck },
  { id: 'about', label: 'About', Icon: Info },
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
        <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft aria-hidden="true" />
        </button>
      ) : <span className="lobby-feature-header-spacer" />}
      <div>
        <h1 id="lobby-feature-menu-title">Utility Menu</h1>
        <span className="lobby-feature-kicker">Village Services</span>
      </div>
      <Settings className="lobby-feature-header-icon" aria-hidden="true" />
    </header>

    <section className="lobby-feature-menu-grid" aria-label="Utility list">
      {LOBBY_FEATURE_MENU_ITEMS.map(({ id, label, Icon }) => {
        const disabled = disabledItems.includes(id);
        return (
          <button
            className="lobby-feature-menu-item"
            type="button"
            key={id}
            disabled={disabled}
            onClick={() => onSelect(id)}
            title={disabled ? `${label} is unavailable` : label}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {disabled && <small>Unavailable</small>}
          </button>
        );
      })}
    </section>
  </main>
);

export default LobbyFeatureMenu;
