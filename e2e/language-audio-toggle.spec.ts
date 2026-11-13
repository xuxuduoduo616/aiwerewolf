import { expect, test } from '@playwright/test';
import { enterGuestLobby, startNinePlayerGame, watchProviderRequests } from './helpers/game';

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
