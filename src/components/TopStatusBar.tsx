import React from 'react';
import { CircleDollarSign, Gem, Moon, Plus, Settings as Gear } from 'lucide-react';
import { UI_PRESENTATION } from '../uiPresentation';

interface Props {
  coins: number;
  coupons: number;
  crystals: number;
  onNavigateToShop?: () => void;
  onOpenUtilityMenu: () => void;
  utilityTriggerRef?: React.RefObject<HTMLButtonElement>;
  quiet?: boolean;
}

const TopStatusBar: React.FC<Props> = ({
  coins,
  coupons: _coupons,
  crystals,
  onNavigateToShop,
  onOpenUtilityMenu,
  utilityTriggerRef,
  quiet = false,
}) => {
  const plusBtn = UI_PRESENTATION.showPaymentEntryPoints && (
    <button type="button" className="wol-currency-plus" aria-label="Go to shop" onClick={onNavigateToShop}>
      <Plus aria-hidden="true" />
    </button>
  );

  if (quiet) return (
    <header className="wol-top-bar night-top-bar">
      <div className="night-brand"><Moon size={21} aria-hidden="true" /><span className="cinzel">AI WEREWOLF</span></div>
      <span className="night-top-caption">Shadows of the Village</span>
      <button ref={utilityTriggerRef} type="button" className="wol-utility-trigger" onClick={onOpenUtilityMenu}
        aria-label="Open utility menu" title="Utility menu" aria-haspopup="menu"><Gear aria-hidden="true" /></button>
    </header>
  );

  return (
    <div className="wol-top-bar">
      {/* Currency row */}
      <div className="wol-currency-row" data-tour-target="wallet" aria-label="Currency balances">
        <div className="wol-currency-item wol-currency-item--coin" aria-label={`${coins.toLocaleString()} Coins, Basic currency`}>
          <CircleDollarSign aria-hidden="true" />
          <span className="wol-currency-value" title={coins.toLocaleString()}>{coins.toLocaleString()}</span>
          <span className="sr-only">Coins, Basic currency</span>
          {plusBtn}
        </div>
        <div className="wol-currency-item wol-currency-item--crystal" aria-label={`${crystals.toLocaleString()} Crystals, Premium currency`}>
          <Gem aria-hidden="true" />
          <span className="wol-currency-value" title={crystals.toLocaleString()}>{crystals.toLocaleString()}</span>
          <span className="sr-only">Crystals, Premium currency</span>
          {plusBtn}
        </div>
        <button
          ref={utilityTriggerRef}
          type="button"
          className="wol-utility-trigger"
          onClick={onOpenUtilityMenu}
          aria-label="Open utility menu"
          title="Utility menu"
          aria-haspopup="menu"
        >
          <Gear aria-hidden="true" />
        </button>
      </div>

      {/* Marquee ticker */}
      <div className="wol-marquee">
        <div className="wol-marquee-track">
          <span className="wol-marquee-item">Village message: Welcome to AI Werewolf · Check in daily for rewards</span>
          <span className="wol-marquee-item">Tidal Season skins leave the shop soon</span>
          <span className="wol-marquee-item">New-player protection: No energy cost for your first 10 games</span>
          <span className="wol-marquee-item">This week: Complete 3 games for an exclusive avatar frame</span>
          {/* Duplicate for seamless loop */}
          <span className="wol-marquee-item">Village message: Welcome to AI Werewolf · Check in daily for rewards</span>
          <span className="wol-marquee-item">Tidal Season skins leave the shop soon</span>
          <span className="wol-marquee-item">New-player protection: No energy cost for your first 10 games</span>
          <span className="wol-marquee-item">This week: Complete 3 games for an exclusive avatar frame</span>
        </div>
      </div>
    </div>
  );
};

export default TopStatusBar;
