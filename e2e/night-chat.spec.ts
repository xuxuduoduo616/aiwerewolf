import { expect, test, type Page } from '@playwright/test';
import { enterGuestLobby, startNinePlayerGame } from './helpers/game';

test.use({ permissions: ['microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

const phaseLabel = '.game-room-phase-summary p';
const wolfEntries = '.game-room-sidebar [data-log-channel="wolf"]';
const INSTRUCTION = 'Player 2, please claim Seer tomorrow. Player 3, stay under the radar.';

const prepare = async (page: Page, wolf = true) => {
  // Stable role deal; this changes test randomness only, never application state.
  await page.addInitScript((value: number) => {
    Math.random = () => value;
    localStorage.setItem('werewolf_audio_prefs', JSON.stringify({ volume: 0, rate: 1, enabled: false }));
  }, wolf ? 0.5 : 0.1);
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') await route.abort();
    else await route.continue();
  });
  await enterGuestLobby(page);
  await startNinePlayerGame(page);
};

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1280, height: 720 }, { width: 720, height: 450 }]) {
  test(`private wolf chat, editable chips and kill/skip at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await prepare(page);
    await expect(page.getByText('Your role: Werewolf', { exact: true })).toBeVisible();
    await expect(page.locator(phaseLabel)).toHaveText('Werewolves Hunt');
    await expect(page.locator('.wolf-channel')).toHaveCount(0);
    await expect(page.locator(wolfEntries)).toHaveCount(0);
    const draft = page.getByRole('textbox', { name: 'Message your pack' });
    await page.getByRole('button', { name: 'Assign Teammate Roles', exact: true }).click();
    await expect(draft).toHaveValue(/Player 2, please claim Seer/);
    await expect(page.locator(wolfEntries)).toHaveCount(0);
    await page.getByRole('button', { name: 'Stay Under the Radar', exact: true }).click();
    await expect(draft).toHaveValue(/I will stay under the radar/);
    await draft.fill(INSTRUCTION);
    await page.getByRole('button', { name: 'Send to pack' }).click();
    await expect(page.locator(wolfEntries)).toHaveCount(3);
    await expect(page.locator(wolfEntries).nth(0)).toContainText(INSTRUCTION);
    await expect(page.locator(wolfEntries).nth(1)).toContainText('Player 2 · Marcus · Private');
    await expect(page.locator(wolfEntries).nth(1)).toContainText('Seer claim');
    await expect(page.locator(wolfEntries).nth(2)).toContainText('under the radar');
    for (const entry of await page.locator(wolfEntries).all()) {
      const text = await entry.innerText();
      expect(text).toMatch(/[.!?]$/);
    }
    const geometry = await page.evaluate(() => ({ width: window.innerWidth, doc: document.documentElement.scrollWidth, room: document.querySelector('.game-room')?.scrollWidth }));
    expect(geometry.doc).toBeLessThanOrEqual(geometry.width);
    for (const selector of ['.wolf-night-console', '.wolf-strategy-chips', '[data-speech-input-row]']) {
      const box = await page.locator(selector).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(geometry.width);
    }
    if (viewport.width >= 1024) {
      const seats = await page.locator('.game-player-seat > button').evaluateAll(elements => elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        return { seat: index + 1, reachable: Boolean(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.game-player-seat')) };
      }));
      expect(seats.filter(seat => !seat.reachable)).toEqual([]);
    }
    for (const chip of await page.locator('.wolf-strategy-chips button').all()) {
      const box = await chip.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: 'Open game log and records' }).click();
      const dialog = page.getByRole('dialog', { name: 'Game information' });
      await expect(dialog.locator('[data-log-channel="wolf"]')).toHaveCount(3);
      await dialog.locator('[data-log-channel="wolf"]').last().scrollIntoViewIfNeeded();
      await expect(dialog.locator('[data-log-channel="wolf"]').last()).toBeInViewport();
      await page.screenshot({ path: `output/playwright/night-chat-${viewport.width}-log.png` });
      await page.getByRole('button', { name: 'Close game information' }).click();
    }
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.screenshot({ path: `output/playwright/night-chat-${viewport.width}.png`, fullPage: true });
    await info.attach('night-chat', { path: `output/playwright/night-chat-${viewport.width}.png`, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.locator('.game-player-seat').nth(3).getByRole('button').click();
    await page.getByRole('button', { name: 'KILL', exact: true }).click();
    await expect(page.locator(phaseLabel)).toHaveText('Werewolves Hunt');
    await expect(page.getByText('Confirmed target: Player 4', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip night chat', exact: true }).click();
    await expect(page.locator(phaseLabel)).not.toHaveText('Werewolves Hunt');
    await expect(draft).toHaveCount(0);
  });
}

test('non-wolf does not see wolf communications or the night microphone', async ({ page }) => {
  await prepare(page, false);
  await expect(page.getByText('Your role: Villager', { exact: true })).toBeVisible();
  await expect(page.locator('.wolf-strategy-chips')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message your pack' })).toHaveCount(0);
  await expect(page.locator(wolfEntries)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record speech', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open game log and records' }).click();
  await expect(page.getByRole('dialog').locator('[data-log-channel="wolf"]')).toHaveCount(0);
});

test.describe('night voice input', () => {
  test('transcribes fake microphone input to an editable private draft before send', async ({ page }) => {
    await prepare(page);
    let asrRequests = 0;
    const transcript = 'Player 2, lead the push tomorrow.';
    await page.route('**/.netlify/functions/asr-transcribe', async route => {
      asrRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: transcript }) });
    });
    await expect(page.getByRole('textbox', { name: 'Message your pack' })).toBeVisible();
    await page.getByRole('button', { name: 'Record speech', exact: true }).click();
    await expect(page.locator('[data-voice-status]')).toHaveAttribute('data-voice-status', 'recording');
    await page.waitForTimeout(650); // Capture actual fake-device samples, not a phase delay.
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message your pack' })).toHaveValue(transcript);
    expect(asrRequests).toBeGreaterThan(0);
    await expect(page.locator(wolfEntries)).toHaveCount(0);
    await page.getByRole('button', { name: 'Send to pack' }).click();
    await expect(page.locator(wolfEntries)).toHaveCount(3);
    await expect(page.locator(wolfEntries).first()).toContainText(transcript);
  });
});
