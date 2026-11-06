import React from 'react';
import { ArrowRight, BookOpen, Moon, UserRound } from 'lucide-react';

interface Props {
  onStartGame: () => void;
  onOpenTutorial: () => void;
  identityName: string;
  identityHandle: string;
  isGuest: boolean;
  onSignIn: () => void;
}

const RefinedLobby: React.FC<Props> = ({
  onStartGame, onOpenTutorial, identityName, identityHandle, isGuest, onSignIn,
}) => (
  <section className="night-lobby" aria-labelledby="night-heading">
    <header className="night-lobby-identity" data-tour-target="identity">
      <div className="night-identity-copy">
        <UserRound size={18} aria-hidden="true" />
        <div><span className="night-eyebrow">Welcome to the village</span><p title={identityHandle}>{identityName}</p></div>
      </div>
      {isGuest && <button type="button" className="night-text-button" onClick={onSignIn}>Sign in or create account <ArrowRight size={15} aria-hidden="true" /></button>}
    </header>

    <div className="night-hero">
      <div className="night-hero-copy">
        <p className="night-eyebrow night-hero-eyebrow"><span /> A game of trust &amp; deception</p>
        <h1 id="night-heading" className="cinzel">Night falls.<br />Close your eyes.</h1>
        <p className="night-hero-description">A quiet village. A hidden pack.<br />Listen closely, question everyone, and survive the night.</p>
        <div className="night-hero-actions">
          <button type="button" className="wol-start-game night-start" onClick={onStartGame} data-tour-target="start-game">Start Game <ArrowRight size={19} aria-hidden="true" /></button>
          <button type="button" className="night-text-button night-guide" onClick={onOpenTutorial}><BookOpen size={17} aria-hidden="true" /> New-Player Guide</button>
        </div>
        <p className="night-match-note" data-tour-target="match-details">Single-player with AI <span aria-hidden="true">/</span> 9 or 12 players</p>
      </div>

      <div className="night-village-art" aria-hidden="true">
        <svg viewBox="0 0 360 420" fill="none">
          <circle cx="180" cy="150" r="112" stroke="currentColor" strokeOpacity=".11" />
          <circle cx="180" cy="150" r="90" stroke="currentColor" strokeOpacity=".06" />
          <path d="M202 93a50 50 0 1 0 22 83 54 54 0 0 1-22-83Z" fill="currentColor" fillOpacity=".65" />
          <path d="M30 340 80 295 123 330 180 272 236 320 285 288 335 340" stroke="currentColor" strokeOpacity=".2" />
          <path d="M58 340v-40l22-22 24 22v40m48 0v-66l28-31 28 31v66m50 0v-38l27-27 26 27v38" fill="#101012" stroke="currentColor" strokeOpacity=".3" />
          <path d="M180 243v-27m-8 8h16m-13 74h10v16h-10zm-99 10h9v12h-9zm204-1h10v13h-10z" stroke="currentColor" strokeOpacity=".3" />
          <path d="M28 356h304M77 374h206" stroke="currentColor" strokeOpacity=".1" />
        </svg>
        <span className="night-eyebrow">Shadows of the village</span>
      </div>
    </div>

    <footer className="night-lobby-footer">
      <p><Moon size={15} aria-hidden="true" /> One village. Many stories. Who do you believe?</p>
      <span>Deduction · Deception · Survival</span>
    </footer>
  </section>
);

export default RefinedLobby;
