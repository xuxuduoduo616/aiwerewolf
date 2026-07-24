import React from 'react';
import { CircleDollarSign, Gem, Plus, Settings as Gear, Ticket } from 'lucide-react';

interface Props {
  coins: number;
  coupons: number;
  crystals: number;
  onNavigateToShop?: () => void;
  onOpenUtilityMenu: () => void;
  utilityTriggerRef?: React.RefObject<HTMLButtonElement>;
}

const TopStatusBar: React.FC<Props> = ({
  coins,
  coupons,
  crystals,
  onNavigateToShop,
  onOpenUtilityMenu,
  utilityTriggerRef,
}) => {
  const plusBtn = (
    <button type="button" className="wol-currency-plus" aria-label="Go to shop" onClick={onNavigateToShop}>
      <Plus aria-hidden="true" />
    </button>
  );

  return (
    <div className="wol-top-bar">
      {/* Currency row */}
      <div className="wol-currency-row">
        <div className="wol-currency-item wol-currency-item--coin">
          <CircleDollarSign aria-hidden="true" />
          <span className="wol-currency-value" title={coins.toLocaleString()}>{coins.toLocaleString()}</span>
          {plusBtn}
        </div>
        <div className="wol-currency-item wol-currency-item--coupon">
          <Ticket aria-hidden="true" />
          <span className="wol-currency-value" title={coupons.toLocaleString()}>{coupons.toLocaleString()}</span>
          {plusBtn}
        </div>
        <div className="wol-currency-item wol-currency-item--crystal">
          <Gem aria-hidden="true" />
          <span className="wol-currency-value" title={crystals.toLocaleString()}>{crystals.toLocaleString()}</span>
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
