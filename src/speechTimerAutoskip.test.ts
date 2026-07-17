import { describe, it, expect } from 'vitest';
import { shouldAutoSkipSpeech, tickSpeechTimer } from './hooks/useGameState';

/**
 * Regression tests for speech-timer-autoskip-fix (P0, audit M01/S01).
 *
 * Bug (browser-verified): the speech-timer tick in useGameState.ts was
 * `v => { if (v === null || v <= 1) return null; return v - 1; }` — the value
 * jumped from 1 straight to null and never reached 0. The auto-skip effect
 * guards on `speechTimer !== 0`, and `null !== 0` is true, so it early-returned
 * forever: the human speech phase permanently stalled at "轮到你公开发言".
 *
 * Fix: tickSpeechTimer lands on 0 (1 → 0, stays 0, never negative, null stays
 * null), so the existing auto-skip fires when the timer expires. The guard is
 * unchanged in strength: null (inactive timer) still never triggers it.
 */

const HUMAN_ID = 1; // MY_PLAYER_ID in useGameState.ts

describe('tickSpeechTimer — countdown lands on 0', () => {
  it('60 → 59 (normal tick)', () => {
    expect(tickSpeechTimer(60)).toBe(59);
  });

  it('2 → 1', () => {
    expect(tickSpeechTimer(2)).toBe(1);
  });

  it('1 → 0 (never skips from 1 to null)', () => {
    expect(tickSpeechTimer(1)).toBe(0);
  });

  it('0 → 0 (stays at 0, never negative)', () => {
    expect(tickSpeechTimer(0)).toBe(0);
  });

  it('null → null (inactive timer stays inactive)', () => {
    expect(tickSpeechTimer(null)).toBeNull();
  });

  it('full countdown 60 → 0 hits every value once and never goes negative', () => {
    let value: number | null = 60;
    const seen: Array<number | null> = [];
    for (let i = 0; i < 65; i++) {
      value = tickSpeechTimer(value);
      seen.push(value);
    }
    // 60 ticks reach 0; extra ticks stay at 0.
    expect(seen.slice(0, 60)).toEqual(Array.from({ length: 60 }, (_, i) => 59 - i));
    expect(seen.slice(60)).toEqual([0, 0, 0, 0, 0]);
    expect(seen.some(v => v !== null && v < 0)).toBe(false);
    expect(seen).not.toContain(null);
  });
});

describe('shouldAutoSkipSpeech — auto-skip guard semantics', () => {
  it('timer 0 + human speaker → fires', () => {
    expect(shouldAutoSkipSpeech(0, HUMAN_ID)).toBe(true);
  });

  it('inactive timer (null) never fires, even with the human speaking', () => {
    expect(shouldAutoSkipSpeech(null, HUMAN_ID)).toBe(false);
  });

  it('timer 0 + non-human speaker → does not fire', () => {
    expect(shouldAutoSkipSpeech(0, 2)).toBe(false);
    expect(shouldAutoSkipSpeech(0, 9)).toBe(false);
  });

  it('timer 0 + no current speaker → does not fire', () => {
    expect(shouldAutoSkipSpeech(0, undefined)).toBe(false);
  });

  it('running timer (> 0) never fires', () => {
    expect(shouldAutoSkipSpeech(60, HUMAN_ID)).toBe(false);
    expect(shouldAutoSkipSpeech(1, HUMAN_ID)).toBe(false);
  });
});

describe('tick + guard interaction — auto-skip becomes reachable exactly once', () => {
  /**
   * Faithful simulation of the effect contract in useGameState.ts: the
   * interval calls setSpeechTimer(tickSpeechTimer); the auto-skip effect runs
   * on speechTimer changes and fires when shouldAutoSkipSpeech is true, then
   * clears currentSpeaker — which resets the timer to null via the timer
   * effect. React bails on same-value setState, so the guard is only
   * re-evaluated when the timer value actually changes.
   */
  it('human speaker: timer expiry fires the auto-skip once, then the reset timer stays inert', () => {
    let timer: number | null = 60;
    let speakerId: number | undefined = HUMAN_ID;
    let autoSkips = 0;

    for (let tick = 0; tick < 70; tick++) {
      const next = tickSpeechTimer(timer);
      if (next === timer) continue; // React bails: effect does not re-run
      timer = next;
      if (shouldAutoSkipSpeech(timer, speakerId)) {
        autoSkips++;
        speakerId = undefined; // auto-skip clears currentSpeaker
        timer = null; // timer effect re-runs and resets the timer
      }
    }

    expect(autoSkips).toBe(1);
    expect(timer).toBeNull();
  });

  it('AI speaker: human timer is inactive (null) and the auto-skip never fires', () => {
    let timer: number | null = null;
    let autoSkips = 0;
    for (let tick = 0; tick < 70; tick++) {
      timer = tickSpeechTimer(timer);
      if (shouldAutoSkipSpeech(timer, 5)) autoSkips++;
    }
    expect(autoSkips).toBe(0);
    expect(timer).toBeNull();
  });
});
