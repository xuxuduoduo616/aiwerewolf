import { estimateCoinSkinCheckIns } from '../economy/skinEarnability';

interface Props {
  price: number;
  progress?: Parameters<typeof estimateCoinSkinCheckIns>[1];
  owned: boolean;
}

const checkIns = (days: number) => `${days} check-in${days === 1 ? '' : 's'}`;

export default function SkinEarnability({ price, progress, owned }: Props) {
  const fromZero = estimateCoinSkinCheckIns(price);
  const remaining = progress ? estimateCoinSkinCheckIns(price, progress) : null;
  return (
    <div className="skin-earnability">
      <p>From zero: {checkIns(fromZero)}.</p>
      {owned ? <p>Already owned.</p> : remaining === null ? null : (
        <p>{remaining === 0 ? 'With your balance: enough Coins.' : `With your balance: ${checkIns(remaining)} left.`}</p>
      )}
    </div>
  );
}
