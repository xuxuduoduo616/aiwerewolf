import React from 'react';
import CoinStore from './CoinStore';
import SkinStore, { type SkinStoreFilter } from './SkinStore';
import type { AccountEconomyPhase, AccountMutationAction } from '../economy/accountEconomy';
import type { EconomyActionReturn, EconomyViewState } from '../hooks/useEconomy';

export type ShopSection = 'skins' | 'coin-packs';

interface Props {
  section: ShopSection;
  onSectionChange: (section: ShopSection) => void;
  skinFilter: SkinStoreFilter;
  onSkinFilterChange: (filter: SkinStoreFilter) => void;
  economyState: EconomyViewState;
  coins: number;
  crystals: number;
  legacyCoupons: number;
  isGuest: boolean;
  ledgerCorrupt: boolean;
  phase: AccountEconomyPhase | 'ready';
  statusMessage: string;
  pendingAction: AccountMutationAction | null;
  mutationsDisabled: boolean;
  feedback: string;
  onUnlock: (skinId: string) => EconomyActionReturn;
  onEquip: (skinId: string) => EconomyActionReturn;
  onRefresh: () => void | Promise<boolean>;
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
  phase,
  statusMessage,
  pendingAction,
  mutationsDisabled,
  feedback,
  onUnlock,
  onEquip,
  onRefresh,
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
        phase={phase}
        statusMessage={statusMessage}
        pendingAction={pendingAction}
        mutationsDisabled={mutationsDisabled}
        filter={skinFilter}
        feedback={feedback}
        onFilterChange={onSkinFilterChange}
        onUnlock={onUnlock}
        onEquip={onEquip}
        onRefresh={onRefresh}
        onOpenHistory={onOpenHistory}
      />
    ) : (
      <CoinStore coins={coins} coupons={legacyCoupons} crystals={crystals} onPurchase={onPurchase} />
    )}
  </section>
);

export default ShopView;
