import { expect, test, type Locator } from '@playwright/test';
import { enterGuestLobby, skipMatchIntro, startNinePlayerGame, watchProviderRequests } from './helpers/game';

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

test('the match intro holds keyboard focus until it closes', async ({ page }) => {
  await enterGuestLobby(page);
  await page.evaluate(() => {
    const { id } = JSON.parse(localStorage.getItem('aiwerewolf:identity:guest:v1')!);
    localStorage.setItem(`aiwerewolf:game-controls-guide:v2:${id}`, 'seen');
  });
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await page.getByRole('button', { name: /Single-Player/ }).click();
  const guideSkip = page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true });
  if (await guideSkip.isVisible()) await guideSkip.click();

  // Control the avatar preload so the ceremony stays visible long enough to
  // exercise keyboard focus even when its other assets are already cached.
  let releaseAvatars!: () => void;
  const avatarsReady = new Promise<void>(resolve => { releaseAvatars = resolve; });
  await page.route('https://api.dicebear.com/**', async route => {
    await avatarsReady;
    await route.abort();
  });
  try {
    await page.getByRole('button', { name: 'Start Game', exact: true }).click();
    const intro = page.getByRole('dialog', { name: 'Match starting' });
    const skip = intro.getByRole('button', { name: 'Skip match intro' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(skip).toBeFocused();

    const exit = page.locator('.game-room [data-tour-target="game-exit"]');
    await exit.evaluate(button => (button as HTMLButtonElement).focus());
    await expect(skip).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(intro).toHaveCount(0);
    await expect(page.locator('.game-room-header')).toBeFocused();
    await exit.focus();
    await expect(exit).toBeFocused();
  } finally {
    releaseAvatars();
  }
});

test('desktop phase panel moves, resizes and docks without hiding the seats', async ({ page }) => {
  await page.setViewportSize({ width: 1380, height: 650 });
  await enterGuestLobby(page);
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await page.getByRole('button', { name: /Single-Player/ }).click();
  const guideSkip = page.locator('.onboarding-panel').getByRole('button', { name: 'Skip', exact: true });
  if (await guideSkip.isVisible()) await guideSkip.click();
  await page.getByRole('radio', { name: /12-Player Standard/ }).check();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.locator('.game-room')).toBeVisible();
  await skipMatchIntro(page);
  await expect(guideSkip).toBeVisible();
  await guideSkip.click();

  const board = page.getByRole('region', { name: 'Werewolf seats and action console' });
  const stage = board.locator('.phase-stage');
  const panel = stage.locator('.phase-panel');
  const grip = panel.getByRole('button', { name: 'Move phase panel' });
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(panel).toHaveCSS('background-color', 'rgba(5, 5, 5, 0.9)');
  await expect(panel).toHaveCSS('opacity', '1');

  const opacityButton = panel.getByRole('button', { name: /Phase panel opacity/ });
  await expect(opacityButton).toHaveText('90%');
  await opacityButton.click();
  const opacitySlider = panel.getByRole('slider', { name: 'Panel opacity' });
  await opacitySlider.press('Home');
  await expect(opacityButton).toHaveText('50%');
  await expect(panel).toHaveCSS('background-color', 'rgba(5, 5, 5, 0.5)');
  await opacitySlider.press('End');
  await expect(opacityButton).toHaveText('100%');
  await expect(panel).toHaveCSS('background-color', 'rgb(5, 5, 5)');
  await expect(panel).toHaveCSS('opacity', '1');
  await opacitySlider.press('Escape');
  await expect(opacitySlider).toBeHidden();
  await expect(opacityButton).toBeFocused();

  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  const drag = async (control: Locator, target: { x: number; y: number }) => {
    const at = (await control.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();
  };

  const initial = (await panel.boundingBox())!;
  const handle = panel.locator('.phase-panel-resize[data-edge="e"]');
  const corner = (await handle.boundingBox())!;
  // Shrink the visible edge of the initially full-width compact panel.
  await drag(handle, { x: corner.x - 115, y: corner.y + corner.height / 2 });
  await expect(stage).toHaveAttribute('data-phase-layout', 'floating');
  const resized = (await panel.boundingBox())!;
  expect(resized.width).toBeLessThan(initial.width - 60);
  const gripBox = (await grip.boundingBox())!;
  await drag(grip, { x: gripBox.x + gripBox.width / 2 + 45, y: gripBox.y + gripBox.height / 2 });
  await expect(stage).toHaveAttribute('data-phase-layout', 'floating');
  const relocated = (await panel.boundingBox())!;
  expect(relocated.x).toBeGreaterThan(resized.x + 20);

  await grip.press('Shift+ArrowUp');
  expect((await panel.boundingBox())!.height).toBeLessThan(relocated.height);

  const inside = (await board.boundingBox())!;
  await drag(grip, { x: inside.x + inside.width - 10, y: inside.y + 100 });
  await expect(stage).toHaveAttribute('data-phase-layout', 'right');
  let panelBox = (await panel.boundingBox())!;
  for (const seat of await stage.locator('.game-player-seat button').all()) {
    const rect = (await seat.boundingBox())!;
    expect(rect.x + rect.width).toBeLessThanOrEqual(panelBox.x);
  }

  await drag(grip, { x: inside.x + 12, y: inside.y + 100 });
  await expect(stage).toHaveAttribute('data-phase-layout', 'left');
  panelBox = (await panel.boundingBox())!;
  for (const seat of await stage.locator('.game-player-seat button').all()) {
    const rect = (await seat.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(panelBox.x + panelBox.width);
  }

  await drag(grip, { x: inside.x + inside.width / 2, y: inside.y + inside.height - 8 });
  await expect(stage).toHaveAttribute('data-phase-layout', 'bottom');
  panelBox = (await panel.boundingBox())!;
  for (const seat of await stage.locator('.game-player-seat button').all()) {
    const rect = (await seat.boundingBox())!;
    expect(rect.y + rect.height).toBeLessThanOrEqual(panelBox.y);
  }
  await expect.poll(() => board.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await board.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => board.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await expect(panel.getByRole('button', { name: 'Resume' })).toBeInViewport();
  await panel.getByRole('button', { name: 'Reset phase panel layout' }).click();
  await expect(stage).toHaveAttribute('data-phase-layout', 'center');
  await expect(opacityButton).toHaveText('100%');

  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(grip).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Resume' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
