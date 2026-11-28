import { expect, test, type Locator, type Page } from '@playwright/test';
import { leaveGameToLobby, skipMatchIntro } from './helpers/game';

const LEGACY_AVATAR_HOST = ['api', ['dice', 'bear'].join(''), 'com'].join('.');
const LEGACY_PROMPT_LABEL = ['Art', 'prompt', 'metadata'].join(' ');

const SKIN_IDS = [
  'mist-wanderer',
  'bamboo-vigil',
  'tidal-swordsman',
  'moonlit-crane',
  'jade-moon-oath',
  'tidebreaker-vow',
  'crimson-lotus-shadow',
] as const;

const TIDAL_SKIN_IDS = [
  'tidal-swordsman',
  'moonlit-crane',
  'tidebreaker-vow',
  'crimson-lotus-shadow',
] as const;

const BASIC_SKIN_IDS = [
  'mist-wanderer',
  'bamboo-vigil',
  'tidal-swordsman',
  'moonlit-crane',
] as const;

const PREMIUM_SKIN_IDS = [
  'jade-moon-oath',
  'tidebreaker-vow',
  'crimson-lotus-shadow',
] as const;

const CHECK_IN_REWARDS = [30, 40, 50, 60, 70, 100, 250] as const;

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, desktopStage: true },
  { name: '768x1024', width: 768, height: 1024, desktopStage: false },
  { name: '390x844', width: 390, height: 844, desktopStage: false },
] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RuntimeMonitor {
  consoleErrors: string[];
  pageErrors: string[];
  legacyAvatarRequests: string[];
}

function buildValidGuestLedger(principalId: string, streakDays: number) {
  const startUtcMs = Date.UTC(2025, 0, 1, 12, 0, 0);
  const events: Array<Record<string, unknown>> = [
    {
      id: 'tutorial:finish:v1',
      idempotencyKey: 'tutorial:finish:v1',
      type: 'TUTORIAL_FINISHED',
      occurredAt: new Date(startUtcMs - 60_000).toISOString(),
      localDay: '2025-01-01',
      delta: { coins: 200, crystals: 0 },
    },
  ];

  const milestonesByDay = new Map<number, { coins: number; crystals: number }>([
    [7, { coins: 0, crystals: 0 }],
    [14, { coins: 300, crystals: 0 }],
    [30, { coins: 0, crystals: 3 }],
    [60, { coins: 0, crystals: 0 }],
    [90, { coins: 0, crystals: 8 }],
  ]);

  for (let day = 1; day <= streakDays; day += 1) {
    const date = new Date(startUtcMs + (day - 1) * 86_400_000);
    const localDay = `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const milestone = milestonesByDay.get(day);
    const baseCoins = CHECK_IN_REWARDS[(day - 1) % CHECK_IN_REWARDS.length];
    const key = `check-in:${localDay}`;
    events.push({
      id: key,
      idempotencyKey: key,
      type: 'CHECK_IN',
      occurredAt: date.toISOString(),
      localDay,
      delta: {
        coins: baseCoins + (milestone?.coins ?? 0),
        crystals: milestone?.crystals ?? 0,
      },
      streak: day,
      milestoneDays: milestone ? [day] : [],
    });
  }

  return {
    schema: 'aiwerewolf.guest-economy-ledger',
    version: 1,
    namespace: principalId,
    events,
  };
}

function attachRuntimeMonitor(page: Page): RuntimeMonitor {
  const monitor: RuntimeMonitor = {
    consoleErrors: [],
    pageErrors: [],
    legacyAvatarRequests: [],
  };
  page.on('console', msg => {
    if (msg.type() === 'error') {
      monitor.consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', error => {
    // Dev server on :5173 runs without VITE_TURNSTILE_SITE_KEY; LoginView mounts
    // TurnstileWidget for the account panel, which throws a sitekey-undefined
    // error when challenges.cloudflare.com is reachable. Exclude only that
    // dev-env artifact so all app errors still fail the spec.
    if (error.message.includes('[Cloudflare Turnstile]') && error.message.includes('sitekey')) {
      return;
    }
    monitor.pageErrors.push(error.message);
  });
  page.on('request', request => {
    const url = request.url();
    if (url.toLowerCase().includes(LEGACY_AVATAR_HOST)) {
      monitor.legacyAvatarRequests.push(url);
    }
  });
  return monitor;
}

function assertCleanRuntime(monitor: RuntimeMonitor): void {
  expect(monitor.consoleErrors, 'zero browser console errors').toEqual([]);
  expect(monitor.pageErrors, 'zero uncaught page errors').toEqual([]);
  expect(monitor.legacyAvatarRequests, 'zero legacy external avatar requests').toEqual([]);
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

async function assertNoHorizontalOverflow(page: Page, contextLabel: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${contextLabel}: scrollWidth (${metrics.scrollWidth}) must not exceed innerWidth (${metrics.innerWidth})`,
  ).toBeLessThanOrEqual(metrics.innerWidth);
}

async function assertImageLoaded(img: Locator, expectedSrcFragment: string, expectedExactWidth?: number): Promise<void> {
  await img.scrollIntoViewIfNeeded();
  await expect(img).toBeVisible();
  await expect
    .poll(
      async () => img.evaluate(el => {
        const node = el as HTMLImageElement;
        return {
          src: node.getAttribute('src') ?? '',
          complete: node.complete,
          naturalWidth: node.naturalWidth,
          naturalHeight: node.naturalHeight,
        };
      }),
      { timeout: 15_000, intervals: [100, 250] },
    )
    .toMatchObject({
      complete: true,
      ...(expectedExactWidth ? { naturalWidth: expectedExactWidth } : {}),
    });

  const info = await img.evaluate(el => {
    const node = el as HTMLImageElement;
    return {
      src: node.getAttribute('src') ?? '',
      complete: node.complete,
      naturalWidth: node.naturalWidth,
      naturalHeight: node.naturalHeight,
    };
  });
  expect(info.src).toContain(expectedSrcFragment);
  expect(info.complete).toBe(true);
  expect(info.naturalWidth).toBeGreaterThan(0);
  expect(info.naturalHeight).toBeGreaterThan(0);
  if (expectedExactWidth) {
    expect(info.naturalWidth).toBe(expectedExactWidth);
  }
}

async function assertAllVisibleImagesLoaded(page: Page): Promise<void> {
  const broken = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs
      .filter(img => {
        const rect = img.getBoundingClientRect();
        const style = window.getComputedStyle(img);
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      })
      .filter(img => !img.complete || img.naturalWidth === 0)
      .map(img => img.getAttribute('src') ?? '(missing src)');
  });
  expect(broken, 'all visible <img> elements must finish loading with naturalWidth > 0').toEqual([]);
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const panel = page.locator('.onboarding-panel');
  if (await panel.isVisible().catch(() => false)) {
    await panel.getByRole('button', { name: 'Skip', exact: true }).click().catch(() => undefined);
    await expect(panel).toHaveCount(0);
  }
}

async function enterSeededGuestLobby(page: Page, principalId: string, streakDays: number): Promise<void> {
  const ledger = buildValidGuestLedger(principalId, streakDays);
  await page.goto('/');
  await page.evaluate(
    ({ id, ledgerData }) => {
      localStorage.setItem(
        'aiwerewolf:identity:guest:v1',
        JSON.stringify({ schema: 'aiwerewolf.guest-identity', version: 1, id }),
      );
      localStorage.setItem(`aiwerewolf:economy:v1:${id}:ledger`, JSON.stringify(ledgerData));
      localStorage.setItem(`aiwerewolf:first-start-guide:v1:${id}`, 'seen');
      localStorage.setItem(`aiwerewolf:game-controls-guide:v2:${id}`, 'seen');
    },
    { id: principalId, ledgerData: ledger },
  );
  await page.reload();
  const guestButton = page.getByRole('button', { name: 'Play as Guest', exact: true });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await dismissOnboardingIfPresent(page);
  await expect(page.locator('[data-tour-target="start-game"]')).toBeVisible();
}

async function startMatchWithPlayerCount(page: Page, count: 9 | 12): Promise<void> {
  await page.locator('[data-tour-target="start-game"]').click();
  await dismissOnboardingIfPresent(page);
  await page.getByRole('button', { name: /Single-Player/ }).click();
  await dismissOnboardingIfPresent(page);
  await expect(page.getByRole('heading', { name: /Choose Board, Difficulty/ })).toBeVisible();
  const boardRadio = page.getByRole('radio', { name: count === 12 ? /12-Player Standard/ : /9-Player Standard/ });
  await boardRadio.check();
  await expect(boardRadio).toBeChecked();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.locator('.game-room')).toBeVisible();
  await skipMatchIntro(page);
  await dismissOnboardingIfPresent(page);
  await expect(page.getByLabel('Werewolf seats and action console')).toBeVisible();
}

async function verifyMatchSeats(
  page: Page,
  count: 9 | 12,
  expectedSkinId: string,
  expectedFrame: 'ink-ring' | 'crimson-moon' | null,
): Promise<void> {
  const seats = page.locator('.game-player-seat');
  await expect(seats).toHaveCount(count);

  const seat1 = seats.nth(0);
  const seat1Avatar = seat1.locator('.wuxia-avatar');
  if (expectedFrame) {
    await expect(seat1Avatar).toHaveAttribute('data-avatar-frame', expectedFrame);
  }
  await assertImageLoaded(seat1Avatar.locator('img'), `/assets/skins/${expectedSkinId}/avatar.webp`, 512);

  const seenAiSrcs = new Set<string>();
  for (let index = 1; index < count; index += 1) {
    const seatImg = seats.nth(index).locator('.wuxia-avatar img');
    const expectedPath = `/assets/avatars/ai-${String(index + 1).padStart(2, '0')}.webp`;
    await assertImageLoaded(seatImg, expectedPath, 512);
    const actualSrc = (await seatImg.getAttribute('src')) ?? '';
    seenAiSrcs.add(actualSrc);
  }
  expect(seenAiSrcs.size, `seats 2..${count} must render ${count - 1} distinct local AI folk avatars`).toBe(count - 1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Wuxia Skin Upgrade (${viewport.name})`, () => {
    test('Skin Store renders all 7 skins, filters accurately, hides prompt metadata, and previews surfaces', async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const monitor = attachRuntimeMonitor(page);

      const principalId = 'guest:11111111-1111-4111-8111-111111111111';
      await enterSeededGuestLobby(page, principalId, 7);
      await assertNoHorizontalOverflow(page, `Lobby ${viewport.name}`);

      await page.getByRole('button', { name: 'Shop', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Wuxia Skin Store', exact: true })).toBeVisible();
      await assertNoHorizontalOverflow(page, `Skin Store ${viewport.name}`);

      // Zero prompt metadata elements or text.
      await expect(page.locator('.skin-prompt-metadata')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toContain(LEGACY_PROMPT_LABEL);

      // All 7 skins render local WebP portraits with complete && naturalWidth > 0.
      const cards = page.locator('.skin-grid .skin-card');
      await expect(cards).toHaveCount(7);
      for (const skinId of SKIN_IDS) {
        const img = page.locator(`.skin-artwork[data-skin-id="${skinId}"] img`);
        await assertImageLoaded(img, `/assets/skins/${skinId}/portrait.webp`);
      }

      // Filter buttons filter cards accurately.
      const filterGroup = page.getByRole('group', { name: 'Filter cosmetics' });

      await filterGroup.getByRole('button', { name: 'Tidal Season', exact: true }).click();
      await expect(cards).toHaveCount(TIDAL_SKIN_IDS.length);
      for (const skinId of TIDAL_SKIN_IDS) {
        await expect(page.locator(`.skin-artwork[data-skin-id="${skinId}"]`)).toHaveCount(1);
      }

      await filterGroup.getByRole('button', { name: 'Basic · Coins', exact: true }).click();
      await expect(cards).toHaveCount(BASIC_SKIN_IDS.length);
      for (const skinId of BASIC_SKIN_IDS) {
        await expect(page.locator(`.skin-artwork[data-skin-id="${skinId}"]`)).toHaveCount(1);
      }

      await filterGroup.getByRole('button', { name: 'Premium · Crystals', exact: true }).click();
      await expect(cards).toHaveCount(PREMIUM_SKIN_IDS.length);
      for (const skinId of PREMIUM_SKIN_IDS) {
        await expect(page.locator(`.skin-artwork[data-skin-id="${skinId}"]`)).toHaveCount(1);
      }

      await filterGroup.getByRole('button', { name: 'All Skins', exact: true }).click();
      await expect(cards).toHaveCount(7);

      // Preview dialog shows 3:4 portrait, match-seat avatar, and lobby-badge avatar; Escape closes it.
      const targetCard = page.locator('.skin-card').filter({ has: page.locator('.skin-artwork[data-skin-id="crimson-lotus-shadow"]') });
      await targetCard.getByRole('button', { name: /Preview/ }).click();

      const previewDialog = page.getByRole('dialog', { name: 'Crimson Lotus Shadow' });
      await expect(previewDialog).toBeVisible();
      const largePortrait = previewDialog.locator('.skin-artwork--large img');
      await assertImageLoaded(largePortrait, '/assets/skins/crimson-lotus-shadow/portrait.webp');
      const portraitBox = (await previewDialog.locator('.skin-artwork--large').boundingBox())!;
      expect(portraitBox.width / portraitBox.height).toBeGreaterThan(0.65);
      expect(portraitBox.width / portraitBox.height).toBeLessThan(0.85);

      const matchSeatPreview = previewDialog.locator('[data-preview-surface="match-seat"] img');
      await assertImageLoaded(matchSeatPreview, '/assets/skins/crimson-lotus-shadow/avatar.webp', 512);

      const lobbyBadgePreview = previewDialog.locator('[data-preview-surface="lobby-badge"] img');
      await assertImageLoaded(lobbyBadgePreview, '/assets/skins/crimson-lotus-shadow/avatar.webp', 512);

      await page.keyboard.press('Escape');
      await expect(previewDialog).toHaveCount(0);

      await assertAllVisibleImagesLoaded(page);
      await assertNoHorizontalOverflow(page, `Skin Store post-preview ${viewport.name}`);
      assertCleanRuntime(monitor);
    });

    test('Milestone frames (crimson-moon > ink-ring), guest unlock/equip, Lobby outfit preview, Profile Equip Default, and 9/12-player matches', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const monitor = attachRuntimeMonitor(page);

      // ── Phase 1: Day 7 milestone (ink-ring) ────────────────────────────
      const day7Principal = 'guest:22222222-2222-4222-8222-222222222222';
      await enterSeededGuestLobby(page, day7Principal, 7);

      const lobbyAvatar = page.locator('.night-identity-trigger .wuxia-avatar');
      await expect(lobbyAvatar).toHaveAttribute('data-avatar-frame', 'ink-ring');
      await assertImageLoaded(lobbyAvatar.locator('img'), '/assets/skins/default/avatar.webp', 512);

      await page.getByRole('button', { name: 'Profile', exact: true }).click();
      const profileAvatar = page.locator('.wol-profile-header .wuxia-avatar');
      await expect(profileAvatar).toHaveAttribute('data-avatar-frame', 'ink-ring');
      await assertImageLoaded(profileAvatar.locator('img'), '/assets/skins/default/avatar.webp', 512);
      await assertNoHorizontalOverflow(page, `Profile Day 7 ${viewport.name}`);

      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await startMatchWithPlayerCount(page, 9);
      await verifyMatchSeats(page, 9, 'default', 'ink-ring');
      await assertNoHorizontalOverflow(page, `9-player match Day 7 ${viewport.name}`);
      await leaveGameToLobby(page);

      // ── Phase 2: Day 90 milestone (crimson-moon overrides ink-ring) ────
      const day90Principal = 'guest:33333333-3333-4333-8333-333333333333';
      await enterSeededGuestLobby(page, day90Principal, 90);

      // Verify crimson-moon overrides ink-ring in Lobby immediately.
      await expect(lobbyAvatar).toHaveAttribute('data-avatar-frame', 'crimson-moon');
      await assertImageLoaded(lobbyAvatar.locator('img'), '/assets/skins/default/avatar.webp', 512);

      // Unlock Bamboo Vigil (1,400 Coins) and Equip in Skin Store.
      await page.getByRole('button', { name: 'Shop', exact: true }).click();
      const bambooCard = page.locator('.skin-card').filter({ has: page.locator('.skin-artwork[data-skin-id="bamboo-vigil"]') });
      const unlockButton = bambooCard.getByRole('button', { name: /Unlock Bamboo Vigil/ });
      await unlockButton.scrollIntoViewIfNeeded();
      await expect(unlockButton).toBeEnabled();
      await unlockButton.click();

      const equipButton = bambooCard.getByRole('button', { name: 'Equip', exact: true });
      await expect(equipButton).toBeVisible();
      await equipButton.click();
      await expect(bambooCard.getByRole('button', { name: /Equipped/ })).toBeDisabled();

      // Return to Lobby and verify the outfit preview and unobstructed layout.
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await expect(lobbyAvatar).toHaveAttribute('data-avatar-frame', 'crimson-moon');
      await assertImageLoaded(lobbyAvatar.locator('img'), '/assets/skins/bamboo-vigil/avatar.webp', 512);
      await assertNoHorizontalOverflow(page, `Lobby Day 90 equipped ${viewport.name}`);

      const scrollCard = page.locator('.night-scroll-card');
      const identityTrigger = page.locator('.night-identity-trigger');
      const startGameButton = page.locator('[data-tour-target="start-game"]');

      await expect(scrollCard).toHaveCount(0);
      await expect(identityTrigger).toBeVisible();

      if (viewport.desktopStage) {
        // Clicking the top-left identity avatar trigger opens HD preview dialog; clicking Open Wardrobe navigates to Profile.
        await identityTrigger.click();
        const hdDialog = page.getByRole('dialog', { name: 'Bamboo Vigil' });
        await expect(hdDialog).toBeVisible();
        await assertImageLoaded(hdDialog.locator('.night-outfit-preview-portrait img'), '/assets/skins/bamboo-vigil/portrait.webp');
        await hdDialog.getByRole('button', { name: 'Open Wardrobe', exact: true }).click();
        await expect(page.locator('.wol-profile-view')).toBeVisible();
      } else {
        const triggerBox = (await identityTrigger.boundingBox())!;
        expect(triggerBox.width, '.night-identity-trigger width >= 44px').toBeGreaterThanOrEqual(44);
        expect(triggerBox.height, '.night-identity-trigger height >= 44px').toBeGreaterThanOrEqual(44);

        await expect(startGameButton).toBeVisible();
        const startBox = (await startGameButton.boundingBox())!;
        const bgmBox = (await page.locator('[data-tour-target="bgm-player"]').boundingBox())!;
        expect(boxesOverlap(startBox, bgmBox), 'Start Game must not be overlapped by BGM player').toBe(false);
        const startCenterHit = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return Boolean(el?.closest('[data-tour-target="start-game"]'));
        }, { x: startBox.x + startBox.width / 2, y: startBox.y + startBox.height / 2 });
        expect(startCenterHit, 'Start Game button center must be unobstructed').toBe(true);

        await page.getByRole('button', { name: 'Profile', exact: true }).click();
        await expect(page.locator('.wol-profile-view')).toBeVisible();
      }

      // ── Phase 3: 12-player match with equipped skin & crimson-moon ─────
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await startMatchWithPlayerCount(page, 12);
      await verifyMatchSeats(page, 12, 'bamboo-vigil', 'crimson-moon');
      await assertAllVisibleImagesLoaded(page);
      await assertNoHorizontalOverflow(page, `12-player match equipped ${viewport.name}`);
      await leaveGameToLobby(page);

      // ── Phase 4: Profile Outfits & Skins tabs + Equip Default ──────────
      await page.getByRole('button', { name: 'Profile', exact: true }).click();
      await expect(profileAvatar).toHaveAttribute('data-avatar-frame', 'crimson-moon');
      await assertImageLoaded(profileAvatar.locator('img'), '/assets/skins/bamboo-vigil/avatar.webp', 512);

      // Outfits tab (default active): Bamboo Vigil is Equipped, Default Outfit has enabled Equip Default.
      const outfitsPanel = page.locator('.wol-tabpanel');
      await expect(outfitsPanel.locator('[data-owned-skin="bamboo-vigil"] .skin-primary-action')).toHaveText('Equipped');
      await expect(outfitsPanel.locator('[data-owned-skin="bamboo-vigil"] .skin-primary-action')).toBeDisabled();
      await expect(outfitsPanel.locator('[data-owned-skin="default"] .skin-primary-action')).toHaveText('Equip Default');
      await expect(outfitsPanel.locator('[data-owned-skin="default"] .skin-primary-action')).toBeEnabled();

      // Equip Mist Wanderer (Day 60 milestone owned skin) from Outfits tab.
      const equipMistBtn = outfitsPanel.locator('[data-owned-skin="mist-wanderer"] .skin-primary-action');
      await equipMistBtn.scrollIntoViewIfNeeded();
      await equipMistBtn.click();
      await expect(equipMistBtn).toHaveText('Equipped');
      await expect(equipMistBtn).toBeDisabled();
      await expect(outfitsPanel.locator('[data-owned-skin="default"] .skin-primary-action')).toBeEnabled();
      await assertImageLoaded(profileAvatar.locator('img'), '/assets/skins/mist-wanderer/avatar.webp', 512);

      // Switch to Skins tab and click Equip Default (unequip_skin).
      await page.getByRole('tab', { name: 'Skins', exact: true }).click();
      await expect(outfitsPanel.locator('[data-owned-skin="mist-wanderer"] .skin-primary-action')).toHaveText('Equipped');
      const equipDefaultBtn = outfitsPanel.locator('[data-owned-skin="default"] .skin-primary-action');
      await equipDefaultBtn.scrollIntoViewIfNeeded();
      await expect(equipDefaultBtn).toHaveText('Equip Default');
      await expect(equipDefaultBtn).toBeEnabled();
      await equipDefaultBtn.click();

      await expect(equipDefaultBtn).toHaveText('Equipped');
      await expect(equipDefaultBtn).toBeDisabled();
      await assertImageLoaded(profileAvatar.locator('img'), '/assets/skins/default/avatar.webp', 512);
      await expect(profileAvatar).toHaveAttribute('data-avatar-frame', 'crimson-moon');
      await assertNoHorizontalOverflow(page, `Profile post-Equip Default ${viewport.name}`);

      // Verify Lobby updates back to Default Outfit.
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await expect(lobbyAvatar).toHaveAttribute('data-avatar-frame', 'crimson-moon');
      await assertImageLoaded(lobbyAvatar.locator('img'), '/assets/skins/default/avatar.webp', 512);
      if (viewport.desktopStage) {
        await identityTrigger.click();
        const defaultPreview = page.getByRole('dialog', { name: 'Default Outfit · Lone Wanderer' });
        await expect(defaultPreview).toBeVisible();
        await assertImageLoaded(defaultPreview.locator('.night-outfit-preview-portrait img'), '/assets/skins/default/portrait.webp');
        await page.keyboard.press('Escape');
        await expect(defaultPreview).toHaveCount(0);
      }

      // Verify Match Seat 1 updates back to Default Outfit (9-player match).
      await startMatchWithPlayerCount(page, 9);
      await verifyMatchSeats(page, 9, 'default', 'crimson-moon');
      await assertAllVisibleImagesLoaded(page);
      await assertNoHorizontalOverflow(page, `9-player match post-Equip Default ${viewport.name}`);

      assertCleanRuntime(monitor);
    });
  });
}
