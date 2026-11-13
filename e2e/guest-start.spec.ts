import { expect, test } from '@playwright/test';
import { enterGuestLobby, startNinePlayerGame, watchProviderRequests } from './helpers/game';

test.describe('guest start', () => {
  test('a guest can start a 9-player match and sees the role reveal and night phase', async ({ page }) => {
    const providerRequests = watchProviderRequests(page);

    await enterGuestLobby(page);
    await startNinePlayerGame(page);

    await expect(page.getByText(/Your role: (Werewolf|Villager|Seer|Witch|Hunter|Idiot)/)).toBeVisible();

    const phaseLabel = page.locator('.game-room-phase-summary p');
    await expect
      .poll(async () => (await phaseLabel.innerText()).trim(), {
        timeout: 20_000,
        intervals: [100, 250, 500],
      })
      .toMatch(/^(Nightfall|Werewolves Hunt|Seer Checks|Witch Acts|Dawn Report|Day Discussion|Hunter Status|Exile Vote)$/);

    expect(providerRequests, 'the guest flow must not call external AI/TTS Functions').toEqual([]);
  });
});
