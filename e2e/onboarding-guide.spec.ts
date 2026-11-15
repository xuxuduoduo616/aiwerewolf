import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 720, height: 450 },
]) {
  test(`first-game guidance at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play as Guest', exact: true }).click();
    const guide = page.locator('.onboarding-spotlight');
    const panel = page.locator('.onboarding-panel');
    const next = panel.getByRole('button', { name: 'Next', exact: true });
    let originalPanel: Awaited<ReturnType<typeof panel.boundingBox>> = null;

    const checkStep = async (id: string) => {
      await expect(guide).toHaveAttribute('data-target-step', id);
      await expect(guide).toHaveAttribute('data-positioning', 'false');
      await expect(next).toBeEnabled();
      await expect(panel.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0);
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      originalPanel ??= bounds;
      expect(bounds).toEqual(originalPanel);
      expect(bounds!.y).toBeGreaterThan(viewport.height / 2);
      const highlight = (await page.locator('.onboarding-highlight').boundingBox())!;
      expect(highlight.y).toBeGreaterThanOrEqual(0);
      expect(highlight.y + highlight.height).toBeLessThanOrEqual(bounds!.y);
      expect(highlight.x).toBeGreaterThanOrEqual(0);
      expect(highlight.x + highlight.width).toBeLessThanOrEqual(viewport.width);
      const arrow = (await page.locator('.onboarding-direction-arrow').boundingBox())!;
      expect(arrow.y).toBeGreaterThanOrEqual(0);
      expect(arrow.y + arrow.height).toBeLessThanOrEqual(bounds!.y);
    };

    for (const id of ['wallet', 'promotions', 'navigation', 'start-game']) {
      await checkStep(id);
      if (id !== 'start-game') await next.click();
    }
    // Cover final Next, the highlighted Start Game, and Skip followed by Start Game.
    if (viewport.width === 1440) await next.click();
    else {
      if (viewport.width === 720) {
        await panel.getByRole('button', { name: 'Skip', exact: true }).click();
        await expect(guide).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'Start Game', exact: true }).click();
    }
    await checkStep('single-player');
    if (viewport.width === 1440) {
      await panel.getByRole('button', { name: 'Skip', exact: true }).click();
      await page.getByRole('button', { name: /Single-Player/ }).click();
    } else if (viewport.width === 720) await next.click();
    else await page.getByRole('button', { name: 'Single-Player', exact: true }).click();
    await checkStep('match-setup');
    if (viewport.width === 390) await page.keyboard.press('Escape');
    else await next.click();
    await expect(guide).toHaveCount(0);
    await page.getByRole('radio', { name: /12-Player Standard/ }).check();
    await expect(page.getByRole('radio', { name: /12-Player Standard/ })).toBeChecked();
    // Subsequent launches do not replay either first-game prompt.
    await page.getByRole('button', { name: 'Go back one step' }).click();
    await page.getByRole('button', { name: 'Go back one step' }).click();
    await page.getByRole('button', { name: 'Start Game', exact: true }).click();
    await expect(guide).toHaveCount(0);
    await page.getByRole('button', { name: /Single-Player/ }).click();
    await expect(page.getByRole('heading', { name: /Choose Board, Difficulty/ })).toBeVisible();
    await expect(guide).toHaveCount(0);
    if (viewport.width === 1440) {
      await page.reload();
      await page.getByRole('button', { name: 'Play as Guest', exact: true }).click();
      await page.getByRole('button', { name: 'Start Game', exact: true }).click();
      await expect(guide).toHaveCount(0);
      await page.getByRole('button', { name: /Single-Player/ }).click();
      await expect(page.getByRole('heading', { name: /Choose Board, Difficulty/ })).toBeVisible();
      await expect(guide).toHaveCount(0);
    }
  });
}
