import React, { useState } from 'react';
import { ArrowRight, BookOpen, Moon } from 'lucide-react';
import type { SkinProduct } from '../economy/catalog';
import { getSkinPortraitUrl } from '../economy/skinAssets';
import type { LobbyBgmController } from '../hooks/useLobbyBgm';
import AccessibleDialog from './AccessibleDialog';
import LobbyBgmPlayer from './LobbyBgmPlayer';
import LobbyRoleBubbles from './LobbyRoleBubbles';
import LobbyVillageScene from './LobbyVillageScene';
import { WuxiaAvatar, type WuxiaAvatarFrame } from './WuxiaAvatar';

interface Props {
  equippedSkin?: SkinProduct | null;
  equippedFrame?: WuxiaAvatarFrame | null;
  onOpenWardrobe?: () => void;
  onOpenSkinStore?: () => void;
  onStartGame: () => void;
  onOpenTutorial: () => void;
  identityName: string;
  identityHandle: string;
  isGuest: boolean;
  onSignIn: () => void;
  bgm?: LobbyBgmController;
}

const FRAME_LABELS: Record<WuxiaAvatarFrame, string> = {
  'ink-ring': 'Ink Ring Frame',
  'crimson-moon': 'Crimson Moon Frame',
};

const RefinedLobby: React.FC<Props> = ({
  onStartGame,
  onOpenTutorial,
  identityName,
  identityHandle,
  isGuest,
  onSignIn,
  equippedSkin,
  equippedFrame,
  onOpenWardrobe,
  onOpenSkinStore,
  bgm,
}) => {
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const outfitTitle = equippedSkin ? equippedSkin.name : 'Default Outfit · Lone Wanderer';
  const tierLabel = equippedSkin
    ? `${equippedSkin.tier.charAt(0).toUpperCase()}${equippedSkin.tier.slice(1)} Wuxia Outfit`
    : 'Default Outfit';
  const frameLabel = equippedFrame ? FRAME_LABELS[equippedFrame] : 'Standard Ink Border';

  return (
    <section className="night-lobby" aria-labelledby="night-heading">
      <header className="night-lobby-header">
        <div className="night-lobby-identity" data-tour-target="identity">
          <button
            type="button"
            className="night-identity-trigger"
            onClick={() => setQuickPreviewOpen(true)}
            aria-label={`Inspect outfit for ${identityName || 'Village Traveler'}`}
          >
            <WuxiaAvatar skin={equippedSkin} frame={equippedFrame} size="md" alt="" />
            <span className="night-identity-text">
              <span className="night-eyebrow">Welcome to the village</span>
              <span className="night-identity-name" title={identityHandle}>{identityName}</span>
              <span className="night-identity-outfit">{outfitTitle}</span>
            </span>
          </button>
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

        <LobbyVillageScene equippedSkin={equippedSkin} onPreviewOutfit={() => setQuickPreviewOpen(true)} />
        <LobbyRoleBubbles />
      </div>

      <footer className="night-lobby-footer">
        <p><Moon size={15} aria-hidden="true" /> One village. Many stories. Who do you believe?</p>
        <span>Deduction · Deception · Survival</span>
      </footer>

      <AccessibleDialog
        open={quickPreviewOpen}
        onClose={() => setQuickPreviewOpen(false)}
        title={outfitTitle}
        description={`${tierLabel} · ${frameLabel}`}
        className="max-w-sm"
      >
        <div className="night-outfit-preview-dialog">
          <div className="night-outfit-preview-portrait">
            <img
              src={getSkinPortraitUrl(equippedSkin?.id)}
              alt={outfitTitle}
              decoding="async"
            />
          </div>
          <div className="night-outfit-preview-meta">
            <p className="night-outfit-preview-tier">{tierLabel}</p>
            <p className="night-outfit-preview-frame">{frameLabel}</p>
          </div>
          <div className="night-outfit-preview-actions">
            {onOpenWardrobe && (
              <button
                type="button"
                className="night-preview-btn night-preview-btn--primary"
                onClick={() => {
                  setQuickPreviewOpen(false);
                  onOpenWardrobe();
                }}
              >
                Open Wardrobe
              </button>
            )}
            {onOpenSkinStore && (
              <button
                type="button"
                className="night-preview-btn night-preview-btn--secondary"
                onClick={() => {
                  setQuickPreviewOpen(false);
                  onOpenSkinStore();
                }}
              >
                Visit Skin Store
              </button>
            )}
          </div>
        </div>
      </AccessibleDialog>
    </section>
  );
};

export default RefinedLobby;
