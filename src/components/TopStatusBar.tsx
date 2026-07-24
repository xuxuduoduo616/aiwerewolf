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
    <button type="button" className="wol-currency-plus" aria-label="前往商店购买" onClick={onNavigateToShop}>
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
          aria-label="打开功能菜单"
          title="功能菜单"
          aria-haspopup="menu"
        >
          <Gear aria-hidden="true" />
        </button>
      </div>

      {/* Marquee ticker */}
      <div className="wol-marquee">
        <div className="wol-marquee-track">
          <span className="wol-marquee-item">全服赠言：欢迎来到狼人杀村落 · 每日签到领好礼</span>
          <span className="wol-marquee-item">逐浪季限定皮肤即将下架 · 欲购从速</span>
          <span className="wol-marquee-item">新手保护期：前10局免体力消耗</span>
          <span className="wol-marquee-item">本周活动：完成3局对局送限定头像框</span>
          {/* Duplicate for seamless loop */}
          <span className="wol-marquee-item">全服赠言：欢迎来到狼人杀村落 · 每日签到领好礼</span>
          <span className="wol-marquee-item">逐浪季限定皮肤即将下架 · 欲购从速</span>
          <span className="wol-marquee-item">新手保护期：前10局免体力消耗</span>
          <span className="wol-marquee-item">本周活动：完成3局对局送限定头像框</span>
        </div>
      </div>
    </div>
  );
};

export default TopStatusBar;
