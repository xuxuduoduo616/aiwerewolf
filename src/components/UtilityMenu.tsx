import React from 'react';
import { ArrowLeft, Settings } from 'lucide-react';
import {
  LOBBY_FEATURE_MENU_ITEMS,
  type LobbyFeatureMenuItemId,
} from './LobbyFeatureMenu';

export type UtilityDestination = LobbyFeatureMenuItemId;

export const UTILITY_DESTINATIONS = LOBBY_FEATURE_MENU_ITEMS;

export const isUtilityDestination = (value: string): value is UtilityDestination =>
  UTILITY_DESTINATIONS.some(destination => destination.id === value);

interface UtilityMenuProps {
  onSelect: (destination: UtilityDestination) => void;
  onBack: () => void;
}

const UtilityMenu: React.FC<UtilityMenuProps> = ({ onSelect, onBack }) => (
  <main className="utility-page" aria-labelledby="utility-menu-title">
    <header className="app-page-header">
      <button className="app-page-back" type="button" onClick={onBack} aria-label="关闭功能菜单">
        <ArrowLeft aria-hidden="true" />
        <span>返回</span>
      </button>
      <div>
        <p className="app-page-kicker">狼村服务</p>
        <h1 id="utility-menu-title">功能菜单</h1>
      </div>
      <Settings aria-hidden="true" />
    </header>
    <nav className="utility-menu-grid" aria-label="功能菜单目的地">
      {UTILITY_DESTINATIONS.map(({ id, label, Icon }, index) => (
        <button type="button" key={id} onClick={() => onSelect(id)} autoFocus={index === 0}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  </main>
);

export default UtilityMenu;
