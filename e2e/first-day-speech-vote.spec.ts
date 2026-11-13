import { expect, test } from '@playwright/test';
import {
  advanceToHumanSpeech,
  advanceToVoting,
  castExileVote,
  enterGuestLobby,
  leaveGameToLobby,
  startNinePlayerGame,
  watchProviderRequests,
} from './helpers/game';

const MAX_MATCH_ATTEMPTS = 4;
const HUMAN_SPEECH = 'The quietest seat on the moonlit trail has the loudest alibi.';

test.describe('first-day speech and exile vote', () => {
  test('the human can send a custom day-1 speech and cast an exile vote', async ({ page }) => {
    test.setTimeout(90_000);
    const providerRequests = watchProviderRequests(page);

    await enterGuestLobby(page);

    // The board shuffle can place the human night role anywhere, and the AI
    // wolves can eliminate the human before the first speech turn. In that
    // match there is no human day-1 speech to test, so start a fresh match.
    let reachedHumanSpeech = false;
    for (let attempt = 1; attempt <= MAX_MATCH_ATTEMPTS && !reachedHumanSpeech; attempt += 1) {
      await startNinePlayerGame(page);
      const status = await advanceToHumanSpeech(page);
      if (status === 'human') {
        reachedHumanSpeech = true;
        break;
      }
      test.info().annotations.push({
        type: 'match-retry',
        description: `attempt ${attempt}: human day-1 speech unavailable (${status})`,
      });
      await leaveGameToLobby(page);
    }
    expect(reachedHumanSpeech, 'human survived to the day-1 speech turn').toBe(true);

    await expect(page.getByText('It is your turn to speak publicly.')).toBeVisible();
    const speechInput = page.locator('[data-speech-input-row] input');
    await speechInput.fill(HUMAN_SPEECH);
    await page.getByRole('button', { name: 'Send speech' }).click();

    // The log feed shows the human translation field, which equals the
    // submitted speech; this proves the custom text reached the game log.
    await expect(page.getByText(HUMAN_SPEECH).first()).toBeVisible();
    await expect(page.getByText('It is your turn to speak publicly.')).toBeHidden();

    await expect(advanceToVoting(page)).resolves.toBe('voting');
    await expect(page.locator('.game-room-phase-summary p')).toHaveText('Exile Vote');

    await castExileVote(page);

    await expect(page.getByText(/You voted (for )?Player \d+\./).first()).toBeVisible();
    // The structured tally proves AI votes and the human vote were counted.
    await expect(page.getByText(/Vote record: \d+->/).first()).toBeVisible({ timeout: 25_000 });
    // The round always resolves to an exile, a tie, or an Idiot reveal.
    await expect(
      page.getByText(/Player \d+ was exiled\.|Tie vote\. No one is exiled\.|reveals as the Idiot/).first(),
    ).toBeVisible({ timeout: 15_000 });

    expect(providerRequests, 'the day-1 flow must not call external AI/TTS Functions').toEqual([]);
  });
});
