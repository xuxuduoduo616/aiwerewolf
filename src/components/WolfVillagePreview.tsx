import React from 'react';
import {
  ArrowLeft,
  Bot,
  DoorOpen,
  Eye,
  Home,
  Lock,
  MessageSquare,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import '../styles/lobby-features.css';

export interface WolfVillagePreviewProps {
  onBack?: () => void;
}

const VILLAGE_SOCIAL_PREVIEWS: readonly {
  title: string;
  status: string;
  Icon: LucideIcon;
}[] = [
  { title: 'Add Friends', status: 'Friend entry preview', Icon: UserPlus },
  { title: 'Message Center', status: 'Direct message and notification preview', Icon: MessageSquare },
  { title: 'Create Village', status: 'Community creation preview', Icon: Home },
  { title: 'Join Village', status: 'Community joining preview', Icon: DoorOpen },
] as const;

const WolfVillagePreview: React.FC<WolfVillagePreviewProps> = ({ onBack }) => (
  <main className="lobby-feature-page" aria-labelledby="wolf-village-title">
    <header className="lobby-feature-header">
      {onBack ? (
        <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft aria-hidden="true" />
        </button>
      ) : <span className="lobby-feature-header-spacer" />}
      <div>
        <h1 id="wolf-village-title">Wolf Village</h1>
        <span className="lobby-feature-kicker">Social Roadmap Preview</span>
      </div>
      <Home className="lobby-feature-header-icon" aria-hidden="true" />
    </header>

    <div className="lobby-feature-status" role="status">
      <Bot aria-hidden="true" />
      <span>Only single-player AI matches are available. The features below are social previews.</span>
    </div>

    <div className="lobby-feature-section-heading">
      <h2>Social Feature Preview</h2>
      <span>Services are not connected</span>
    </div>
    <section className="lobby-village-social-grid" aria-label="Wolf Village social feature preview">
      {VILLAGE_SOCIAL_PREVIEWS.map(({ title, status, Icon }) => (
        <article className="lobby-feature-card lobby-village-social-preview" key={title}>
          <Icon aria-hidden="true" />
          <div><h3>{title}</h3><span>{status}</span></div>
          <button type="button" disabled><Lock aria-hidden="true" />Preview</button>
        </article>
      ))}
    </section>

    <div className="lobby-feature-section-heading lobby-village-room-heading">
      <h2>Live Multiplayer Rooms</h2>
      <span>Future stage</span>
    </div>

    <section className="lobby-village-room-actions" aria-label="Multiplayer room actions">
      <button type="button" disabled title="Multiplayer rooms are unavailable"><Home aria-hidden="true" />Create<span>Unavailable</span></button>
      <button type="button" disabled title="Multiplayer rooms are unavailable"><Users aria-hidden="true" />Join<span>Unavailable</span></button>
      <button type="button" disabled title="Multiplayer rooms are unavailable"><Eye aria-hidden="true" />Spectate<span>Unavailable</span></button>
    </section>

    <div className="lobby-feature-status lobby-village-disabled-status" role="status">
      <Lock aria-hidden="true" />
      <span>This page does not create rooms or connect to live matches.</span>
    </div>
  </main>
);

export default WolfVillagePreview;
