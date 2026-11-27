import React from 'react';
import { ArrowRight, BookOpen, Moon, UserRound } from 'lucide-react';
import type { SkinProduct } from '../economy/catalog';
import type { LobbyBgmController } from '../hooks/useLobbyBgm';
import LobbyBgmPlayer from './LobbyBgmPlayer';
import LobbyRoleBubbles from './LobbyRoleBubbles';
import LobbyVillageScene from './LobbyVillageScene';

interface Props {
  equippedSkin?: SkinProduct | null;
  onStartGame: () => void;
  onOpenTutorial: () => void;
  identityName: string;
  identityHandle: string;
  isGuest: boolean;
  onSignIn: () => void;
  bgm?: LobbyBgmController;
}

const RefinedLobby: React.FC<Props> = ({
  onStartGame, onOpenTutorial, identityName, identityHandle, isGuest, onSignIn, equippedSkin, bgm,
}) => (
  <section className="night-lobby" aria-labelledby="night-heading">
    <header className="night-lobby-header">
      <div className="night-lobby-identity" data-tour-target="identity">
        <div className="night-identity-copy">
          <UserRound size={18} aria-hidden="true" />
          <div><span className="night-eyebrow">Welcome to the village</span><p title={identityHandle}>{identityName}</p></div>
        </div>
        {isGuest && (
          <button type="button" className="night-text-button night-signin-cta" onClick={onSignIn}>
            Sign in or create account <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <LobbyBgmPlayer bgm={bgm} />
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

      <LobbyVillageScene equippedSkin={equippedSkin} />
      <LobbyRoleBubbles />
    </div>

    <footer className="night-lobby-footer">
      <p><Moon size={15} aria-hidden="true" /> One village. Many stories. Who do you believe?</p>
      <span>Deduction · Deception · Survival</span>
    </footer>
  </section>
);

export default RefinedLobby;
