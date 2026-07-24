import React from 'react';

export interface CoinPackData {
  amount: number;
  price: number;
  bonus: number;
  badge?: string;
}

interface Props {
  pack: CoinPackData;
  /** Legacy selection inputs remain accepted while purchases are unavailable. */
  isSelected?: boolean;
  onClick?: () => void;
  unavailableDescriptionId?: string;
}

const CoinPackCard: React.FC<Props> = ({
  pack,
  unavailableDescriptionId = 'payments-unavailable-description',
}) => {
  const badgeClass =
    pack.badge === 'First Purchase Bonus' ? 'wol-coin-pack-badge--first'
    : pack.badge === 'Most Popular' ? 'wol-coin-pack-badge--hot'
    : pack.badge === 'Limited Time' ? 'wol-coin-pack-badge--limited'
    : '';

  return (
    <button
      type="button"
      className="wol-coin-pack"
      disabled
      aria-describedby={unavailableDescriptionId}
      aria-label={`${pack.amount} coins, ¥${pack.price}. Purchases are currently unavailable.`}
    >
      {pack.badge && (
        <span className={`wol-coin-pack-badge ${badgeClass}`}>{pack.badge}</span>
      )}
      <div className="wol-coin-pack-amount">
        <span className="wol-coin-pack-coins">{pack.amount.toLocaleString()}</span>
        <span className="wol-coin-pack-label">Coins</span>
      </div>
      <div className="wol-coin-pack-price">¥{pack.price}</div>
      {pack.bonus > 0 && (
        <div className="wol-coin-pack-bonus">+{pack.bonus} bonus</div>
      )}
    </button>
  );
};

export default CoinPackCard;
