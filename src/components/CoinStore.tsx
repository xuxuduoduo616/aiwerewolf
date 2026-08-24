import React from 'react';
import CoinPackCard, { type CoinPackData } from './CoinPackCard';

interface Props {
  coins: number;
  coupons: number;
  crystals: number;
  /** Retained integration signature; unavailable controls never invoke it. */
  onPurchase: (packId: string) => Promise<{ success: boolean; error?: string }>;
}

const COIN_PACKS: CoinPackData[] = [
  { amount: 60,   price: 6,   bonus: 60,   badge: 'First Purchase Bonus' },
  { amount: 300,  price: 30,  bonus: 30 },
  { amount: 680,  price: 68,  bonus: 68,   badge: 'Limited Time' },
  { amount: 1280, price: 128, bonus: 128,  badge: 'Most Popular' },
  { amount: 3280, price: 328, bonus: 680 },
  { amount: 6480, price: 648, bonus: 1600 },
];

/* Inline SVG icons — no external dependencies */
const coinIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" strokeLinecap="round"/>
    <path d="M12 6v12M9 9h5a2 2 0 010 4h-4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const crystalIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2l3 5 5 2-3 5 1 8-6-2-6 2 1-8-3-5 5-2z" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const CoinStore: React.FC<Props> = ({ coins, coupons: _coupons, crystals }) => {
  return (
    <div className="wol-store">
      {/* Hero Banner */}
      <div className="wol-store-hero">
        <div className="wol-store-hero-glow" />
        <h1 className="wol-store-hero-title">Village Exchange</h1>
        <p className="wol-store-hero-sub">Supplies for your journey through the village</p>
        <div className="wol-store-hero-decor">
          <span className="wol-store-hero-line" />
          <svg viewBox="0 0 24 24" fill="currentColor" className="wol-store-hero-icon">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v12M9 9h5a2 2 0 010 4h-4" stroke="#0d0d10" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="wol-store-hero-line" />
        </div>
      </div>

      {/* Wallet Strip */}
      <div className="wol-store-wallet">
        <div className="wol-store-wallet-item wol-store-wallet-item--coin">
          {coinIcon}
          <span className="wol-store-wallet-value">{coins.toLocaleString()}</span>
          <span className="wol-store-wallet-label">Coins</span>
        </div>
        <div className="wol-store-wallet-item wol-store-wallet-item--crystal">
          {crystalIcon}
          <span className="wol-store-wallet-value">{crystals.toLocaleString()}</span>
          <span className="wol-store-wallet-label">Crystals</span>
        </div>
      </div>

      {/* Coin Pack Grid */}
      <div className="wol-store-section">
        <h2 className="wol-section-title">Coin Packs</h2>
        <div className="wol-store-grid">
          {COIN_PACKS.map((pack) => (
            <CoinPackCard
              key={pack.amount}
              pack={pack}
              unavailableDescriptionId="payments-unavailable-description"
            />
          ))}
        </div>
      </div>

      {/* Payment Method */}
      <div className="wol-store-section">
        <div className="wol-store-payment">
          <div className="wol-store-payment-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="wol-store-payment-icon">
              <rect x="2" y="4" width="20" height="16" rx="2" strokeLinecap="round"/>
              <path d="M2 10h20" strokeLinecap="round"/>
            </svg>
            <span>Payment Method</span>
          </div>
          <p className="wol-store-payment-method">
            Current status: <strong>Purchases are unavailable</strong>
          </p>
          <p
            id="payments-unavailable-description"
            className="wol-store-payment-hint"
            role="status"
          >
            Payment services are not configured, so no order can be created and no coins can be issued.
          </p>
        </div>
      </div>

      {/* Purchase Button */}
      <div className="wol-store-section wol-store-purchase-section">
        <button
          type="button"
          className="wol-btn wol-btn--primary wol-btn--lg wol-store-purchase-btn wol-store-purchase-btn--disabled"
          disabled
          aria-describedby="payments-unavailable-description"
        >
          <span>Purchases are unavailable</span>
        </button>
      </div>
    </div>
  );
};

export default CoinStore;
