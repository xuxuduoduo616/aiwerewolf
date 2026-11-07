import { describe, expect, it } from 'vitest';
import { SKIN_CATALOG } from './catalog';
import { estimateCoinSkinCheckIns } from './skinEarnability';

describe('Coin skin check-in estimates', () => {
  const progress = {
    balance: 0,
    streak: 0,
    lastCheckInDay: null,
    currentDay: '2026-01-14',
    claimedMilestoneDays: [],
  };

  it('derives the four earliest unlock dates from zero', () => {
    expect(SKIN_CATALOG.filter(skin => skin.currency === 'coins').map(
      skin => estimateCoinSkinCheckIns(skin.price),
    )).toEqual([12, 14, 24, 35]);
    expect(estimateCoinSkinCheckIns(600)).toBe(7);
    expect(estimateCoinSkinCheckIns(601)).toBe(8);
    expect(estimateCoinSkinCheckIns(1500)).toBe(14);
    expect(estimateCoinSkinCheckIns(1501)).toBe(15);
  });

  it('counts only future claims and includes an unclaimed Day 14 bonus once', () => {
    const continued = { ...progress, balance: 1150, streak: 13, lastCheckInDay: '2026-01-13' };
    expect(estimateCoinSkinCheckIns(1400, continued)).toBe(1);
    expect(estimateCoinSkinCheckIns(1500, continued)).toBe(1);
    expect(estimateCoinSkinCheckIns(1500, { ...continued, claimedMilestoneDays: [7, 14] })).toBe(4);
    expect(estimateCoinSkinCheckIns(1500, { ...continued, streak: 14, lastCheckInDay: '2026-01-14' })).toBe(6);
  });

  it('restarts the reward cycle after a gap and retains claimed milestone history', () => {
    const broken = { ...progress, streak: 13, lastCheckInDay: '2026-01-12', claimedMilestoneDays: [7, 14] };
    expect(estimateCoinSkinCheckIns(1400, broken)).toBe(19);
    expect(estimateCoinSkinCheckIns(1400, { ...broken, claimedMilestoneDays: [7] })).toBe(14);
  });

  it('returns zero at the exact price and distinguishes a one-Coin shortfall', () => {
    expect(estimateCoinSkinCheckIns(800, { ...progress, balance: 800 })).toBe(0);
    expect(estimateCoinSkinCheckIns(800, { ...progress, balance: 799 })).toBe(1);
  });
});
