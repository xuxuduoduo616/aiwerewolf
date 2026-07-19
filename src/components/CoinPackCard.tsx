import React from 'react';

export interface CoinPackData {
  amount: number;
  price: number;
  bonus: number;
  badge?: string; // '首充双倍' | '最热门' | '限时'
}

interface Props {
  pack: CoinPackData;
  isSelected: boolean;
  onClick: () => void;
}

const CoinPackCard: React.FC<Props> = ({ pack, isSelected, onClick }) => {
  const badgeClass =
    pack.badge === '首充双倍' ? 'wol-coin-pack-badge--first'
    : pack.badge === '最热门' ? 'wol-coin-pack-badge--hot'
    : pack.badge === '限时' ? 'wol-coin-pack-badge--limited'
    : '';

  return (
    <button
      type="button"
      className={`wol-coin-pack${isSelected ? ' wol-coin-pack--selected' : ''}`}
      onClick={onClick}
      aria-label={`${pack.amount}金币 ¥${pack.price}`}
    >
      {pack.badge && (
        <span className={`wol-coin-pack-badge ${badgeClass}`}>{pack.badge}</span>
      )}
      <div className="wol-coin-pack-amount">
        <span className="wol-coin-pack-coins">{pack.amount.toLocaleString()}</span>
        <span className="wol-coin-pack-label">金币</span>
      </div>
      <div className="wol-coin-pack-price">¥{pack.price}</div>
      {pack.bonus > 0 && (
        <div className="wol-coin-pack-bonus">+{pack.bonus}赠送</div>
      )}
    </button>
  );
};

export default CoinPackCard;
