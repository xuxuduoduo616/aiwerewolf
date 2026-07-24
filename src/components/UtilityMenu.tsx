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
      <button className="app-page-back" type="button" onClick={onBack} aria-label="Close utility menu">
        <ArrowLeft aria-hidden="true" />
        <span>Back</span>
      </button>
      <div>
        <p className="app-page-kicker">Village Services</p>
        <h1 id="utility-menu-title">Utility Menu</h1>
      </div>
      <Settings aria-hidden="true" />
    </header>
    <nav className="utility-menu-grid" aria-label="Utility menu destinations">
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
