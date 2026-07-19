import React from 'react';

interface Props {
  coins: number;
  coupons: number;
  crystals: number;
  onNavigateToShop?: () => void;
}

const coinIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" strokeLinecap="round"/>
    <path d="M12 6v12M9 9h5a2 2 0 010 4h-4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const couponIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="5" width="18" height="14" rx="2" strokeLinecap="round"/>
    <path d="M3 10h18M9 14l.01.01M15 14l.01.01" strokeLinecap="round"/>
  </svg>
);

const crystalIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2l3 5 5 2-3 5 1 8-6-2-6 2 1-8-3-5 5-2z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const TopStatusBar: React.FC<Props> = ({ coins, coupons, crystals, onNavigateToShop }) => {
  const plusBtn = (
    <button type="button" className="wol-currency-plus" aria-label="购买" onClick={onNavigateToShop}>+</button>
  );

  return (
    <div className="wol-top-bar">
      {/* Currency row */}
      <div className="wol-currency-row">
        <div className="wol-currency-item wol-currency-item--coin">
          {coinIcon}
          <span>{coins.toLocaleString()}</span>
          {plusBtn}
        </div>
        <div className="wol-currency-item wol-currency-item--coupon">
          {couponIcon}
          <span>{coupons.toLocaleString()}</span>
          {plusBtn}
        </div>
        <div className="wol-currency-item wol-currency-item--crystal">
          {crystalIcon}
          <span>{crystals.toLocaleString()}</span>
          {plusBtn}
        </div>
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
