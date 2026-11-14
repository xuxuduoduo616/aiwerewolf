import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  enterGuestLobby,
  startNinePlayerGame,
  watchProviderRequests,
} from './helpers/game';
import { E2E_GAME_SEED, installSeededRandom } from './helpers/seededRandom';

/**
 * H2-E: the "AI's view of you" share card is a purely local canvas export.
 *
 * The spec plays one real 9-player match to GAME_OVER (same driving style as
 * e2e/replay-review.spec.ts), proves the export does not exist before the
 * terminal state, then exports the PNG at 1440x900 and 390x844 and checks the
 * Playwright download event, the suggested file name, the PNG signature and
 * the 1080x1350 dimensions. No network/Function request may be added.
 *
 * The same test-only seeded `Math.random` as the replay spec makes the first
 * match reproducible (the human stays in the final snapshot round, so the
 * primary stats path is the one under test), while the retry loop below stays
 * as a defensive guard only.
 */

const SEAT = '.game-player-seat';
const PHASE_LABEL = '.game-room-phase-summary p';
const GAME_OVER_HEADING = /Werewolves Win|Village Wins/;
const REPLAY_STORAGE_KEY = 'werewolf.replays.v1';
const MATCH_DEADLINE_MS = 240_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface StoredReplay {
  gameId: string;
  boardId: string;
  players: { seat: number; role: string; isHuman: boolean }[];
  beliefSnapshots: { round: number; actorId: number; scores: { targetId: number; score: number }[] }[];
  outcome: { winner: string; rounds: number };
}

interface NetworkAudit {
  external: string[];
  functions: string[];
}

const LOCAL_HOSTS = new Set(['127.0.0.1:5173', 'localhost:5173']);

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

const waitForStoredReplayCount = async (page: Page, minimum: number): Promise<void> => {
  await expect
    .poll(async () => (await storedReplays(page)).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(minimum);
};

const humanSeatOf = (replay: StoredReplay): number => (
  replay.players.find(player => player.isHuman)?.seat ?? 1
);

/**
 * `buildFinalSuspicionRanking` only uses the latest snapshot round, so the card
 * shows stats only when the human seat was scored in that round. A human who
 * died before the last vote legitimately gets "final suspicion unavailable"
 * even though earlier rounds scored them.
 */
const hasFinalRoundHumanSuspicion = (replay: StoredReplay): boolean => {
  if (!Array.isArray(replay.beliefSnapshots) || replay.beliefSnapshots.length === 0) return false;
  const humanSeat = humanSeatOf(replay);
  const latestRound = Math.max(...replay.beliefSnapshots.map(snapshot => snapshot.round));
  return replay.beliefSnapshots.some(snapshot => (
    snapshot.round === latestRound
    && snapshot.scores.some(score => score.targetId === humanSeat)
  ));
};

const isGameOver = async (page: Page): Promise<boolean> => (
  page.getByRole('heading', { name: GAME_OVER_HEADING }).isVisible().catch(() => false)
);

const isOut = async (locator: Locator): Promise<boolean> => (
  locator.getByText('OUT', { exact: true }).isVisible().catch(() => false)
);

async function completeNightAction(page: Page, seats: Locator): Promise<boolean> {
  const pass = page.getByRole('button', { name: 'PASS', exact: true });
  if (await pass.isVisible().catch(() => false)) {
    await pass.click({ timeout: 1_500 }).catch(() => undefined);
    return true;
  }

  for (const actionName of ['KILL', 'CHECK', 'SHOOT'] as const) {
    const action = page.getByRole('button', { name: actionName, exact: true });
    if (!(await action.isVisible().catch(() => false))) continue;
    if (await action.isEnabled().catch(() => false)) {
      await action.click({ timeout: 1_500 }).catch(() => undefined);
      return true;
    }
    const total = await seats.count();
    for (let index = 1; index < total; index += 1) {
      const seat = seats.nth(index);
      if (await isOut(seat)) continue;
      if (actionName === 'KILL'
        && (await seat.locator('[aria-label="Werewolf teammate"]').count()) > 0) continue;
      if (!(await seat.click({ timeout: 1_500 }).then(() => true).catch(() => false))) continue;
      if (!(await action.isEnabled().catch(() => false))) continue;
      await action.click({ timeout: 1_500 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function castExileVote(page: Page, seats: Locator): Promise<boolean> {
  const noVote = page.getByRole('button', { name: 'NO VOTE', exact: true });
  if (await noVote.isVisible().catch(() => false)) {
    await noVote.click({ timeout: 1_500 }).catch(() => undefined);
    return true;
  }

  const vote = page.getByRole('button', { name: 'VOTE', exact: true });
  if (!(await vote.isVisible().catch(() => false))) return false;
  if (!(await vote.isEnabled().catch(() => false))) {
    const total = await seats.count();
    for (let index = 1; index < total; index += 1) {
      const seat = seats.nth(index);
      if (await isOut(seat)) continue;
      if (!(await seat.click({ timeout: 1_500 }).then(() => true).catch(() => false))) continue;
      if (!(await vote.isEnabled().catch(() => false))) continue;
      await vote.click({ timeout: 1_500 }).catch(() => undefined);
      return true;
    }
  }
  await vote.click({ timeout: 1_500 }).catch(() => undefined);
  return true;
}

/** Advances one real 9-player match to GAME_OVER. */
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

    if (await speechInput.isVisible().catch(() => false)) {
      await speechInput.locator('input').fill('Pass');
      await page.getByRole('button', { name: 'Send speech' }).click({ timeout: 2_000 }).catch(() => undefined);
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
      if (label === 'Hunter Shot') await completeNightAction(page, seats);
      await page.waitForTimeout(120);
      continue;
    }

    await completeNightAction(page, seats);
    await page.waitForTimeout(80);
  }

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

const dialogMetrics = async (page: Page): Promise<{
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}> => page.locator('.accessible-dialog').evaluate(element => ({
  scrollWidth: element.scrollWidth,
  clientWidth: element.clientWidth,
  scrollHeight: element.scrollHeight,
  clientHeight: element.clientHeight,
}));

/** PNG IHDR width/height (big-endian) for downloaded bytes. */
const pngDimensions = (bytes: Buffer): { width: number; height: number } => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});

const expectPngDownload = async (
  page: Page,
  button: Locator,
  expectedFileName: string,
  saveAs: string,
): Promise<{ fileName: string; width: number; height: number; size: number }> => {
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await button.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(expectedFileName);
  const filePath = test.info().outputPath(saveAs);
  await download.saveAs(filePath);

  const bytes = await readFile(filePath);
  expect(bytes.length).toBeGreaterThan(1_000);
  expect([...bytes.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
  const dimensions = pngDimensions(bytes);
  return {
    fileName: download.suggestedFilename(),
    width: dimensions.width,
    height: dimensions.height,
    size: bytes.length,
  };
};

const scrollShareCardIntoView = async (page: Page): Promise<void> => {
  const dialog = page.locator('.accessible-dialog');
  await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByTestId('share-card-panel')).toBeVisible();
  await expect(page.getByTestId('share-card-export')).toBeVisible();
};

test.describe('post-game share card', () => {
  test('exports a local 1080x1350 PNG at 1440x900 and 390x844 with no network', async ({ page }) => {
    test.setTimeout(600_000);
    // Same deterministic match as the replay-review spec: the human is alive in
    // the final snapshot round, which is the card's primary stats path.
    await installSeededRandom(page);
    // Another card may edit this shared worktree while the spec runs; mocking
    // the local Vite HMR socket keeps the guest session alive. Product code and
    // the network assertions below are unaffected.
    await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:5173\//, () => undefined);

    const audit = watchNetwork(page);
    const providerRequests = watchProviderRequests(page);

    await enterGuestLobby(page);
    await startNinePlayerGame(page);

    const preTerminalAudit = async () => {
      // AC3: no share UI before the terminal state.
      await expect(page.getByTestId('share-card-panel')).toHaveCount(0);
      await expect(page.getByTestId('share-card-export')).toHaveCount(0);
      await expect(page.getByTestId('replay-review')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Replay review' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: GAME_OVER_HEADING })).toHaveCount(0);
    };

    const initialStoredCount = (await storedReplays(page)).length;
    await playMatchToGameOver(page, preTerminalAudit);

    await expect(page.getByRole('heading', { name: GAME_OVER_HEADING })).toBeVisible();
    await waitForStoredReplayCount(page, initialStoredCount + 1);
    let replay = (await storedReplays(page))[0];
    expect(replay, 'the finished match wrote one replay').toBeTruthy();
    expect(replay.boardId).toBe('9-standard');
    expect(replay.players).toHaveLength(9);
    expect(replay.outcome.winner).toMatch(/^(VILLAGERS|WEREWOLVES)$/);

    // The stats branch only exists when the latest snapshot round scored the
    // human seat. A human who dies before the last vote produces the legitimate
    // fallback card, so retry that match (up to three attempts) to also capture
    // the primary stats path in a real browser. The fallback is still accepted
    // after the last attempt rather than failing the spec.
    const MAX_CARD_ATTEMPTS = 3;
    for (let attempt = 1; attempt < MAX_CARD_ATTEMPTS; attempt += 1) {
      if (hasFinalRoundHumanSuspicion(replay)) break;
      test.info().annotations.push({
        type: 'share-card-retry',
        description: `attempt ${attempt}: final snapshot round has no human suspicion`,
      });
      const countBeforeRetry = (await storedReplays(page)).length;
      await page.getByRole('button', { name: 'Return to Lobby', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
      await startNinePlayerGame(page);
      await playMatchToGameOver(page, preTerminalAudit);
      await expect(page.getByRole('heading', { name: GAME_OVER_HEADING })).toBeVisible();
      await waitForStoredReplayCount(page, countBeforeRetry + 1);
      replay = (await storedReplays(page))[0];
      expect(replay, 'the finished match wrote one replay').toBeTruthy();
      expect(replay.boardId).toBe('9-standard');
      expect(replay.players).toHaveLength(9);
      expect(replay.outcome.winner).toMatch(/^(VILLAGERS|WEREWOLVES)$/);
    }

    const expectedFileName = `ai-view-of-you-${replay.gameId}.png`;
    const suspicionAvailable = hasFinalRoundHumanSuspicion(replay);
    console.log(`[H2-E] seeded match: seed ${E2E_GAME_SEED}, winner ${replay.outcome.winner}, rounds ${replay.outcome.rounds}, suspicionAvailable ${suspicionAvailable}`);

    // The application itself loads pre-existing third-party assets. Record them
    // at GAME_OVER and prove the share card adds no external request of its own.
    const externalAtGameOver = [...audit.external];

    // ── 1440x900 ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('replay-review-open').click();
    await expect(page.getByTestId('replay-review-panel')).toBeVisible();
    await expect(page.getByTestId('replay-share-slot')).toHaveCount(1);

    const desktopPageMetrics = await pageMetrics(page);
    const desktopDialogMetrics = await dialogMetrics(page);
    console.log(`[H2-E] 1440x900 page scrollWidth/clientWidth = ${desktopPageMetrics.scrollWidth}/${desktopPageMetrics.clientWidth}`);
    console.log(`[H2-E] 1440x900 dialog scrollWidth/clientWidth = ${desktopDialogMetrics.scrollWidth}/${desktopDialogMetrics.clientWidth}`);
    expect(desktopPageMetrics.innerWidth).toBe(1440);
    expect(desktopPageMetrics.scrollWidth).toBeLessThanOrEqual(desktopPageMetrics.clientWidth);
    expect(desktopDialogMetrics.scrollWidth).toBeLessThanOrEqual(desktopDialogMetrics.clientWidth);

    await scrollShareCardIntoView(page);
    if (suspicionAvailable) {
      await expect(page.getByTestId('share-card-stat-average')).toBeVisible();
      await expect(page.getByTestId('share-card-stat-rank')).toBeVisible();
      await expect(page.getByTestId('share-card-stat-most-suspicious')).toBeVisible();
      await expect(page.getByTestId('share-card-suspicion-unavailable')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('share-card-suspicion-unavailable')).toHaveText('final suspicion unavailable');
      await expect(page.getByTestId('share-card-stat-average')).toHaveCount(0);
    }
    const quoteCount = await page.getByTestId('share-card-quote').count();
    expect(quoteCount).toBeLessThanOrEqual(3);

    const desktopButton = page.getByTestId('share-card-export');
    await expect(desktopButton).toBeEnabled();
    await expect(desktopButton).toHaveText(/Export PNG/);
    await page.screenshot({ path: test.info().outputPath('share-card-1440x900.png') });

    const desktopDownload = await expectPngDownload(
      page,
      desktopButton,
      expectedFileName,
      'share-card-1440x900-download.png',
    );
    expect(desktopDownload.fileName).toBe(expectedFileName);
    expect(desktopDownload.width).toBe(1080);
    expect(desktopDownload.height).toBe(1350);
    await expect(page.getByTestId('share-card-export-status')).toBeVisible();
    await expect(page.getByTestId('share-card-export-status')).toContainText(expectedFileName);
    await page.screenshot({ path: test.info().outputPath('share-card-1440x900-downloaded.png') });
    console.log(`[H2-E] 1440x900 download ${desktopDownload.fileName} (${desktopDownload.size} bytes, ${desktopDownload.width}x${desktopDownload.height})`);

    const desktopAfterDownload = await dialogMetrics(page);
    expect(desktopAfterDownload.scrollWidth).toBeLessThanOrEqual(desktopAfterDownload.clientWidth);

    // ── 390x844 (same dialog, real mobile viewport) ────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobilePageMetrics = await pageMetrics(page);
    const mobileDialogMetrics = await dialogMetrics(page);
    console.log(`[H2-E] 390x844 page scrollWidth/clientWidth = ${mobilePageMetrics.scrollWidth}/${mobilePageMetrics.clientWidth}`);
    console.log(`[H2-E] 390x844 dialog scrollWidth/clientWidth = ${mobileDialogMetrics.scrollWidth}/${mobileDialogMetrics.clientWidth}`);
    expect(mobilePageMetrics.innerWidth).toBe(390);
    expect(mobilePageMetrics.scrollWidth).toBeLessThanOrEqual(mobilePageMetrics.clientWidth);
    expect(mobileDialogMetrics.scrollWidth).toBeLessThanOrEqual(mobileDialogMetrics.clientWidth);

    await scrollShareCardIntoView(page);
    const mobileButton = page.getByTestId('share-card-export');
    await expect(mobileButton).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('share-card-390x844.png') });

    const mobileDownload = await expectPngDownload(
      page,
      mobileButton,
      expectedFileName,
      'share-card-390x844-download.png',
    );
    expect(mobileDownload.fileName).toBe(expectedFileName);
    expect(mobileDownload.width).toBe(1080);
    expect(mobileDownload.height).toBe(1350);
    console.log(`[H2-E] 390x844 download ${mobileDownload.fileName} (${mobileDownload.size} bytes, ${mobileDownload.width}x${mobileDownload.height})`);

    const mobileAfterDownload = await dialogMetrics(page);
    expect(mobileAfterDownload.scrollWidth).toBeLessThanOrEqual(mobileAfterDownload.clientWidth);
    await page.screenshot({ path: test.info().outputPath('share-card-390x844-downloaded.png') });

    // ── Zero panel network / zero provider calls ───────────────────────────
    expect(audit.functions).toEqual([]);
    expect(audit.external).toEqual(externalAtGameOver);
    expect(audit.external.length).toBe(externalAtGameOver.length);
    expect(providerRequests).toEqual([]);

    test.info().annotations.push({
      type: 'share-card',
      description: JSON.stringify({
        suspicionAvailable,
        quoteCount,
        expectedFileName,
        desktop: desktopDownload,
        mobile: mobileDownload,
      }),
    });
  });
});
