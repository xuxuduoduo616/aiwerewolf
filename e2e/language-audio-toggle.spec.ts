import { expect, test } from '@playwright/test';
import { enterGuestLobby, startNinePlayerGame, leaveGameToLobby, watchProviderRequests } from './helpers/game';
import { GUEST_IDENTITY_STORAGE_KEY } from '../src/identity/publicIdentity';

const LANGUAGE_STORAGE_KEY = 'werewolf_display_language';
const AUDIO_PREFS_KEY = 'werewolf_audio_prefs';

test.describe('language and audio toggles', () => {
  test('Settings switches the AI speech language and the game room toggles AI voice', async ({ page }) => {
    const providerRequests = watchProviderRequests(page);

    await enterGuestLobby(page);

    await page.getByRole('button', { name: 'Open utility menu' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();

    const englishToggle = page.getByRole('button', { name: 'AI speech language: English' });
    await expect(englishToggle).toBeVisible();
    await englishToggle.click();

    await expect(page.getByRole('button', { name: 'AI speech language: Chinese' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(key => localStorage.getItem(key), LANGUAGE_STORAGE_KEY))
      .toBe('zh');

    await page.getByRole('button', { name: 'Return to utility menu' }).click();
    await page.getByRole('button', { name: 'Close utility menu' }).click();
    await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();

    await startNinePlayerGame(page);

    const voiceToggle = page.getByRole('button', { name: 'Toggle AI voice' });
    await expect(voiceToggle).toHaveAttribute('aria-pressed', 'true');
    await voiceToggle.click();
    await expect(voiceToggle).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() => page.evaluate(key => {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as { enabled?: boolean }).enabled : null;
      }, AUDIO_PREFS_KEY))
      .toBe(false);

    expect(providerRequests, 'the settings/audio flow must not call external AI/TTS Functions').toEqual([]);
  });
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 720, height: 450 },
  { width: 320, height: 568 },
]) {
  test(`in-game control guide and labeled audio at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const providerRequests = watchProviderRequests(page);
    await enterGuestLobby(page);
    // Neither the old guide nor another player's new guide suppresses this one.
    await page.evaluate(guestKey => {
      const { id } = JSON.parse(localStorage.getItem(guestKey)!);
      localStorage.setItem(`aiwerewolf:game-controls-guide:v1:${id}`, 'seen');
      localStorage.setItem('aiwerewolf:game-controls-guide:v2:other-player', 'seen');
    }, GUEST_IDENTITY_STORAGE_KEY);
    if (viewport.width === 720) {
      await page.evaluate(() => {
        const read = Storage.prototype.getItem;
        const write = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key.startsWith('aiwerewolf:game-controls-guide:')) throw new Error('Test storage unavailable');
          return read.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('aiwerewolf:game-controls-guide:')) throw new Error('Test storage unavailable');
          return write.call(this, key, value);
        };
      });
    }
    await expect(page.locator('[data-target-step="game-voice"]')).toHaveCount(0);
    await startNinePlayerGame(page, false);
    const guide = page.locator('.onboarding-spotlight');
    const panel = page.locator('.onboarding-panel');
    await expect(guide).toHaveAttribute('data-target-step', 'game-voice');
    await expect(page.locator('.game-room')).toHaveAttribute('inert', '');
    await expect(page.locator('.game-pause-button')).toHaveText('Resume');
    const phase = await page.locator('.game-room-phase-summary p').innerText();
    const stepIds = ['game-voice', 'game-volume', 'game-rate', 'game-mute', 'game-log', 'game-phase-layout', 'game-phase-opacity', 'game-exit'];
    for (const [index, id] of stepIds.entries()) {
      await expect(guide).toHaveAttribute('data-target-step', id);
      await expect(guide).toHaveAttribute('data-positioning', 'false');
      await expect(panel.locator('#onboarding-position')).toHaveText(`Step ${index + 1} of 8`);
      if (id === 'game-phase-layout') {
        await expect(panel.getByRole('heading')).toHaveText('Move the Phase panel');
        await expect(panel).toContainText('left, right, or bottom edge');
      } else if (id === 'game-phase-opacity') {
        await expect(panel.getByRole('heading')).toHaveText('Phase panel opacity');
        await expect(panel).toContainText('50% to 100%');
      }
      const target = page.locator(`[data-tour-target="${id}"]`);
      if (viewport.width < 1024 && id.startsWith('game-phase-')) {
        await expect(target).toBeHidden();
        await expect(panel).toContainText('On desktop');
        await expect(guide.locator('.onboarding-highlight, .onboarding-direction-arrow')).toHaveCount(0);
      } else {
        const targetBounds = (await target.boundingBox())!;
        const highlight = (await page.locator('.onboarding-highlight').boundingBox())!;
        const panelBounds = (await panel.boundingBox())!;
        expect(highlight.x).toBeLessThanOrEqual(targetBounds.x);
        expect(highlight.x + highlight.width).toBeGreaterThanOrEqual(targetBounds.x + targetBounds.width);
        expect(highlight.y).toBeLessThanOrEqual(targetBounds.y);
        expect(highlight.y + highlight.height).toBeGreaterThanOrEqual(targetBounds.y + targetBounds.height);
        expect(highlight.y + highlight.height).toBeLessThanOrEqual(panelBounds.y);
        await expect(page.locator('.onboarding-direction-arrow')).toBeVisible();
      }
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.onboarding-panel')))).toBe(true);
      if (index === 1) {
        await panel.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(guide).toHaveAttribute('data-target-step', 'game-voice');
        await panel.getByRole('button', { name: 'Next', exact: true }).click();
      }
      if (id === 'game-phase-opacity') {
        await panel.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(panel.locator('#onboarding-position')).toHaveText('Step 6 of 8');
        await panel.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(panel.locator('#onboarding-position')).toHaveText('Step 7 of 8');
      }
      if (index === 0) await page.screenshot({ path: `output/playwright/game-controls-guide-${viewport.width}.png` });
      await panel.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(guide).toHaveCount(0);
    await expect(page.locator('.game-room')).not.toHaveAttribute('inert');
    await expect(page.locator('.game-pause-button')).toHaveText('Pause');
    // No phase progression occurred while the player read all eight hints.
    await expect(page.locator('.game-room-phase-summary p')).toHaveText(phase);
    const volume = page.getByRole('slider', { name: 'Volume', exact: true });
    const rate = page.getByRole('slider', { name: 'Speech rate', exact: true });
    await volume.fill('0.5');
    await volume.press('ArrowRight');
    await expect(volume).toHaveValue('0.55');
    await expect(page.locator('[data-tour-target="game-volume"]')).toContainText('55%');
    await rate.fill('1.5');
    await rate.press('ArrowLeft');
    await expect(rate).toHaveValue('1.4');
    await expect(page.locator('[data-tour-target="game-rate"]')).toContainText('1.4×');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('werewolf_audio_prefs') || '{}')))
      .toMatchObject({ volume: 0.55, rate: 1.4 });
    const mute = page.getByRole('button', { name: 'Mute or unmute' });
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await expect(mute).toContainText('Muted');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    const controls = page.locator('.game-room-audio-controls');
    const geometry = await controls.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    for (const locator of [volume, rate, page.getByRole('button', { name: 'Toggle AI voice' }), mute]) {
      const box = (await locator.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const exit = page.getByRole('button', { name: 'exit the game', exact: true });
    await expect(exit).toHaveAttribute('title', 'exit the game');
    await expect(exit.locator('svg')).toHaveClass(/lucide-log-out/);
    await page.screenshot({ path: `output/playwright/game-controls-${viewport.width}.png` });
    await exit.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.game-room')).toBeVisible();
    await leaveGameToLobby(page);
    await startNinePlayerGame(page, false);
    await expect(guide).toHaveCount(0);
    if (viewport.width === 1440) {
      await page.reload();
      await page.getByRole('button', { name: 'Play as Guest', exact: true }).click();
      await startNinePlayerGame(page, false);
      await expect(guide).toHaveCount(0);
      await expect(volume).toHaveValue('0.55');
      await expect(rate).toHaveValue('1.4');
    }
    expect(providerRequests).toEqual([]);
  });
}

for (const dismissal of ['Skip', 'Escape'] as const) {
  test(`dismiss in-game guide with ${dismissal} and resume only once`, async ({ page }) => {
    await enterGuestLobby(page);
    await startNinePlayerGame(page, false);
    const guide = page.locator('.onboarding-spotlight');
    await expect(guide).toHaveAttribute('data-target-step', 'game-voice');
    await expect(guide).toHaveAttribute('data-positioning', 'false');
    await expect(page.locator('.game-pause-button')).toHaveText('Resume');
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(guide).toHaveCount(0);
    await expect(page.locator('.game-pause-button')).toHaveText('Pause');
    await expect(page.locator('.game-room')).not.toHaveAttribute('aria-hidden');
    await expect(page.getByRole('button', { name: 'Toggle AI voice' })).toBeFocused();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await leaveGameToLobby(page);
    await startNinePlayerGame(page, false);
    await expect(guide).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });
}
