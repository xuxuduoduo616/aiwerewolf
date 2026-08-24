import React, { useMemo, useState } from 'react';
import { Check, Eye, History, LockKeyhole, Sparkles } from 'lucide-react';
import AccessibleDialog from './AccessibleDialog';
import EconomyBalances from './EconomyBalances';
import SkinArtwork from './SkinArtwork';
import { SKIN_CATALOG, type SkinProduct } from '../economy/catalog';
import type { AccountCatalogItem, AccountEconomyPhase, AccountMutationAction } from '../economy/accountEconomy';
import type { EconomyActionReturn, EconomyViewState } from '../hooks/useEconomy';

export type SkinStoreFilter = 'all' | 'tidal' | 'basic' | 'premium';

interface Props {
  state: EconomyViewState;
  coins: number;
  crystals: number;
  isGuest: boolean;
  ledgerCorrupt: boolean;
  phase: AccountEconomyPhase | 'ready';
  statusMessage: string;
  pendingAction: AccountMutationAction | null;
  mutationsDisabled: boolean;
  filter: SkinStoreFilter;
  feedback: string;
  onFilterChange: (filter: SkinStoreFilter) => void;
  onUnlock: (skinId: string) => EconomyActionReturn;
  onEquip: (skinId: string) => EconomyActionReturn;
  onRefresh: () => void | Promise<boolean>;
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

interface SkinPresentation {
  name: string;
  tier: 'Basic' | 'Premium' | null;
  currency: 'coins' | 'crystals' | null;
  price: number | null;
  verified: boolean;
}

export const resolveSkinPresentation = (
  product: SkinProduct,
  isGuest: boolean,
  serverItem?: AccountCatalogItem,
): SkinPresentation => {
  if (isGuest) {
    return {
      name: product.name,
      tier: product.tier,
      currency: product.currency,
      price: product.price,
      verified: true,
    };
  }
  if (!serverItem) {
    return {
      name: 'Verified item unavailable',
      tier: null,
      currency: null,
      price: null,
      verified: false,
    };
  }
  return {
    name: serverItem.name,
    tier: serverItem.tier === 'premium' ? 'Premium' : 'Basic',
    currency: serverItem.currency,
    price: serverItem.price,
    verified: true,
  };
};

export const SkinPreviewContent = ({
  product,
  presentation,
}: {
  product: SkinProduct;
  presentation: SkinPresentation;
}) => (
  <div className="skin-preview-content">
    <SkinArtwork product={{ ...product, name: presentation.name }} large />
    <div>
      <strong>{presentation.name}</strong>
      <p>{presentation.tier ? `${presentation.tier} cosmetic` : 'Verified tier unavailable'}</p>
      {!presentation.verified && <p>Verified catalog details and price are unavailable for this cosmetic.</p>}
      <p>{product.description}</p>
    </div>
  </div>
);

const SkinStore: React.FC<Props> = ({
  state,
  coins,
  crystals,
  isGuest,
  ledgerCorrupt,
  phase,
  statusMessage,
  pendingAction,
  mutationsDisabled,
  filter,
  feedback,
  onFilterChange,
  onUnlock,
  onEquip,
  onRefresh,
  onOpenHistory,
}) => {
  const [preview, setPreview] = useState<SkinProduct | null>(null);
  const visibleProducts = useMemo(() => SKIN_CATALOG.filter(product => {
    if (filter === 'tidal' || isGuest) return productMatchesFilter(product, filter);
    if (filter === 'basic' || filter === 'premium') {
      const serverTier = state.accountCatalog.find(item => item.id === product.id)?.tier;
      return serverTier === filter;
    }
    return true;
  }), [filter, isGuest, state.accountCatalog]);
  const mutationUnavailable = mutationsDisabled || ledgerCorrupt;
  const unavailableMessage = ledgerCorrupt
      ? isGuest
        ? 'Local economy data could not be verified. Unlock and equip actions are disabled without changing stored data.'
        : 'Account economy data could not be verified. Unlock and equip actions are disabled.'
      : !isGuest && mutationsDisabled
        ? statusMessage || 'Account economy must be verified before cosmetic changes.'
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
      {!isGuest && phase !== 'ready' && (
        <button type="button" className="economy-secondary-action" onClick={() => { void onRefresh(); }}>
          Refresh Account State
        </button>
      )}
      <p className="economy-live-feedback" role="status" aria-live="polite">{feedback}</p>

      <div className="skin-grid">
        {visibleProducts.map(product => {
          const owned = state.inventory.includes(`skin:${product.id}`);
          const equipped = state.equippedSkinId === product.id;
          const serverItem = isGuest ? null : state.accountCatalog.find(item => item.id === product.id);
          const presentation = resolveSkinPresentation(product, isGuest, serverItem ?? undefined);
          const serverEnabled = isGuest || Boolean(serverItem?.purchaseEnabled);
          const balance = presentation.currency === 'coins'
            ? coins
            : presentation.currency === 'crystals' ? crystals : null;
          const canAfford = serverEnabled
            && presentation.price !== null
            && balance !== null
            && balance >= presentation.price;
          const status = equipped ? 'Equipped' : owned ? 'Owned' : 'Locked';
          return (
            <article key={product.id} className={`skin-card skin-card--${presentation.tier?.toLowerCase() ?? 'unavailable'}${equipped ? ' is-equipped' : ''}`}>
              <div className="skin-card-art"><SkinArtwork product={{ ...product, name: presentation.name }} /></div>
              <div className="skin-card-heading">
                <span>{presentation.tier
                  ? `${presentation.tier} · ${product.season === 'tidal' ? 'Tidal Season' : 'Core Collection'}`
                  : 'Verified tier unavailable'}</span>
                <h2>{presentation.name}</h2>
                <p>{product.description}</p>
              </div>
              <div className="skin-card-state">
                <span className={`skin-status skin-status--${status.toLowerCase()}`}>{status}</span>
                {presentation.price !== null && presentation.currency !== null
                  ? (
                    <strong aria-label={`${presentation.price} ${presentation.currency === 'coins' ? 'Coins, Basic currency' : 'Crystals, Premium currency'}`}>
                      {presentation.price.toLocaleString()} {presentation.currency === 'coins' ? 'Coins' : 'Crystals'}
                    </strong>
                  )
                  : <strong aria-label="Verified price unavailable">Price unavailable</strong>}
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
                    disabled={mutationUnavailable || !presentation.verified || equipped || pendingAction !== null}
                  >
                    {!presentation.verified
                      ? 'Server Unavailable'
                      : equipped
                      ? <><Check aria-hidden="true" /> Equipped</>
                      : pendingAction === 'equip_skin' ? 'Verifying Equipment...' : 'Equip'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="skin-primary-action"
                    onClick={() => onUnlock(product.id)}
                    disabled={mutationUnavailable || !canAfford || pendingAction !== null}
                    aria-label={canAfford
                      ? `Unlock ${presentation.name} for ${presentation.price} ${presentation.currency}`
                      : !serverEnabled
                        ? 'This cosmetic is unavailable in the verified server catalog.'
                        : `${presentation.name} locked. Need ${(presentation.price ?? 0) - (balance ?? 0)} more ${presentation.currency}.`}
                  >
                    <LockKeyhole aria-hidden="true" /> {pendingAction === 'unlock_skin'
                      ? 'Verifying Unlock...'
                      : canAfford ? 'Unlock' : serverEnabled ? 'Insufficient Balance' : 'Server Unavailable'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <AccessibleDialog
        open={preview !== null}
        title={preview
          ? resolveSkinPresentation(
            preview,
            isGuest,
            state.accountCatalog.find(item => item.id === preview.id),
          ).name
          : 'Skin preview'}
        description="Static cosmetic preview. No gameplay attributes are attached."
        onClose={() => setPreview(null)}
        className="skin-preview-dialog"
      >
        {preview && (
          <SkinPreviewContent
            product={preview}
            presentation={resolveSkinPresentation(
              preview,
              isGuest,
              state.accountCatalog.find(item => item.id === preview.id),
            )}
          />
        )}
      </AccessibleDialog>
    </section>
  );
};

export default SkinStore;
