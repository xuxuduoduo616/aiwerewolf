import React from 'react';
import { CircleDollarSign, Gem } from 'lucide-react';

interface Props {
  coins: number;
  crystals: number;
  compact?: boolean;
}

const safeBalance = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;

const EconomyBalances: React.FC<Props> = ({ coins, crystals, compact = false }) => (
  <dl className={`economy-balances${compact ? ' economy-balances--compact' : ''}`} aria-label="Economy balances">
    <div className="economy-balance economy-balance--coins" aria-label={`${safeBalance(coins).toLocaleString()} Coins, Basic currency`}>
      <CircleDollarSign aria-hidden="true" />
      <dt>Coins <span>Basic</span></dt>
      <dd>{safeBalance(coins).toLocaleString()}</dd>
    </div>
    <div className="economy-balance economy-balance--crystals" aria-label={`${safeBalance(crystals).toLocaleString()} Crystals, Premium currency`}>
      <Gem aria-hidden="true" />
      <dt>Crystals <span>Premium</span></dt>
      <dd>{safeBalance(crystals).toLocaleString()}</dd>
    </div>
  </dl>
);

export default EconomyBalances;
