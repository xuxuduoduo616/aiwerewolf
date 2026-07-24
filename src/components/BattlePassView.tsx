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
  { id: 'tier-1', level: 1, freeRewardLabel: '新月印记', premiumRewardLabel: '银月头像框预览' },
  { id: 'tier-2', level: 2, freeRewardLabel: '推理家徽记', premiumRewardLabel: '狼王入场效果预览' },
  { id: 'tier-3', level: 3, freeRewardLabel: '守村人称号', premiumRewardLabel: '星夜名片预览' },
  { id: 'tier-4', level: 4, freeRewardLabel: '满月边框预览', premiumRewardLabel: '月蚀时装预览' },
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
          <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="返回" title="返回">
            <ArrowLeft aria-hidden="true" />
          </button>
        ) : <span className="lobby-feature-header-spacer" />}
        <div>
          <h1 id="battle-pass-title">通行证</h1>
          <span className="lobby-feature-kicker">免费本地进度</span>
        </div>
        <Ticket className="lobby-feature-header-icon" aria-hidden="true" />
      </header>

      <section className="lobby-pass-progress" aria-label={`当前通行证等级 ${boundedTier}，EXP ${normalizedCurrentExp} / ${normalizedTargetExp}`}>
        <div>
          <span>当前等级</span>
          <strong>{boundedTier}</strong>
        </div>
        <div className="lobby-pass-progress-track" aria-hidden="true">
          <span style={{ width: `${(normalizedCurrentExp / normalizedTargetExp) * 100}%` }} />
        </div>
        <div className="lobby-pass-exp-row">
          <span><Zap aria-hidden="true" />EXP {normalizedCurrentExp} / {normalizedTargetExp}</span>
          <small>距离下一级 {normalizedTargetExp - normalizedCurrentExp} EXP</small>
        </div>
      </section>

      <button
        className="lobby-feature-action lobby-pass-claim-all"
        type="button"
        disabled={eligibleTierIds.length === 0}
        onClick={claimAllEligible}
      >
        {eligibleTierIds.length === 0 ? <Check aria-hidden="true" /> : <Gift aria-hidden="true" />}
        {eligibleTierIds.length === 0 ? '免费奖励已全部领取' : `一键领取免费奖励 (${eligibleTierIds.length})`}
      </button>

      <section className="lobby-feature-list" aria-label="免费通行证等级">
        {BATTLE_PASS_TIERS.map(tier => {
          const claimed = claimedTierIds.includes(tier.id);
          const locked = tier.level > boundedTier;
          return (
            <article className="lobby-feature-card lobby-pass-tier" key={tier.id}>
              <span className="lobby-pass-level">{tier.level}</span>
              <div className="lobby-feature-card-body">
                <div className="lobby-pass-reward-preview lobby-pass-reward-preview--free">
                  <ShieldCheck aria-hidden="true" />
                  <span><small>免费奖励预览</small>{tier.freeRewardLabel}</span>
                </div>
                <div className="lobby-pass-reward-preview lobby-pass-reward-preview--premium">
                  <Star aria-hidden="true" />
                  <span><small>高级奖励预览</small>{tier.premiumRewardLabel}</span>
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
                {claimed ? '本地已领取' : locked ? '未解锁' : '标记领取'}
              </button>
            </article>
          );
        })}
      </section>

      <section className="lobby-feature-unavailable lobby-pass-premium" aria-labelledby="premium-pass-title">
        <Lock aria-hidden="true" />
        <div>
          <h2 id="premium-pass-title">高级通行证</h2>
          <span>高级轨仅供奖励预览；购买、付费奖励与真实资产均未开放</span>
        </div>
        <button type="button" disabled>升级购买未开放</button>
      </section>
    </main>
  );
};

export default BattlePassView;
