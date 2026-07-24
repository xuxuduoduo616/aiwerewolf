import React from 'react';
import { ArrowLeft, Check, Gift, Lock, ShieldCheck, Star, Ticket, Zap } from 'lucide-react';
import '../styles/lobby-features.css';

interface BattlePassTier {
  id: string;
  level: number;
  freeRewardLabel: string;
  premiumRewardLabel: string;
}

export const BATTLE_PASS_TIERS: readonly BattlePassTier[] = [
  { id: 'tier-1', level: 1, freeRewardLabel: 'Crescent Mark', premiumRewardLabel: 'Silver Moon Avatar Frame Preview' },
  { id: 'tier-2', level: 2, freeRewardLabel: 'Deduction Badge', premiumRewardLabel: 'Wolf King Entrance Effect Preview' },
  { id: 'tier-3', level: 3, freeRewardLabel: 'Village Guardian Title', premiumRewardLabel: 'Starlight Profile Card Preview' },
  { id: 'tier-4', level: 4, freeRewardLabel: 'Full Moon Frame Preview', premiumRewardLabel: 'Eclipse Outfit Preview' },
] as const;

export interface BattlePassViewProps {
  currentTier?: number;
  currentExp?: number;
  targetExp?: number;
  claimedTierIds: readonly string[];
  onClaimTier: (tierId: string) => void;
  onClaimEligibleTiers?: (tierIds: readonly string[]) => void;
  onBack?: () => void;
}

export const getEligibleBattlePassTierIds = (
  currentTier: number,
  claimedTierIds: readonly string[],
): string[] => BATTLE_PASS_TIERS
  .filter(tier => tier.level <= currentTier && !claimedTierIds.includes(tier.id))
  .map(tier => tier.id);

const BattlePassView: React.FC<BattlePassViewProps> = ({
  currentTier = 3,
  currentExp = 320,
  targetExp = 500,
  claimedTierIds,
  onClaimTier,
  onClaimEligibleTiers,
  onBack,
}) => {
  const normalizedTier = Number.isFinite(currentTier) ? Math.floor(currentTier) : 0;
  const boundedTier = Math.max(0, Math.min(BATTLE_PASS_TIERS.length, normalizedTier));
  const normalizedTargetExp = Number.isFinite(targetExp) && targetExp > 0 ? Math.floor(targetExp) : 1;
  const normalizedCurrentExp = Number.isFinite(currentExp)
    ? Math.min(normalizedTargetExp, Math.max(0, Math.floor(currentExp)))
    : 0;
  const eligibleTierIds = getEligibleBattlePassTierIds(boundedTier, claimedTierIds);
  const claimAllEligible = () => {
    if (onClaimEligibleTiers) {
      onClaimEligibleTiers(eligibleTierIds);
      return;
    }
    eligibleTierIds.forEach(onClaimTier);
  };

  return (
    <main className="lobby-feature-page" aria-labelledby="battle-pass-title">
      <header className="lobby-feature-header">
        {onBack ? (
          <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="Back" title="Back">
            <ArrowLeft aria-hidden="true" />
          </button>
        ) : <span className="lobby-feature-header-spacer" />}
        <div>
          <h1 id="battle-pass-title">Battle Pass</h1>
          <span className="lobby-feature-kicker">Free Local Progress</span>
        </div>
        <Ticket className="lobby-feature-header-icon" aria-hidden="true" />
      </header>

      <section className="lobby-pass-progress" aria-label={`Current Battle Pass level ${boundedTier}, EXP ${normalizedCurrentExp} / ${normalizedTargetExp}`}>
        <div>
          <span>Current Level</span>
          <strong>{boundedTier}</strong>
        </div>
        <div className="lobby-pass-progress-track" aria-hidden="true">
          <span style={{ width: `${(normalizedCurrentExp / normalizedTargetExp) * 100}%` }} />
        </div>
        <div className="lobby-pass-exp-row">
          <span><Zap aria-hidden="true" />EXP {normalizedCurrentExp} / {normalizedTargetExp}</span>
          <small>{normalizedTargetExp - normalizedCurrentExp} EXP to next level</small>
        </div>
      </section>

      <button
        className="lobby-feature-action lobby-pass-claim-all"
        type="button"
        disabled={eligibleTierIds.length === 0}
        onClick={claimAllEligible}
      >
        {eligibleTierIds.length === 0 ? <Check aria-hidden="true" /> : <Gift aria-hidden="true" />}
        {eligibleTierIds.length === 0 ? 'All Free Rewards Claimed' : `Claim All Free Rewards (${eligibleTierIds.length})`}
      </button>

      <section className="lobby-feature-list" aria-label="Free Battle Pass tiers">
        {BATTLE_PASS_TIERS.map(tier => {
          const claimed = claimedTierIds.includes(tier.id);
          const locked = tier.level > boundedTier;
          return (
            <article className="lobby-feature-card lobby-pass-tier" key={tier.id}>
              <span className="lobby-pass-level">{tier.level}</span>
              <div className="lobby-feature-card-body">
                <div className="lobby-pass-reward-preview lobby-pass-reward-preview--free">
                  <ShieldCheck aria-hidden="true" />
                  <span><small>Free Reward Preview</small>{tier.freeRewardLabel}</span>
                </div>
                <div className="lobby-pass-reward-preview lobby-pass-reward-preview--premium">
                  <Star aria-hidden="true" />
                  <span><small>Premium Reward Preview</small>{tier.premiumRewardLabel}</span>
                  <Lock aria-hidden="true" />
                </div>
              </div>
              <button
                className="lobby-feature-action"
                type="button"
                disabled={claimed || locked}
                onClick={() => onClaimTier(tier.id)}
              >
                {claimed ? <Check aria-hidden="true" /> : locked ? <Lock aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                {claimed ? 'Claimed Locally' : locked ? 'Locked' : 'Mark as Claimed'}
              </button>
            </article>
          );
        })}
      </section>

      <section className="lobby-feature-unavailable lobby-pass-premium" aria-labelledby="premium-pass-title">
        <Lock aria-hidden="true" />
        <div>
          <h2 id="premium-pass-title">Premium Battle Pass</h2>
          <span>The premium track is a reward preview only. Purchases, paid rewards, and real assets are unavailable.</span>
        </div>
        <button type="button" disabled>Upgrade Unavailable</button>
      </section>
    </main>
  );
};

export default BattlePassView;
