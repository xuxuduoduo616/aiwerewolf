import type { Page } from '@playwright/test';

/**
 * Test-only deterministic randomness for the long, real-match specs.
 *
 * A 9-player match is full of product-level randomness: role deal, AI persona
 * picks, wolf-hopper mark, night kill / seer / witch decisions, speech-library
 * picks and vote targets. Unseeded, a match can legitimately end with the human
 * dead before the second vote settlement, which can never satisfy the strict
 * replay evidence the specs assert (two rounds of "the AI suspected you").
 *
 * `page.addInitScript` runs before any application script, so replacing
 * `Math.random` there makes the entire match reproducible without touching
 * product code, storage fixtures or the assertions. mulberry32 is the same
 * algorithm as `src/diagnostics/fixtures.ts` (kept in sync by hand because the
 * e2e layer cannot import a module that is bundled into the app).
 *
 * The curated seed below was selected by playing real matches and reading the
 * saved replay: the first match ends with the human (seat 1, Werewolf) alive
 * through both vote settlements — winner WEREWOLVES, 2 rounds, human suspicion
 * rounds [1, 2] — so the replay spec captures its evidence on attempt 1 and the
 * share card takes its primary stats path. Re-probed three times with identical
 * outcome; see `memory/coordination/reports/E2E-CI.md`.
 */
export const E2E_GAME_SEED = 123;

export const installSeededRandom = async (
  page: Page,
  seed: number = E2E_GAME_SEED,
): Promise<void> => {
  await page.addInitScript((value: number) => {
    let state = value >>> 0;
    Math.random = (): number => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
};
