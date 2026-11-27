import React from 'react';
import { SKIN_CATALOG } from '../economy/catalog';
import { resolveSkinPresentation } from './SkinStore';
import SkinArtwork from './SkinArtwork';
import LobbyVillageScene from './LobbyVillageScene';
import type { UseEconomyResult } from '../hooks/useEconomy';

export interface SkinCollectionProps {
  economy?: Pick<UseEconomyResult, 'phase' | 'ledgerCorrupt' | 'mode' | 'state' | 'statusMessage' | 'refresh' | 'feedback' | 'mutationsDisabled' | 'pendingAction' | 'equipSkin'>;
  onOpenStore?: () => void;
}

/** The original outfit is inherent, never a purchasable inventory grant. */
const SkinCollectionPanel: React.FC<SkinCollectionProps> = ({ economy, onOpenStore }) => {
  const verified = economy?.phase === 'ready' && !economy.ledgerCorrupt;
  const isGuest = economy?.mode === 'guest';
  const owned = verified ? SKIN_CATALOG.filter(product =>
    economy.state.inventory.includes(`skin:${product.id}`)
    && (isGuest || economy.state.accountCatalog.some(item => item.id === product.id && item.itemKind === 'skin')),
  ) : [];
  const equippedId = verified ? economy.state.equippedSkinId : undefined;

  return (
    <section className="skin-collection" aria-label="Skin collection">
      <div className="skin-collection-heading">
        <div><h2>Your Skins</h2><p>{verified ? `${owned.length + 1} owned · including Default Outfit` : 'Default Outfit is always yours.'}</p></div>
        {onOpenStore && <button type="button" className="economy-secondary-action" onClick={onOpenStore}>Visit Skin Store</button>}
      </div>
      {!verified && <div className="economy-unavailable" role="status">
        <p>{economy?.statusMessage || 'Loading verified skin collection…'}</p>
        {economy && <button type="button" className="economy-secondary-action" onClick={() => { void economy.refresh(); }}>Refresh Collection</button>}
      </div>}
      <p className="economy-live-feedback" role="status" aria-live="polite">{economy?.feedback}</p>
      <div className="skin-grid">
        <article className={`skin-card${equippedId === null ? ' is-equipped' : ''}`} data-owned-skin="default">
          <div className="skin-card-art skin-collection-default"><LobbyVillageScene variant="card" /></div>
          <div className="skin-card-heading"><span>Original · Permanent</span><h3>Default Outfit</h3><p>Your original village traveler. Always included in your collection.</p></div>
          <div className="skin-card-state"><span className="skin-status">{equippedId === null ? 'Equipped' : 'Owned'}</span><strong>Free · Always owned</strong></div>
        </article>
        {owned.map(product => {
          const presentation = resolveSkinPresentation(product, Boolean(isGuest), economy?.state.accountCatalog.find(item => item.id === product.id));
          const equipped = equippedId === product.id;
          return (
            <article key={product.id} className={`skin-card${equipped ? ' is-equipped' : ''}`} data-owned-skin={product.id}>
              <div className="skin-card-art"><SkinArtwork product={{ ...product, name: presentation.name }} /></div>
              <div className="skin-card-heading"><span>{presentation.tier} · {product.season === 'tidal' ? 'Tidal Season' : 'Core Collection'}</span><h3>{presentation.name}</h3><p>{product.description}</p></div>
              <div className="skin-card-state"><span className="skin-status">{equipped ? 'Equipped' : 'Owned'}</span><strong>Permanent</strong></div>
              <div className="skin-card-actions">
                <button type="button" className="skin-primary-action" disabled={equipped || economy?.mutationsDisabled || economy?.pendingAction !== null}
                  onClick={() => { void economy?.equipSkin(product.id); }} aria-label={`Equip ${presentation.name}`}>
                  {equipped ? 'Equipped' : economy?.pendingAction === 'equip_skin' ? 'Verifying Equip…' : 'Equip in Lobby'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {verified && owned.length === 0 && <p className="skin-collection-note">Earn Coins with Daily Check-In, then unlock a skin in the store. Your skins will appear here.</p>}
    </section>
  );
};

export default SkinCollectionPanel;
