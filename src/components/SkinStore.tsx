import React, { useMemo, useState } from 'react';
import { Check, Eye, History, LockKeyhole, Sparkles } from 'lucide-react';
import AccessibleDialog from './AccessibleDialog';
import EconomyBalances from './EconomyBalances';
import SkinArtwork from './SkinArtwork';
import { SKIN_CATALOG, type SkinProduct } from '../economy/catalog';
import type { EconomyMutationResult, GuestEconomyState } from '../economy/ledger';
import { ACCOUNT_ECONOMY_UNAVAILABLE } from '../hooks/useGuestEconomy';

export type SkinStoreFilter = 'all' | 'tidal' | 'basic' | 'premium';

interface Props {
  state: GuestEconomyState;
  coins: number;
  crystals: number;
  isGuest: boolean;
  ledgerCorrupt: boolean;
  filter: SkinStoreFilter;
  feedback: string;
  onFilterChange: (filter: SkinStoreFilter) => void;
  onUnlock: (skinId: string) => EconomyMutationResult;
  onEquip: (skinId: string) => EconomyMutationResult;
  onOpenHistory: () => void;
}

const FILTERS: readonly { id: SkinStoreFilter; label: string }[] = [
  { id: 'all', label: 'All Skins' },
  { id: 'tidal', label: 'Tidal Season' },
  { id: 'basic', label: 'Basic · Coins' },
  { id: 'premium', label: 'Premium · Crystals' },
];

const productMatchesFilter = (product: SkinProduct, filter: SkinStoreFilter): boolean => {
  if (filter === 'tidal') return product.season === 'tidal';
  if (filter === 'basic') return product.tier === 'Basic';
  if (filter === 'premium') return product.tier === 'Premium';
  return true;
};

const SkinStore: React.FC<Props> = ({
  state,
  coins,
  crystals,
  isGuest,
  ledgerCorrupt,
  filter,
  feedback,
  onFilterChange,
  onUnlock,
  onEquip,
  onOpenHistory,
}) => {
  const [preview, setPreview] = useState<SkinProduct | null>(null);
  const visibleProducts = useMemo(
    () => SKIN_CATALOG.filter(product => productMatchesFilter(product, filter)),
    [filter],
  );
  const mutationUnavailable = !isGuest || ledgerCorrupt;
  const unavailableMessage = !isGuest
    ? ACCOUNT_ECONOMY_UNAVAILABLE
    : ledgerCorrupt
      ? 'Local economy data could not be verified. Unlock and equip actions are disabled without changing stored data.'
      : '';

  return (
    <section className="skin-store" aria-labelledby="skin-store-title">
      <div className="skin-store-hero ink-panel">
        <div>
          <p className="economy-eyebrow">Original ink-wash cosmetics</p>
          <h1 id="skin-store-title">Wuxia Skin Store</h1>
          <p>Cosmetic presentation only. Skins never change rules, AI decisions, rewards, hit areas, or hidden information.</p>
        </div>
        <Sparkles aria-hidden="true" />
      </div>

      <div className="skin-store-toolbar">
        <EconomyBalances coins={coins} crystals={crystals} compact />
        <button type="button" className="economy-icon-button" onClick={onOpenHistory} aria-label="Open economy history">
          <History aria-hidden="true" />
        </button>
      </div>

      <div className="skin-store-filters" role="group" aria-label="Filter cosmetics">
        {FILTERS.map(option => (
          <button
            key={option.id}
            type="button"
            className={filter === option.id ? 'is-active' : ''}
            aria-pressed={filter === option.id}
            onClick={() => onFilterChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {unavailableMessage && <p className="economy-unavailable" role="status">{unavailableMessage}</p>}
      <p className="economy-live-feedback" role="status" aria-live="polite">{feedback}</p>

      <div className="skin-grid">
        {visibleProducts.map(product => {
          const owned = state.inventory.includes(`skin:${product.id}`);
          const equipped = state.equippedSkinId === product.id;
          const balance = product.currency === 'coins' ? coins : crystals;
          const canAfford = balance >= product.price;
          const status = equipped ? 'Equipped' : owned ? 'Owned' : 'Locked';
          return (
            <article key={product.id} className={`skin-card skin-card--${product.tier.toLowerCase()}${equipped ? ' is-equipped' : ''}`}>
              <div className="skin-card-art"><SkinArtwork product={product} /></div>
              <div className="skin-card-heading">
                <span>{product.tier} · {product.season === 'tidal' ? 'Tidal Season' : 'Core Collection'}</span>
                <h2>{product.name}</h2>
                <p>{product.description}</p>
              </div>
              <div className="skin-card-state">
                <span className={`skin-status skin-status--${status.toLowerCase()}`}>{status}</span>
                <strong aria-label={`${product.price} ${product.currency === 'coins' ? 'Coins, Basic currency' : 'Crystals, Premium currency'}`}>
                  {product.price.toLocaleString()} {product.currency === 'coins' ? 'Coins' : 'Crystals'}
                </strong>
              </div>
              <details className="skin-prompt-metadata">
                <summary>Art prompt metadata</summary>
                <p>{product.prompt}</p>
              </details>
              <div className="skin-card-actions">
                <button type="button" onClick={() => setPreview(product)}><Eye aria-hidden="true" /> Preview</button>
                {owned ? (
                  <button
                    type="button"
                    className="skin-primary-action"
                    onClick={() => onEquip(product.id)}
                    disabled={mutationUnavailable || equipped}
                  >
                    {equipped ? <><Check aria-hidden="true" /> Equipped</> : 'Equip'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="skin-primary-action"
                    onClick={() => onUnlock(product.id)}
                    disabled={mutationUnavailable || !canAfford}
                    aria-label={canAfford
                      ? `Unlock ${product.name} for ${product.price} ${product.currency}`
                      : `${product.name} locked. Need ${product.price - balance} more ${product.currency}.`}
                  >
                    <LockKeyhole aria-hidden="true" /> {canAfford ? 'Unlock' : 'Insufficient Balance'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <AccessibleDialog
        open={preview !== null}
        title={preview?.name ?? 'Skin preview'}
        description="Static cosmetic preview. No gameplay attributes are attached."
        onClose={() => setPreview(null)}
        className="skin-preview-dialog"
      >
        {preview && (
          <div className="skin-preview-content">
            <SkinArtwork product={preview} large />
            <div><strong>{preview.tier} cosmetic</strong><p>{preview.description}</p></div>
          </div>
        )}
      </AccessibleDialog>
    </section>
  );
};

export default SkinStore;
