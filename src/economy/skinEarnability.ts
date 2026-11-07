import { CHECK_IN_MILESTONES, CHECK_IN_REWARDS, getNextCheckInStreak } from './ledger';

const cycleCoins = CHECK_IN_REWARDS.reduce<number>((sum, reward) => sum + reward, 0);

interface CheckInProgress {
  balance: number;
  streak: number;
  lastCheckInDay: string | null;
  currentDay: string;
  claimedMilestoneDays: readonly number[];
}

/** Number of future claims under uninterrupted check-ins and no other wallet changes. */
export const estimateCoinSkinCheckIns = (price: number, progress?: CheckInProgress): number => {
  let remaining = price - (progress?.balance ?? 0);
  if (remaining <= 0) return 0;

  let streak = progress
    ? progress.lastCheckInDay === progress.currentDay
      ? progress.streak + 1
      : getNextCheckInStreak(progress.lastCheckInDay, progress.streak, progress.currentDay)
    : 1;
  const bonuses = CHECK_IN_MILESTONES.filter(milestone =>
    milestone.coins > 0 && milestone.day >= streak && !progress?.claimedMilestoneDays.includes(milestone.day),
  );
  const lastBonusDay = Math.max(0, ...bonuses.map(milestone => milestone.day));
  let claims = 0;
  const rewardAt = (day: number) => CHECK_IN_REWARDS[(day - 1) % CHECK_IN_REWARDS.length];

  for (; streak <= lastBonusDay && remaining > 0; streak += 1) {
    remaining -= rewardAt(streak) + (bonuses.find(milestone => milestone.day === streak)?.coins ?? 0);
    claims += 1;
  }
  if (remaining <= 0) return claims;

  // Any seven consecutive claims award the same total. Leave the final cycle
  // to be counted one day at a time so a partial cycle gives the exact result.
  const wholeCycles = Math.floor((remaining - 1) / cycleCoins);
  remaining -= wholeCycles * cycleCoins;
  claims += wholeCycles * CHECK_IN_REWARDS.length;
  for (; remaining > 0; streak += 1) {
    remaining -= rewardAt(streak);
    claims += 1;
  }
  return claims;
};
