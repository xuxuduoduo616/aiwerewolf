import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  enterGuestLobby,
  startNinePlayerGame,
  watchProviderRequests,
} from './helpers/game';

/**
 * H2-B: the replay review exists only after GAME_OVER, is driven by the saved
 * replay, and stays readable at 390x844 and 1440x900 without horizontal
 * overflow and without any provider/network request.
 *
 * A single real match uses a documented fixed random sample, normal human
 * actions and the actual AI/rules pipeline. It must save at least two rounds
 * of human suspicion on its first attempt; completed games are never reselected.
 */

const SEAT = '.game-player-seat';
const PHASE_LABEL = '.game-room-phase-summary p';
const GAME_OVER_HEADING = /Werewolves Win|Village Wins/;
const REPLAY_STORAGE_KEY = 'werewolf.replays.v1';
const MATCH_DEADLINE_MS = 180_000;

interface StoredReplay {
  gameId: string;
  boardId: string;
  players: { seat: number; role: string; isHuman: boolean }[];
  votes: { round: number; voterId: number; targetId: number | null; reason?: string }[];
  beliefSnapshots: { round: number; actorId: number; scores: { targetId: number; score: number }[] }[];
  wolfChat: { round: number; speakerId: number; message: string }[];
  outcome: { winner: string; rounds: number };
}

interface NetworkAudit {
  external: string[];
  functions: string[];
}

const LOCAL_HOSTS = new Set(['127.0.0.1:5173', 'localhost:5173']);

/** Records any request that leaves the local Vite origin or hits a Function. */
const watchNetwork = (page: Page): NetworkAudit => {
  const audit: NetworkAudit = { external: [], functions: [] };
  page.on('request', request => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:'
      && url.protocol !== 'ws:' && url.protocol !== 'wss:') return;
    if (url.pathname.startsWith('/.netlify/functions/')) audit.functions.push(request.url());
    if (!LOCAL_HOSTS.has(url.host)) audit.external.push(request.url());
  });
  return audit;
};

const storedReplays = async (page: Page): Promise<StoredReplay[]> => page.evaluate(key => {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { replays?: StoredReplay[] };
    return Array.isArray(parsed.replays) ? parsed.replays : [];
  } catch {
    return [];
  }
}, REPLAY_STORAGE_KEY);

const hasHumanSuspicion = (replay: StoredReplay): boolean => (
  replay.beliefSnapshots.some(snapshot => snapshot.scores.some(score => score.targetId === 1))
);

const isGameOver = async (page: Page): Promise<boolean> => (
  page.getByRole('heading', { name: GAME_OVER_HEADING }).isVisible().catch(() => false)
);

const isOut = async (locator: Locator): Promise<boolean> => (
  locator.getByText('OUT', { exact: true }).isVisible().catch(() => false)
);

// Controls can disappear while a vote settles or the match ends. Every
// phase-sensitive query is finite so the outer loop can observe GAME_OVER.
const isPhaseCurrent = async (page: Page, expected: string): Promise<boolean> => (
  Boolean(expected) && !(await isGameOver(page))
  && (await page.locator(PHASE_LABEL).innerText({ timeout: 250 }).catch(() => '')).trim() === expected
);

async function completeNightAction(page: Page, seats: Locator): Promise<boolean> {
  const expectedPhase = (await page.locator(PHASE_LABEL).innerText({ timeout: 250 }).catch(() => '')).trim();
  const current = () => isPhaseCurrent(page, expectedPhase);
  if (!(await current())) return false;
  const skipChat = page.getByRole('button', { name: 'Skip night chat', exact: true });
  if (await skipChat.isVisible().catch(() => false)) {
    await skipChat.click({ timeout: 1_500 }).catch(() => undefined);
    return true;
  }
  const pass = page.getByRole('button', { name: 'PASS', exact: true });
  if (await pass.isVisible().catch(() => false)) {
    await pass.click({ timeout: 1_500 }).catch(() => undefined);
    return true;
  }

  for (const actionName of ['KILL', 'CHECK', 'SHOOT'] as const) {
    if (!(await current())) return false;
    // CSS generated confirmation text participates in Chromium's accessible name.
    const action = page.getByRole('button', { name: new RegExp(`^${actionName}(?: Confirm\\?)?$`) });
    if (!(await action.isVisible().catch(() => false))) continue;
    if (await action.isEnabled({ timeout: 250 }).catch(() => false)) {
      if (!(await current())) return false;
      await action.click({ timeout: 1_500 }).catch(() => undefined);
      return true;
    }
    const total = await seats.count();
    for (let index = 1; index < total; index += 1) {
      if (!(await current())) return false;
      const seat = seats.nth(index);
      if (await isOut(seat)) continue;
      if (actionName === 'KILL'
        && (await seat.locator('[aria-label="Werewolf teammate"]').count()) > 0) continue;
      if (!(await seat.click({ timeout: 1_500 }).then(() => true).catch(() => false))) continue;
      if (!(await action.isEnabled({ timeout: 250 }).catch(() => false))) continue;
      if (!(await current())) return false;
      await action.click({ timeout: 1_500 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function castExileVote(page: Page, seats: Locator): Promise<boolean> {
  const current = () => isPhaseCurrent(page, 'Exile Vote');
  if (!(await current())) return false;
  const noVote = page.getByRole('button', { name: 'NO VOTE', exact: true });
  if (await noVote.isVisible().catch(() => false)) {
    await noVote.click({ timeout: 1_500 }).catch(() => undefined);
    return true;
  }

  const vote = page.getByRole('button', { name: 'VOTE', exact: true });
  if (!(await vote.isVisible().catch(() => false))) return false;
  if (!(await vote.isEnabled({ timeout: 250 }).catch(() => false))) {
    const total = await seats.count();
    for (let index = 1; index < total; index += 1) {
      if (!(await current())) return false;
      const seat = seats.nth(index);
      if (await isOut(seat)) continue;
      if (!(await seat.click({ timeout: 1_500 }).then(() => true).catch(() => false))) continue;
      if (!(await current())) return false;
      if (!(await vote.isEnabled({ timeout: 250 }).catch(() => false))) continue;
      await vote.click({ timeout: 1_500 }).catch(() => undefined);
      return true;
    }
  }
  if (!(await current())) return false;
  await vote.click({ timeout: 1_500 }).catch(() => undefined);
  return true;
}

/**
 * Advances one real 9-player match to GAME_OVER. `onFirstDiscussion` runs once,
 * on the first daytime discussion, so the spec can prove the pre-terminal DOM
 * and storage state at the point where the review could most plausibly leak.
 */
async function playMatchToGameOver(
  page: Page,
  onFirstDiscussion: () => Promise<void>,
): Promise<void> {
  const seats = page.locator(`${SEAT} button`);
  const speechInput = page.locator('[data-speech-input-row]');
  const skipSpeech = page.getByRole('button', { name: 'Skip speech', exact: true });
  const phaseLabel = page.locator(PHASE_LABEL);
  const humanSeat = page.locator(SEAT).first();
  const deadline = Date.now() + MATCH_DEADLINE_MS;
  let firstDiscussionSeen = false;

  while (Date.now() < deadline) {
    if (await isGameOver(page)) return;
    if (await page.getByRole('button', { name: 'Play as Guest' }).isVisible().catch(() => false)) {
      throw new Error('page reloaded: guest session lost');
    }

    const label = (await phaseLabel.innerText({ timeout: 3_000 }).catch(() => '')).trim();
    if (!firstDiscussionSeen && label === 'Day Discussion') {
      firstDiscussionSeen = true;
      await onFirstDiscussion();
    }

    if (label === 'Day Discussion' && await speechInput.isVisible().catch(() => false)) {
      const filled = await speechInput.locator('input').fill('Pass', { timeout: 1_000 }).then(() => true).catch(() => false);
      if (filled && await isPhaseCurrent(page, 'Day Discussion')) {
        await page.getByRole('button', { name: 'Send speech' }).click({ timeout: 2_000 }).catch(() => undefined);
      }
      continue;
    }

    if (await skipSpeech.isVisible().catch(() => false)) {
      await skipSpeech.click({ timeout: 1_000 }).catch(() => undefined);
      continue;
    }

    if (label === 'Exile Vote') {
      const humanOut = await isOut(humanSeat);
      if (!humanOut) await castExileVote(page, seats);
      await page.waitForTimeout(80);
      continue;
    }

    if (await isOut(humanSeat)) {
      // A dead human still owes the table a Hunter shot when the phase asks
      // for it; every other phase advances on the AI-only pipeline.
      if (label === 'Hunter Shot') await completeNightAction(page, seats);
      await page.waitForTimeout(120);
      continue;
    }

    await completeNightAction(page, seats);
    await page.waitForTimeout(80);
  }

  if (await isGameOver(page)) return;
  throw new Error('The match did not reach GAME_OVER before the deadline.');
}

const pageMetrics = async (page: Page): Promise<{
  scrollWidth: number;
  clientWidth: number;
  innerWidth: number;
  innerHeight: number;
}> => page.evaluate(() => {
  const scrolling = document.scrollingElement ?? document.documentElement;
  return {
    scrollWidth: scrolling.scrollWidth,
    clientWidth: scrolling.clientWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
});

/** Scrolls an element into view inside the dialog and asserts it is fully visible. */
async function expectInViewport(locator: Locator, page: Page): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, 'element has a layout box').not.toBeNull();
  if (!box) return;
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.describe('post-game replay review', () => {
  test('only appears after GAME_OVER and renders the saved 9-player replay at 390x844 and 1440x900', async ({ page }) => {
    test.setTimeout(480_000);
    // A fixed sample is independent of cosmetic RNG call counts. It preserves
    // the standard deal (human Werewolf), while real AI difficulty-gate samples
    // choose high-seat targets. Real UI play yields multiple human-score rounds.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => { Math.random = () => 0.99; });
    // Another card may be editing this shared worktree while the spec runs.
    // Mock the local Vite HMR socket so a dev-server file change cannot reload
    // the page and drop the guest session mid-match; the product code and the
    // network assertions below are unaffected.
    await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:5173\//, () => undefined);

    const audit = watchNetwork(page);
    const providerRequests = watchProviderRequests(page);

    await enterGuestLobby(page);
    await startNinePlayerGame(page);

    let preTerminalCount = (await storedReplays(page)).length;
    const firstDiscussionAudit = async () => {
      // AC1 / AC6: no replay entry, no premature seat→role reveal, no storage
      // write while the match is still live.
      await expect(page.getByTestId('replay-review')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Replay review' })).toHaveCount(0);
      await expect(page.locator(`${SEAT}:not(:first-child)`)
        .getByText(/^(Werewolf|Villager|Seer|Witch|Hunter|Idiot)$/)).toHaveCount(0);
      await expect(page.locator('.game-over-wolves, .game-over-village')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: GAME_OVER_HEADING })).toHaveCount(0);
      expect((await storedReplays(page)).length).toBe(preTerminalCount);
    };

    await playMatchToGameOver(page, firstDiscussionAudit);
    await expect(page.getByRole('heading', { name: GAME_OVER_HEADING })).toBeVisible();
    await expect(page.getByTestId('replay-review')).toBeVisible();
    await expect(page.getByTestId('replay-review-open')).toBeVisible();

    const replay = (await storedReplays(page))[0];
    expect(replay, 'the first finished match wrote one replay').toBeTruthy();
    expect(replay.boardId).toBe('9-standard');
    expect(replay.players).toHaveLength(9);
    expect(replay.votes.length).toBeGreaterThan(0);
    expect(replay.outcome.winner).toMatch(/^(VILLAGERS|WEREWOLVES)$/);
    expect(replay.outcome.rounds).toBeGreaterThanOrEqual(2);
    expect((await storedReplays(page)).length).toBe(preTerminalCount + 1);
    const humanSuspicionRounds = new Set(replay.beliefSnapshots
      .filter(snapshot => snapshot.scores.some(score => score.targetId === 1))
      .map(snapshot => snapshot.round));
    expect(hasHumanSuspicion(replay)).toBe(true);
    expect(humanSuspicionRounds.size, 'first match has genuine multi-round human scores').toBeGreaterThanOrEqual(2);
    console.log(`[H2-B] first match: fixed random sample 0.99, winner ${replay.outcome.winner}, rounds ${replay.outcome.rounds}, humanSuspicionRounds ${[...humanSuspicionRounds].join(',')}; human votes ${JSON.stringify(replay.votes.filter(vote => vote.voterId === 1))}`);

    const humanSeat = replay.players.find(player => player.isHuman);
    expect(humanSeat?.seat).toBe(1);

    // The application itself loads pre-existing third-party assets (fonts,
    // Cloudflare Turnstile, DiceBear avatars). Record that set after GAME_OVER
    // and prove the review panel adds no external request of its own.
    const externalAtGameOver = [...audit.external];
    test.info().annotations.push({
      type: 'pre-existing-external-assets',
      description: `${externalAtGameOver.length} requests (fonts / Turnstile / DiceBear)`,
    });

    // ── 1440x900 ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('replay-review-open').click();
    const panel = page.getByTestId('replay-review-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('.accessible-dialog')).toBeVisible();

    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(await page.getByTestId('replay-suspicion-line').count()).toBe(replay.players.length);
    expect(await page.getByTestId('replay-suspicion-legend-item').count()).toBe(replay.players.length);
    expect(await page.getByTestId('replay-vote-row').count()).toBe(replay.votes.length);
    expect(await page.getByTestId('replay-wolf-chat-row').count()).toBe(replay.wolfChat.length);
    expect(await page.getByTestId('replay-final-ranking-row').count()).toBeGreaterThan(0);
    await expect(page.getByTestId('replay-suspicion-chart')).toBeVisible();
    await expect(page.getByTestId('replay-votes')).toBeVisible();
    await expect(page.getByTestId('replay-share-slot')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('replay-review-1440x900-top.png') });

    const desktopMetrics = await pageMetrics(page);
    test.info().annotations.push({ type: 'viewport-1440x900', description: JSON.stringify(desktopMetrics) });
    console.log(`[H2-B] 1440x900 page scrollWidth/clientWidth = ${desktopMetrics.scrollWidth}/${desktopMetrics.clientWidth}`);
    expect(desktopMetrics.scrollWidth).toBeLessThanOrEqual(desktopMetrics.clientWidth);
    expect(desktopMetrics.innerWidth).toBe(1440);

    const desktopDialog = page.locator('.accessible-dialog');
    const desktopDialogMetrics = await desktopDialog.evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    console.log(`[H2-B] 1440x900 dialog scrollWidth/clientWidth = ${desktopDialogMetrics.scrollWidth}/${desktopDialogMetrics.clientWidth}; scrollHeight/clientHeight = ${desktopDialogMetrics.scrollHeight}/${desktopDialogMetrics.clientHeight}`);
    expect(desktopDialogMetrics.scrollWidth).toBeLessThanOrEqual(desktopDialogMetrics.clientWidth);
    expect(desktopDialogMetrics.scrollHeight).toBeGreaterThan(desktopDialogMetrics.clientHeight);

    await expectInViewport(page.getByTestId('replay-suspicion-chart'), page);
    await page.getByTestId('replay-vote-row').first().scrollIntoViewIfNeeded();
    await expectInViewport(page.getByTestId('replay-vote-row').first(), page);
    await desktopDialog.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expectInViewport(page.getByTestId('replay-share-slot'), page);
    await page.screenshot({ path: test.info().outputPath('replay-review-1440x900.png') });

    await page.getByRole('button', { name: 'Close replay review' }).click();
    await expect(page.getByTestId('replay-review-panel')).toHaveCount(0);

    // ── 390x844 ────────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobileTerminalMetrics = await pageMetrics(page);
    expect(mobileTerminalMetrics.scrollWidth).toBeLessThanOrEqual(mobileTerminalMetrics.clientWidth);
    expect(mobileTerminalMetrics.innerWidth).toBe(390);

    await page.getByTestId('replay-review-open').click({ force: true });
    await expect(panel).toBeVisible();
    const mobileMetrics = await pageMetrics(page);
    test.info().annotations.push({ type: 'viewport-390x844', description: JSON.stringify(mobileMetrics) });
    console.log(`[H2-B] 390x844 page scrollWidth/clientWidth = ${mobileMetrics.scrollWidth}/${mobileMetrics.clientWidth}`);
    expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(mobileMetrics.clientWidth);
    expect(mobileMetrics.innerWidth).toBe(390);

    await expect(page.getByTestId('replay-suspicion-chart')).toBeVisible();
    await expect(page.getByTestId('replay-votes')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('replay-review-390x844-top.png') });
    expect(await page.getByTestId('replay-suspicion-line').count()).toBe(9);
    expect(await page.getByTestId('replay-vote-row').count()).toBe(replay.votes.length);
    expect(await page.getByTestId('replay-wolf-chat-row').count()).toBe(replay.wolfChat.length);

    const mobileDialog = page.locator('.accessible-dialog');
    const mobileDialogMetrics = await mobileDialog.evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    test.info().annotations.push({ type: 'dialog-390x844', description: JSON.stringify(mobileDialogMetrics) });
    console.log(`[H2-B] 390x844 dialog scrollWidth/clientWidth = ${mobileDialogMetrics.scrollWidth}/${mobileDialogMetrics.clientWidth}; scrollHeight/clientHeight = ${mobileDialogMetrics.scrollHeight}/${mobileDialogMetrics.clientHeight}`);
    expect(mobileDialogMetrics.scrollWidth).toBeLessThanOrEqual(mobileDialogMetrics.clientWidth);
    expect(mobileDialogMetrics.scrollHeight).toBeGreaterThan(mobileDialogMetrics.clientHeight);

    await expectInViewport(page.getByTestId('replay-suspicion-chart'), page);
    await expectInViewport(page.getByTestId('replay-vote-row').first(), page);
    await mobileDialog.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expectInViewport(page.getByTestId('replay-share-slot'), page);
    await page.screenshot({ path: test.info().outputPath('replay-review-390x844.png') });

    await page.getByRole('button', { name: 'Close replay review' }).click();
    await expect(page.getByTestId('replay-review-panel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Return to Lobby', exact: true })).toBeVisible();

    // ── Zero panel network / zero provider calls ───────────────────────────
    expect(audit.functions).toEqual([]);
    expect(audit.external).toEqual(externalAtGameOver);
    expect(audit.external.length).toBe(externalAtGameOver.length);
    expect(providerRequests).toEqual([]);
  });
});
