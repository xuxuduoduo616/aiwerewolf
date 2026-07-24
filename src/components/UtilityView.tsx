import React from 'react';
import { ArrowLeft, Languages } from 'lucide-react';
import { UTILITY_DESTINATIONS, type UtilityDestination } from './UtilityMenu';

interface UtilityContent {
  title: string;
  kicker: string;
  description: string;
  detail: string;
}

export const UTILITY_CONTENT: Record<UtilityDestination, UtilityContent> = {
  settings: {
    title: 'Settings',
    kicker: 'Device Preferences',
    description: 'Choose which speech translation to display on this device. Game rules and account assets do not change here.',
    detail: 'Audio and in-game options remain available in the game room.',
  },
  announcements: {
    title: 'Announcements',
    kicker: 'Local Notice Board',
    description: 'The current version offers single-player AI matches and a preview of the social roadmap.',
    detail: 'Live multiplayer rooms are not available yet.',
  },
  mail: {
    title: 'Mail',
    kicker: 'Message Preview',
    description: 'There is no mail to claim. This page does not connect to messaging services or issue real rewards.',
    detail: '0 unread messages',
  },
  support: {
    title: 'Support',
    kicker: 'Customer Service',
    description: 'Support tickets are not connected. Do not submit personal or payment information in this local preview.',
    detail: 'Service status: Preview',
  },
  help: {
    title: 'Help',
    kicker: 'Game Guide',
    description: 'Standard single-player supports 9- and 12-player boards at Beginner, Intermediate, and Expert difficulty.',
    detail: 'Choose Start Game and enter the match after final confirmation.',
  },
  'user-center': {
    title: 'User Center',
    kicker: 'Account Overview',
    description: 'Account details and local lobby progress are isolated by the current user.',
    detail: 'Profile editing and social management are not available yet.',
  },
  'redeem-code': {
    title: 'Redeem Code',
    kicker: 'Feature Preview',
    description: 'Redemption is not connected. This page does not write to the wallet, inventory, or server.',
    detail: 'Code redemption is unavailable.',
  },
  about: {
    title: 'About',
    kicker: 'AI Werewolf',
    description: 'A social deduction game where one human completes a Werewolf match with AI players.',
    detail: 'Current stage: Single-player AI matches and a social feature preview.',
  },
};

interface UtilityViewProps {
  destination: UtilityDestination;
  displayLanguage: 'zh' | 'en';
  onToggleLanguage: () => void;
  onBack: () => void;
}

const UtilityView: React.FC<UtilityViewProps> = ({
  destination,
  displayLanguage,
  onToggleLanguage,
  onBack,
}) => {
  const content = UTILITY_CONTENT[destination];
  const Icon = UTILITY_DESTINATIONS.find(item => item.id === destination)?.Icon;
  return (
    <main className="utility-page utility-detail" aria-labelledby="utility-view-title">
      <header className="app-page-header">
        <button className="app-page-back" type="button" onClick={onBack} aria-label="Return to utility menu" autoFocus>
          <ArrowLeft aria-hidden="true" />
          <span>Back</span>
        </button>
        <div>
          <p className="app-page-kicker">{content.kicker}</p>
          <h1 id="utility-view-title">{content.title}</h1>
        </div>
        {Icon && <Icon aria-hidden="true" />}
      </header>
      <section className="utility-detail-content">
        <p>{content.description}</p>
        <strong>{content.detail}</strong>
        {destination === 'settings' && (
          <button className="app-secondary-button" type="button" onClick={onToggleLanguage}>
            <Languages aria-hidden="true" />
            Speech display: {displayLanguage === 'zh' ? 'Chinese' : 'English'}
          </button>
        )}
        {destination === 'redeem-code' && (
          <div className="utility-redeem-preview">
            <label htmlFor="utility-redeem-code">Redeem Code</label>
            <input id="utility-redeem-code" value="" placeholder="Unavailable" disabled readOnly />
            <button type="button" disabled>Redemption Unavailable</button>
          </div>
        )}
      </section>
    </main>
  );
};

export default UtilityView;
