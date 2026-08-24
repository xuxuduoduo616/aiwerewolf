import React from 'react';
import CoinStore from './CoinStore';
import SkinStore, { type SkinStoreFilter } from './SkinStore';
import type { EconomyMutationResult, GuestEconomyState } from '../economy/ledger';

export type ShopSection = 'skins' | 'coin-packs';

interface Props {
  section: ShopSection;
  onSectionChange: (section: ShopSection) => void;
  skinFilter: SkinStoreFilter;
  onSkinFilterChange: (filter: SkinStoreFilter) => void;
  economyState: GuestEconomyState;
  coins: number;
  crystals: number;
  legacyCoupons: number;
  isGuest: boolean;
  ledgerCorrupt: boolean;
  feedback: string;
  onUnlock: (skinId: string) => EconomyMutationResult;
  onEquip: (skinId: string) => EconomyMutationResult;
  onOpenHistory: () => void;
  onPurchase: (packId: string) => Promise<{ success: boolean; error?: string }>;
}

const ShopView: React.FC<Props> = ({
  section,
  onSectionChange,
  skinFilter,
  onSkinFilterChange,
  economyState,
  coins,
  crystals,
  legacyCoupons,
  isGuest,
  ledgerCorrupt,
  feedback,
  onUnlock,
  onEquip,
  onOpenHistory,
  onPurchase,
}) => (
  <section className="shop-hub" aria-label="Shop">
    <div className="shop-hub-tabs" role="tablist" aria-label="Shop sections">
      <button type="button" role="tab" aria-selected={section === 'skins'} className={section === 'skins' ? 'is-active' : ''} onClick={() => onSectionChange('skins')}>Cosmetic Skins</button>
      <button type="button" role="tab" aria-selected={section === 'coin-packs'} className={section === 'coin-packs' ? 'is-active' : ''} onClick={() => onSectionChange('coin-packs')}>Coin Packs · Unavailable</button>
    </div>
    {section === 'skins' ? (
      <SkinStore
        state={economyState}
        coins={coins}
        crystals={crystals}
        isGuest={isGuest}
        ledgerCorrupt={ledgerCorrupt}
        filter={skinFilter}
        feedback={feedback}
        onFilterChange={onSkinFilterChange}
        onUnlock={onUnlock}
        onEquip={onEquip}
        onOpenHistory={onOpenHistory}
      />
    ) : (
      <CoinStore coins={coins} coupons={legacyCoupons} crystals={crystals} onPurchase={onPurchase} />
    )}
  </section>
);

export default ShopView;
