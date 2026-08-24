import React from 'react';
import { ArrowLeft, LockKeyhole, RadioTower, ShieldCheck, UsersRound } from 'lucide-react';

interface Props {
  onBack: () => void;
}

const OnlineQualifierView: React.FC<Props> = ({ onBack }) => (
  <section className="economy-page qualifier-page" aria-labelledby="online-qualifier-title">
    <header className="economy-page-header">
      <button type="button" className="economy-icon-button" onClick={onBack} aria-label="Back to lobby">
        <ArrowLeft aria-hidden="true" />
      </button>
      <div><p className="economy-eyebrow">Information only</p><h1 id="online-qualifier-title">Online Qualifier</h1></div>
      <LockKeyhole aria-hidden="true" />
    </header>
    <div className="qualifier-ink-hero ink-panel">
      <RadioTower aria-hidden="true" />
      <div>
        <strong>Registration is unavailable</strong>
        <p>This page does not register players, create rooms, submit tournament data, or connect to live event services.</p>
      </div>
    </div>
    <div className="qualifier-facts">
      <article><UsersRound aria-hidden="true" /><h2>No live entrants</h2><p>No player list, bracket, matchmaking queue, or multiplayer room is connected.</p></article>
      <article><ShieldCheck aria-hidden="true" /><h2>No hidden request</h2><p>Opening or closing this page performs no account, wallet, tournament, or network mutation.</p></article>
    </div>
    <button type="button" className="economy-secondary-action" onClick={onBack}>Return to Lobby</button>
  </section>
);

export default OnlineQualifierView;
