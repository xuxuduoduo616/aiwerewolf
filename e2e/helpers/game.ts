import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared browser-flow helpers for the three smoke specs.
 *
 * Everything here drives the real UI through visible state. No fixed
 * `waitForTimeout` is used for progression: the only waiting primitives are
 * Playwright visibility assertions and `expect.poll`, which stops as soon as
 * the expected application state appears.
 */

/** Netlify Function endpoints that must never be needed by the smoke layer. */
const PROVIDER_FUNCTION_PATHS = new Set([
  '/.netlify/functions/genai-proxy',
  '/.netlify/functions/provider-adapter',
  '/.netlify/functions/bailian-tts',
]);

const PHASE_LABEL = '.game-room-phase-summary p';
const PLAYER_SEAT = '.game-player-seat';

export type AdvanceStatus = 'human' | 'dead' | 'voting';

/** Records any request to an external-AI/TTS Function so a spec can assert zero. */
export const watchProviderRequests = (page: Page): string[] => {
  const requests: string[] = [];
  page.on('request', request => {
    try {
      if (PROVIDER_FUNCTION_PATHS.has(new URL(request.url()).pathname)) {
        requests.push(request.url());
      }
    } catch {
      // Non-HTTP request URLs cannot hit the provider endpoints.
    }
  });
  return requests;
};

/** Login page → Guest Trial → Lobby, dismissing the auto-open first-run tour. */
export async function enterGuestLobby(page: Page): Promise<void> {
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Play as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();

  // The first-run spotlight opens automatically and makes the lobby inert, so
  // it must be gone before any lobby control can be located by role.
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
}

/**
 * The first-run spotlight locks the lobby behind a modal. It can also skip
 * itself when the highlighted target cannot be laid out, so treat it as
 * best-effort rather than a required step.
 */
async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const panel = page.locator('.onboarding-panel');
  await panel.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (!(await panel.isVisible().catch(() => false))) return;
  await panel.getByRole('button', { name: 'Skip', exact: true }).click().catch(() => undefined);
  await expect(panel).toHaveCount(0);
}

/** Lobby → Single-Player → 9-Player Standard → Start Game → game room. */
export async function startNinePlayerGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await page.getByRole('button', { name: /Single-Player/ }).click();
  await expect(page.getByRole('heading', { name: /Choose Board, Difficulty/ })).toBeVisible();

  const ninePlayerBoard = page.getByRole('radio', { name: /9-Player Standard/ });
  await expect(ninePlayerBoard).toBeChecked();

  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.getByText('Your role:')).toBeVisible();
  await expect(page.getByLabel('Werewolf seats and action console')).toBeVisible();
}

/** Leave the current match through the header and its confirmation dialog. */
export async function leaveGameToLobby(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Return to lobby' }).click();
  const leaveButton = page.getByRole('button', { name: 'Leave game', exact: true });
  const dialogShown = await leaveButton
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (dialogShown) await leaveButton.click();
  await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
}

/**
 * Plays the first night and advances the day until the human's own speech
 * turn, skipping AI speeches through the UI button. The human may hold any of
 * the six roles, so any night action the game is waiting on is completed here.
 *
 * Returns `dead` when the human was eliminated overnight (there is no human
 * speech turn in that match) and `voting` if discussion was reached without
 * offering the human a turn; the caller restarts the match in both cases.
 */
export async function advanceToHumanSpeech(page: Page, timeoutMs = 60_000): Promise<AdvanceStatus> {
  const speechInput = page.locator('[data-speech-input-row]');
  const skipSpeech = page.getByRole('button', { name: 'Skip speech', exact: true });
  const phaseLabel = page.locator(PHASE_LABEL);
  const humanSeat = page.locator(PLAYER_SEAT).first();

  let status: AdvanceStatus = 'human';
  await expect
    .poll(async () => {
      if (await speechInput.isVisible()) return (status = 'human');
      if (await humanSeat.getByText('OUT', { exact: true }).isVisible()) return (status = 'dead');

      const label = (await phaseLabel.innerText().catch(() => '')).trim();
      if (label === 'Exile Vote') return (status = 'voting');

      if (await skipSpeech.isVisible()) {
        await skipSpeech.click({ timeout: 1_000 }).catch(() => undefined);
        return 'waiting';
      }

      await completeNightAction(page);
      return 'waiting';
    }, { timeout: timeoutMs, intervals: [100, 200] })
    .toMatch(/^(human|dead|voting)$/);

  return status;
}

/** Advances AI speeches after the human has spoken, until the exile vote. */
export async function advanceToVoting(page: Page, timeoutMs = 60_000): Promise<'voting' | 'dead'> {
  const skipSpeech = page.getByRole('button', { name: 'Skip speech', exact: true });
  const phaseLabel = page.locator(PHASE_LABEL);
  const humanSeat = page.locator(PLAYER_SEAT).first();

  let status: 'voting' | 'dead' = 'voting';
  await expect
    .poll(async () => {
      if ((await phaseLabel.innerText().catch(() => '')).trim() === 'Exile Vote') return (status = 'voting');
      if (await humanSeat.getByText('OUT', { exact: true }).isVisible()) return (status = 'dead');
      if (await skipSpeech.isVisible()) {
        await skipSpeech.click({ timeout: 1_000 }).catch(() => undefined);
      }
      return 'waiting';
    }, { timeout: timeoutMs, intervals: [100, 200] })
    .toMatch(/^(voting|dead)$/);

  return status;
}

/** Selects one living non-human seat and casts the exile vote. */
export async function castExileVote(page: Page): Promise<void> {
  const voteButton = page.getByRole('button', { name: 'VOTE', exact: true });
  const seats = page.locator(`${PLAYER_SEAT} button`);
  const total = await seats.count();

  for (let index = 1; index < total; index += 1) {
    const seat = seats.nth(index);
    if (await seat.getByText('OUT', { exact: true }).isVisible()) continue;
    const selected = await seat.click({ timeout: 2_000 }).then(() => true).catch(() => false);
    if (!selected) continue;
    const enabled = await expect(voteButton)
      .toBeEnabled({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (!enabled) continue;
    await voteButton.click();
    return;
  }

  throw new Error('No living target was selectable during the exile vote.');
}

/**
 * Completes whichever night action the human role exposes. AI-driven phases
 * have no such button and simply advance after the fixed phase delay.
 */
async function completeNightAction(page: Page): Promise<void> {
  // The Witch always gets a PASS button; skipping potions keeps the flow short.
  const passButton = page.getByRole('button', { name: 'PASS', exact: true });
  if (await passButton.isVisible()) {
    await passButton.click({ timeout: 1_000 }).catch(() => undefined);
    return;
  }

  for (const actionName of ['KILL', 'CHECK', 'SHOOT'] as const) {
    const action = page.getByRole('button', { name: actionName, exact: true });
    if (!(await action.isVisible())) continue;
    if (await action.isEnabled()) {
      await action.click({ timeout: 1_000 }).catch(() => undefined);
      return;
    }
    await selectLivingTarget(page, action, actionName);
    return;
  }
}

/** Clicks candidate player cards until the given action becomes enabled. */
async function selectLivingTarget(
  page: Page,
  action: Locator,
  actionName: 'KILL' | 'CHECK' | 'SHOOT',
): Promise<void> {
  const seats = page.locator(`${PLAYER_SEAT} button`);
  const total = await seats.count();

  for (let index = 1; index < total; index += 1) {
    const seat = seats.nth(index);
    if (await seat.getByText('OUT', { exact: true }).isVisible()) continue;
    // A human Werewolf must not target a revealed packmate; the KILL button
    // stays disabled for those cards.
    if (actionName === 'KILL'
      && (await seat.locator('[aria-label="Werewolf teammate"]').count()) > 0) {
      continue;
    }
    const selected = await seat.click({ timeout: 2_000 }).then(() => true).catch(() => false);
    if (!selected) continue;
    const enabled = await expect(action)
      .toBeEnabled({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (!enabled) continue;
    await action.click({ timeout: 1_000 }).catch(() => undefined);
    return;
  }
}
