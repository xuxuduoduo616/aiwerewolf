import React, { useState } from 'react';
import CoinPackCard, { type CoinPackData } from './CoinPackCard';
import type { WalletState } from '../hooks/useWallet';

interface Props {
  coins: number;
  coupons: number;
  crystals: number;
  /** Wallet purchase callback — wired from App.tsx. */
  onPurchase: (packId: string) => Promise<{ success: boolean; error?: string }>;
}

const COIN_PACKS: CoinPackData[] = [
  { amount: 60,   price: 6,   bonus: 60,   badge: '首充双倍' },
  { amount: 300,  price: 30,  bonus: 30 },
  { amount: 680,  price: 68,  bonus: 68,   badge: '限时' },
  { amount: 1280, price: 128, bonus: 128,  badge: '最热门' },
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

const CoinStore: React.FC<Props> = ({ coins, coupons, crystals, onPurchase }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const selectedPack = selectedIndex !== null ? COIN_PACKS[selectedIndex] : null;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      // Trigger exit animation class
      const el = document.querySelector('.wol-store-toast');
      if (el) { el.classList.add('wol-store-toast--out'); }
      setTimeout(() => setToast(null), 220);
    }, 2300);
  };

  const handlePurchase = async () => {
    if (!selectedPack || purchasing) return;
    setPurchasing(true);
    try {
      const packId = `coin-${selectedPack.amount}`;
      const result = await onPurchase(packId);
      if (result.success) {
        showToast('购买成功');
        setSelectedIndex(null);
      } else {
        showToast(result.error ?? '购买失败');
      }
    } catch {
      showToast('网络错误，请稍后重试');
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <div className="wol-store">
      {/* Toast overlay */}
      {toast && <div className="wol-store-toast" role="status" aria-live="polite">{toast}</div>}

      {/* Hero Banner */}
      <div className="wol-store-hero">
        <div className="wol-store-hero-glow" />
        <h1 className="wol-store-hero-title">狼村商会</h1>
        <p className="wol-store-hero-sub">为你的狼村之旅添砖加瓦</p>
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
          <span className="wol-store-wallet-label">金币</span>
        </div>
        <div className="wol-store-wallet-item wol-store-wallet-item--coupon">
          {couponIcon}
          <span className="wol-store-wallet-value">{coupons.toLocaleString()}</span>
          <span className="wol-store-wallet-label">抵用券</span>
        </div>
        <div className="wol-store-wallet-item wol-store-wallet-item--crystal">
          {crystalIcon}
          <span className="wol-store-wallet-value">{crystals.toLocaleString()}</span>
          <span className="wol-store-wallet-label">水晶</span>
        </div>
      </div>

      {/* Coin Pack Grid */}
      <div className="wol-store-section">
        <h2 className="wol-section-title">金币充值</h2>
        <div className="wol-store-grid">
          {COIN_PACKS.map((pack, i) => (
            <CoinPackCard
              key={pack.amount}
              pack={pack}
              isSelected={selectedIndex === i}
              onClick={() => setSelectedIndex(i === selectedIndex ? null : i)}
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
            <span>支付方式</span>
          </div>
          <p className="wol-store-payment-method">
            当前支付方式：<strong>第三方充值助手（测试模式）</strong>
          </p>
          <p className="wol-store-payment-hint">
            测试模式下购买直接到账，无需实际支付。生产环境中将由第三方托管平台担保。
          </p>
        </div>
      </div>

      {/* Purchase Button */}
      <div className="wol-store-section wol-store-purchase-section">
        <button
          type="button"
          className={`wol-btn wol-btn--primary wol-btn--lg wol-store-purchase-btn${selectedPack && !purchasing ? '' : ' wol-store-purchase-btn--disabled'}`}
          disabled={!selectedPack || purchasing}
          onClick={handlePurchase}
        >
          {purchasing ? (
            <span>处理中…</span>
          ) : selectedPack ? (
            <span>确认购买 · {selectedPack.amount}金币 · ¥{selectedPack.price}</span>
          ) : (
            <span>请选择充值档位</span>
          )}
        </button>
      </div>

      {/* Toast styles */}
      <style>{`
        .wol-store-toast {
          position: fixed;
          top: 80px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          background: #1a3a1a;
          border: 1px solid #4ae0a6;
          color: #4ae0a6;
          padding: 0.5rem 1.5rem;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          animation: wol-toast-in 0.3s ease;
          max-width: var(--wol-max-width, 430px);
          text-align: center;
        }
        .wol-store-toast--out {
          animation: wol-toast-out 0.2s ease forwards;
        }
        @keyframes wol-toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes wol-toast-out {
          from { opacity: 1; transform: translateX(-50%) translateY(0); }
          to   { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        }
      `}</style>
    </div>
  );
};

export default CoinStore;
