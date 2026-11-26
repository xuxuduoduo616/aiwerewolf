import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { enterGuestLobby, leaveGameToLobby, watchProviderRequests } from './helpers/game';
import { GUEST_IDENTITY_STORAGE_KEY } from '../src/identity/publicIdentity';

interface LocalizedText {
  en: string;
  zh: string;
}

interface RoleLineEntry {
  roleTitle: LocalizedText;
  badgeLabel: LocalizedText;
  subtitle: LocalizedText;
}

type RoleName = 'Werewolf' | 'Villager' | 'Seer' | 'Witch' | 'Hunter' | 'Idiot';

const ROLE_LINES = JSON.parse(
  readFileSync(new URL('../src/data/roleShowcaseLines.json', import.meta.url), 'utf8'),
) as Record<RoleName, RoleLineEntry>;

interface RoleDealCase {
  role: RoleName;
  slug: string;
  boardLabel: '9-Player Standard' | '12-Player Standard';
  randomValue: number;
}

// Deterministic Math.random constants matching shuffleRoles() in src/services/roleDeal.ts
// so human seat 1 receives each target role on deal.
const ROLE_MATRIX: readonly RoleDealCase[] = [
  { role: 'Witch', slug: 'witch', boardLabel: '9-Player Standard', randomValue: 0.2 },
  { role: 'Seer', slug: 'seer', boardLabel: '9-Player Standard', randomValue: 0.25 },
  { role: 'Werewolf', slug: 'werewolf', boardLabel: '9-Player Standard', randomValue: 0.9999 },
  { role: 'Hunter', slug: 'hunter', boardLabel: '9-Player Standard', randomValue: 0.1667 },
  { role: 'Villager', slug: 'villager', boardLabel: '9-Player Standard', randomValue: 0.49 },
  { role: 'Idiot', slug: 'idiot', boardLabel: '12-Player Standard', randomValue: 0.125 },
];

const SCREENSHOT_DIR = 'output/playwright/role-showcase';
const PHASE_LABEL = '.game-room-phase-summary p';
const AUDIO_PREFS_KEY = 'werewolf_audio_prefs';

interface AudioInstanceTrace {
  id: number;
  src: string;
  playStartedAt: number;
  endedAt: number | null;
  pausedAt: number | null;
  pauseCalls: number;
  blocked: boolean;
  errored: boolean;
}

interface AudioTrackerSnapshot {
  playAttempts: number;
  maxConcurrentPlaying: number;
  instances: AudioInstanceTrace[];
}

declare global {
  interface Window {
    __testRandomValue?: number;
    __audioPlayMode?: 'normal' | 'block-once' | 'block-all';
    __audioTracker?: AudioTrackerSnapshot;
    __skillOverlaySeenCount?: number;
  }
}

async function installTestHarness(page: Page, initialRandom = 0.2): Promise<void> {
  await page.addInitScript((defaultRandom: number) => {
    window.__testRandomValue = defaultRandom;
    Math.random = () => window.__testRandomValue ?? defaultRandom;

    window.__audioPlayMode = 'normal';
    const tracker: AudioTrackerSnapshot = {
      playAttempts: 0,
      maxConcurrentPlaying: 0,
      instances: [],
    };
    window.__audioTracker = tracker;

    let nextId = 1;
    const byElement = new WeakMap<HTMLAudioElement, AudioInstanceTrace>();
    const activeElements = new Set<HTMLAudioElement>();

    const origPlay = HTMLMediaElement.prototype.play;
    const origPause = HTMLMediaElement.prototype.pause;

    HTMLMediaElement.prototype.play = function patchedPlay(this: HTMLMediaElement, ...args: []) {
      if (!(this instanceof HTMLAudioElement)) {
        return origPlay.apply(this, args);
      }

      const activeTracker = window.__audioTracker ?? tracker;
      activeTracker.playAttempts += 1;
      let entry = byElement.get(this);
      if (!entry) {
        entry = {
          id: nextId++,
          src: this.currentSrc || this.getAttribute('src') || this.src || '',
          playStartedAt: Date.now(),
          endedAt: null,
          pausedAt: null,
          pauseCalls: 0,
          blocked: false,
          errored: false,
        };
        byElement.set(this, entry);
        activeTracker.instances.push(entry);

        this.addEventListener('ended', () => {
          entry!.endedAt = Date.now();
          activeElements.delete(this);
        });
        this.addEventListener('error', () => {
          entry!.errored = true;
          activeElements.delete(this);
        });
      } else {
        entry.playStartedAt = Date.now();
        entry.pausedAt = null;
        entry.blocked = false;
        if (!entry.src) {
          entry.src = this.currentSrc || this.getAttribute('src') || this.src || '';
        }
        if (!activeTracker.instances.includes(entry)) {
          activeTracker.instances.push(entry);
        }
      }

      const mode = window.__audioPlayMode ?? 'normal';
      if (mode === 'block-once' || mode === 'block-all') {
        if (mode === 'block-once') {
          window.__audioPlayMode = 'normal';
        }
        entry.blocked = true;
        return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      }

      activeElements.add(this);
      if (activeElements.size > activeTracker.maxConcurrentPlaying) {
        activeTracker.maxConcurrentPlaying = activeElements.size;
      }

      return origPlay.apply(this, args);
    };

    HTMLMediaElement.prototype.pause = function patchedPause(this: HTMLMediaElement, ...args: []) {
      if (this instanceof HTMLAudioElement) {
        activeElements.delete(this);
        const entry = byElement.get(this);
        if (entry) {
          entry.pausedAt = Date.now();
          entry.pauseCalls += 1;
        }
      }
      return origPause.apply(this, args);
    };
  }, initialRandom);

  // Keep local assets fast & reliable while blocking external DiceBear fetches.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      await route.abort();
    } else {
      await route.continue();
    }
  });
}

async function markControlsGuideSeen(page: Page): Promise<void> {
  await page.evaluate(guestKey => {
    const raw = localStorage.getItem(guestKey);
    if (!raw) return;
    const { id } = JSON.parse(raw) as { id?: string };
    if (id) {
      localStorage.setItem(`aiwerewolf:game-controls-guide:v2:${id}`, 'seen');
    }
  }, GUEST_IDENTITY_STORAGE_KEY);
}

async function setAudioPrefs(page: Page, prefs: { volume: number; rate: number; enabled: boolean }): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    [AUDIO_PREFS_KEY, prefs] as const,
  );
}

async function setTestRandom(page: Page, value: number): Promise<void> {
  await page.evaluate(v => {
    window.__testRandomValue = v;
  }, value);
}

async function dismissOnboardingIfVisible(page: Page): Promise<void> {
  const onboarding = page.locator('.onboarding-panel');
  await onboarding.waitFor({ state: 'visible', timeout: 800 }).catch(() => undefined);
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(onboarding).toHaveCount(0);
  }
}

async function startMatchFromLobby(
  page: Page,
  dealCase: Pick<RoleDealCase, 'boardLabel' | 'randomValue'>,
): Promise<void> {
  await setTestRandom(page, dealCase.randomValue);
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await dismissOnboardingIfVisible(page);
  await page.getByRole('button', { name: /Single-Player/ }).click();
  await dismissOnboardingIfVisible(page);

  await expect(page.getByRole('heading', { name: /Choose Board, Difficulty/ })).toBeVisible();
  const boardRadio = page.getByRole('radio', { name: new RegExp(dealCase.boardLabel) });
  await boardRadio.check();
  await expect(boardRadio).toBeChecked();

  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.locator('.game-room')).toBeVisible();
}

async function switchLanguageInSettings(page: Page, target: 'en' | 'zh'): Promise<void> {
  await page.getByRole('button', { name: 'Open utility menu' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  if (target === 'zh') {
    const enBtn = page.getByRole('button', { name: 'AI speech language: English' });
    await expect(enBtn).toBeVisible();
    await enBtn.click();
    await expect(page.getByRole('button', { name: 'AI speech language: Chinese' })).toBeVisible();
  } else {
    const zhBtn = page.getByRole('button', { name: 'AI speech language: Chinese' });
    await expect(zhBtn).toBeVisible();
    await zhBtn.click();
    await expect(page.getByRole('button', { name: 'AI speech language: English' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Return to utility menu' }).click();
  await page.getByRole('button', { name: 'Close utility menu' }).click();
  await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
}

async function getAudioTracker(page: Page): Promise<AudioTrackerSnapshot> {
  return page.evaluate(() => window.__audioTracker ?? { playAttempts: 0, maxConcurrentPlaying: 0, instances: [] });
}

async function resetAudioTracker(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__audioTracker) {
      window.__audioTracker.playAttempts = 0;
      window.__audioTracker.maxConcurrentPlaying = 0;
      window.__audioTracker.instances.length = 0;
    } else {
      window.__audioTracker = { playAttempts: 0, maxConcurrentPlaying: 0, instances: [] };
    }
  });
}

async function waitForShowcaseSettled(dialog: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        dialog.evaluate(el => {
          const dialogOpacity = Number.parseFloat(getComputedStyle(el).opacity);
          const card = el.querySelector('.role-showcase-card');
          const cardOpacity = card ? Number.parseFloat(getComputedStyle(card).opacity) : 0;
          const video = el.querySelector<HTMLVideoElement>('video.role-showcase-media');
          const img = el.querySelector<HTMLImageElement>('img.role-showcase-media');
          const mediaReady = video
            ? video.readyState >= 2
            : img
              ? img.complete && img.naturalWidth > 0
              : true;
          return dialogOpacity >= 0.99 && cardOpacity >= 0.99 && mediaReady;
        }),
      { timeout: 5_000, intervals: [50, 100] },
    )
    .toBe(true);
}

async function assertShowcaseGeometry(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollWidth = document.documentElement.scrollWidth;
    const card = document.querySelector('.role-showcase-card')?.getBoundingClientRect();
    const scrim = document.querySelector('.role-showcase-scrim')?.getBoundingClientRect();
    const title = document.querySelector('.role-showcase-title')?.getBoundingClientRect();
    const subtitle = document.querySelector('.role-showcase-subtitle')?.getBoundingClientRect();
    const skip = document.querySelector('.role-showcase-skip')?.getBoundingClientRect();
    return { vw, vh, scrollWidth, card, scrim, title, subtitle, skip };
  });

  expect(result.scrollWidth, 'no horizontal overflow during showcase').toBeLessThanOrEqual(result.vw);
  expect(result.card).toBeTruthy();
  expect(result.scrim).toBeTruthy();
  expect(result.title).toBeTruthy();
  expect(result.subtitle).toBeTruthy();
  expect(result.skip).toBeTruthy();
  expect(result.card!.left).toBeGreaterThanOrEqual(0);
  expect(result.card!.right).toBeLessThanOrEqual(result.vw + 1);
  expect(result.card!.top).toBeGreaterThanOrEqual(0);
  expect(result.card!.bottom).toBeLessThanOrEqual(result.vh + 1);
  expect(result.subtitle!.left).toBeGreaterThanOrEqual(result.card!.left);
  expect(result.subtitle!.right).toBeLessThanOrEqual(result.card!.right + 1);
  expect(result.skip!.height).toBeGreaterThanOrEqual(44);
}

async function assertBadgeGeometryAndNoOverlap(
  page: Page,
  options: { checkPhasePanel?: boolean } = {},
): Promise<void> {
  const { checkPhasePanel = false } = options;
  const badge = page.locator('button.role-identity-badge');
  await expect(badge).toBeVisible();
  const box = (await badge.boundingBox())!;
  expect(box.width, 'badge width >= 44px').toBeGreaterThanOrEqual(44);
  expect(box.height, 'badge height >= 44px').toBeGreaterThanOrEqual(44);

  const check = await page.evaluate(includePhasePanel => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollWidth = document.documentElement.scrollWidth;
    const badgeEl = document.querySelector('button.role-identity-badge');
    const b = badgeEl?.getBoundingClientRect();
    if (!b) {
      return {
        vw,
        vh,
        scrollWidth,
        badge: null,
        hitTargetIsBadge: false,
        overlaps: ['missing badge'],
        mobileDockClear: false,
      };
    }

    const selectors = [
      '.game-room-header button',
      '.game-player-seat button',
      '.phase-panel .action-button',
      '.phase-panel .game-pause-button',
      '.phase-panel .skip-speech-button',
      '[data-speech-input-row]',
      '.economy-global-feedback--game',
      ...(includePhasePanel && vw >= 1024 ? ['.phase-panel'] : []),
    ];
    const overlaps: string[] = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const intersects = !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom);
        if (intersects) {
          overlaps.push(`${sel}(${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`);
        }
      }
    }

    let mobileDockClear = true;
    if (vw < 1024) {
      const room = document.querySelector('.game-room')?.getBoundingClientRect();
      const dock = document.querySelector('.game-room-role-dock')?.getBoundingClientRect();
      mobileDockClear = Boolean(
        room && dock && dock.top >= room.bottom - 1 && b.top >= room.bottom - 1,
      );
      const feedback = document.querySelector('.economy-global-feedback--game')?.getBoundingClientRect();
      if (feedback && dock && feedback.bottom > dock.top + 1) {
        overlaps.push(`.economy-global-feedback--game vs .game-room-role-dock(${Math.round(feedback.bottom)} > ${Math.round(dock.top)})`);
      }
    }

    return {
      vw,
      vh,
      scrollWidth,
      badge: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      hitTargetIsBadge: Boolean(
        document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('button.role-identity-badge'),
      ),
      overlaps,
      mobileDockClear,
    };
  }, checkPhasePanel);

  expect(check.scrollWidth, 'no horizontal overflow in game room').toBeLessThanOrEqual(check.vw);
  expect(check.badge).toBeTruthy();
  expect(check.badge!.left).toBeGreaterThanOrEqual(0);
  expect(check.badge!.top).toBeGreaterThanOrEqual(0);
  expect(check.badge!.right).toBeLessThanOrEqual(check.vw);
  expect(check.badge!.bottom).toBeLessThanOrEqual(check.vh);
  expect(check.hitTargetIsBadge, 'badge center must not be covered by another element').toBe(true);
  expect(check.mobileDockClear, 'on mobile (<1024px), .game-room must sit strictly above .game-room-role-dock and badge').toBe(true);
  expect(check.overlaps, 'badge must not overlap game controls, phase panel, or economy toast').toEqual([]);
}

interface SkillOverlaySnapshot {
  pointerEvents: string;
  label: string;
  target: string | null;
  videoSrc: string | null;
  imgSrc: string | null;
  hasStaticEmblem: boolean;
}

async function captureSkillOverlay(page: Page, kind: string): Promise<SkillOverlaySnapshot> {
  const handle = await page.waitForFunction(
    targetKind => {
      const el = document.querySelector(`.night-skill-overlay[data-skill-kind="${targetKind}"]`);
      if (!el) return null;
      const style = getComputedStyle(el);
      const label = el.querySelector('.night-skill-label')?.textContent?.trim() ?? '';
      const target = el.querySelector('.night-skill-target')?.textContent?.trim() ?? null;
      const video = el.querySelector('video.night-skill-media');
      const img = el.querySelector('img.night-skill-media');
      const emblem = el.querySelector('.night-skill-static-emblem');
      return {
        pointerEvents: style.pointerEvents,
        label,
        target,
        videoSrc: video?.getAttribute('src') ?? null,
        imgSrc: img?.getAttribute('src') ?? null,
        hasStaticEmblem: Boolean(emblem),
      };
    },
    kind,
    { timeout: 15_000, polling: 50 },
  );
  return handle.jsonValue();
}

async function waitForPhase(page: Page, expectedPhase: string, timeoutMs = 25_000): Promise<void> {
  await expect
    .poll(async () => (await page.locator(PHASE_LABEL).innerText().catch(() => '')).trim(), {
      timeout: timeoutMs,
      intervals: [100, 200, 350],
    })
    .toBe(expectedPhase);
}

test.describe('role showcase and night skill VFX', () => {
  test('Witch pilot & all 6 roles render EN/ZH subtitles, media assets, audio tracks, and badge with zero provider calls', async ({ page }) => {
    test.setTimeout(150_000);
    const providerRequests = watchProviderRequests(page);
    const roleAssetStatuses = new Map<string, number>();
    page.on('response', response => {
      try {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/assets/roles/')) {
          roleAssetStatuses.set(url.pathname, response.status());
        }
      } catch {
        // Ignore non-HTTP URLs.
      }
    });

    await installTestHarness(page, 0.2);
    await enterGuestLobby(page);
    await markControlsGuideSeen(page);

    for (const lang of ['en', 'zh'] as const) {
      if (lang === 'zh') {
        await switchLanguageInSettings(page, 'zh');
      }

      for (const spec of ROLE_MATRIX) {
        const lines = ROLE_LINES[spec.role];
        await resetAudioTracker(page);
        await startMatchFromLobby(page, spec);

        const dialog = page.locator(`dialog.role-showcase-dialog[data-showcase-mode="initial"][data-role-slug="${spec.slug}"]`);
        await expect(dialog).toBeVisible();
        await expect(page.locator('button.role-identity-badge')).toHaveCount(0);

        const video = dialog.locator('video.role-showcase-media');
        await expect(video).toBeVisible();
        await expect(video).toHaveAttribute('src', new RegExp(`/assets/roles/${spec.slug}/entrance\\.mp4$|\\./assets/roles/${spec.slug}/entrance\\.mp4$`));
        await expect(video).toHaveAttribute('poster', new RegExp(`/assets/roles/${spec.slug}/portrait\\.webp$|\\./assets/roles/${spec.slug}/portrait\\.webp$`));

        await expect(dialog.locator('.role-showcase-title')).toHaveText(lines.roleTitle[lang]);
        await expect(dialog.locator('.role-showcase-subtitle')).toHaveText(lines.subtitle[lang]);
        await assertShowcaseGeometry(page);

        // Verify expected localized voice track URL was invoked by the session.
        await expect
          .poll(async () => {
            const snap = await getAudioTracker(page);
            return snap.instances.some(inst => inst.src.includes(`/assets/roles/${spec.slug}/voice-${lang}.mp3`));
          })
          .toBe(true);

        if (lang === 'en') {
          await waitForShowcaseSettled(dialog);
          await page.screenshot({ path: `${SCREENSHOT_DIR}/role-${spec.slug}-en.png` });
        }

        // Verify portrait & entrance video returned healthy HTTP statuses (200/206/304).
        await expect
          .poll(() => roleAssetStatuses.get(`/assets/roles/${spec.slug}/portrait.webp`) ?? 0)
          .toBeGreaterThanOrEqual(200);
        await expect
          .poll(() => roleAssetStatuses.get(`/assets/roles/${spec.slug}/entrance.mp4`) ?? 0)
          .toBeGreaterThanOrEqual(200);
        await expect
          .poll(() => roleAssetStatuses.get(`/assets/roles/${spec.slug}/voice-${lang}.mp3`) ?? 0)
          .toBeGreaterThanOrEqual(200);

        // Close initial showcase via Skip button -> badge appears, game reveals role.
        await dialog.getByRole('button', { name: 'Skip match intro' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByText(`Your role: ${spec.role}`, { exact: true })).toBeVisible();

        const badge = page.locator(`button.role-identity-badge[data-role-slug="${spec.slug}"]`);
        await expect(badge).toBeVisible();
        await expect(badge.locator('.role-identity-badge__label')).toHaveText(lines.badgeLabel[lang]);
        await assertBadgeGeometryAndNoOverlap(page);

        await leaveGameToLobby(page);
      }
    }

    expect(providerRequests, 'must make zero calls to external AI/TTS Netlify Functions').toEqual([]);
  });

  test('initial deal manual close (Skip/Escape) and automatic ~2s post-audio close lifecycle on Witch', async ({ page }) => {
    test.setTimeout(90_000);
    const providerRequests = watchProviderRequests(page);

    await installTestHarness(page, 0.2);
    await enterGuestLobby(page);
    await markControlsGuideSeen(page);

    // 1) Manual close via Escape stops audio/timers, restores focus, and starts Night 1.
    await startMatchFromLobby(page, ROLE_MATRIX[0]);
    const dialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="initial"][data-role-slug="witch"]');
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => (await getAudioTracker(page)).instances.length)
      .toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.game-room-header')).toBeFocused();
    await expect(page.locator('.game-round-indicator')).toHaveText('1');

    const trackerAfterEscape = await getAudioTracker(page);
    expect(trackerAfterEscape.instances.length).toBeGreaterThan(0);
    expect(trackerAfterEscape.instances.every(inst => inst.pausedAt !== null)).toBe(true);

    // Night 1 advances normally after manual release.
    await waitForPhase(page, 'Witch Acts', 25_000);
    await leaveGameToLobby(page);

    // 2) Automatic close: when Witch audio ends (~3s), modal holds ~2s and then auto-closes once.
    await resetAudioTracker(page);
    await startMatchFromLobby(page, ROLE_MATRIX[0]);
    await expect(dialog).toBeVisible();

    // Wait for the active Witch voice-en.mp3 instance to reach ended event naturally (~3.0s).
    await expect
      .poll(
        async () => {
          const snap = await getAudioTracker(page);
          return snap.instances.find(inst => inst.endedAt !== null)?.endedAt ?? null;
        },
        {
          timeout: 12_000,
          intervals: [100, 150],
        },
      )
      .not.toBeNull();

    // Modal must remain open during the 2s post-media hold.
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(900);
    await expect(dialog).toBeVisible();

    // After ~2s hold (+450ms fade), modal auto-closes once and releases Night 1.
    await expect(dialog).toHaveCount(0, { timeout: 6_000 });
    const endedAt = (await getAudioTracker(page)).instances.find(inst => inst.endedAt !== null)!.endedAt!;
    const closedAt = Date.now();
    expect(closedAt - endedAt).toBeGreaterThanOrEqual(1_800);

    await expect(page.locator('button.role-identity-badge[data-role-slug="witch"]')).toBeVisible();
    await waitForPhase(page, 'Witch Acts', 25_000);
    expect(providerRequests).toEqual([]);
  });

  test('autoplay-blocked recovery, muted/video-error fallback, and leave-and-restart cleanup', async ({ page }) => {
    test.setTimeout(90_000);
    const providerRequests = watchProviderRequests(page);

    await installTestHarness(page, 0.2);
    await enterGuestLobby(page);
    await markControlsGuideSeen(page);

    // 1) Autoplay-blocked recovery (block-all simulates browser autoplay denial until user gesture).
    await page.evaluate(() => {
      window.__audioPlayMode = 'block-all';
    });
    await startMatchFromLobby(page, ROLE_MATRIX[0]);

    const dialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="initial"][data-role-slug="witch"]');
    await expect(dialog).toBeVisible();
    const tapVoiceBtn = dialog.getByRole('button', { name: 'Tap to play voice' });
    await expect(tapVoiceBtn).toBeVisible();
    await expect(dialog.locator('video.role-showcase-media')).toBeVisible();
    await expect(dialog.locator('.role-showcase-subtitle')).toHaveText(ROLE_LINES.Witch.subtitle.en);

    await page.evaluate(() => {
      window.__audioPlayMode = 'normal';
    });
    await tapVoiceBtn.click();
    await expect(tapVoiceBtn).toHaveCount(0);

    // Wait for audio to finish naturally and auto-close after ~2s hold.
    await expect
      .poll(
        async () => {
          const snap = await getAudioTracker(page);
          return snap.instances.find(inst => inst.endedAt !== null)?.endedAt ?? null;
        },
        {
          timeout: 12_000,
          intervals: [100, 150],
        },
      )
      .not.toBeNull();
    await expect(dialog).toHaveCount(0, { timeout: 6_000 });
    await expect(page.locator('button.role-identity-badge[data-role-slug="witch"]')).toBeVisible();
    await leaveGameToLobby(page);

    // 2) Muted + video-error fallback: static portrait + subtitle render and auto-close cleanly (~6s).
    await setAudioPrefs(page, { volume: 0, rate: 1, enabled: false });
    await page.reload();
    await page.getByRole('button', { name: 'Play as Guest', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
    await page.route('**/assets/roles/*/entrance.mp4', route => route.abort());
    await resetAudioTracker(page);

    await startMatchFromLobby(page, ROLE_MATRIX[0]);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('video.role-showcase-media')).toHaveCount(0);
    const staticPortrait = dialog.locator('img.role-showcase-media');
    await expect(staticPortrait).toBeVisible();
    await expect(staticPortrait).toHaveAttribute('src', /portrait\.webp$/);
    await expect(dialog.locator('.role-showcase-subtitle')).toHaveText(ROLE_LINES.Witch.subtitle.en);
    await expect(dialog.getByRole('button', { name: 'Tap to play voice' })).toHaveCount(0);
    expect((await getAudioTracker(page)).playAttempts).toBe(0);

    // Preset duration (4000ms) + post-media hold (2000ms) + exit transition (450ms).
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('button.role-identity-badge[data-role-slug="witch"]')).toBeVisible();
    await leaveGameToLobby(page);

    // 3) Leave-and-restart cleanup: exit right after skipping/replaying Witch and immediately start Seer.
    await page.unroute('**/assets/roles/*/entrance.mp4');
    await setAudioPrefs(page, { volume: 1, rate: 1, enabled: true });
    await page.reload();
    await page.getByRole('button', { name: 'Play as Guest', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
    await resetAudioTracker(page);

    await startMatchFromLobby(page, ROLE_MATRIX[0]);
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await getAudioTracker(page)).instances.length).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Skip match intro' }).click();
    await expect(dialog).toHaveCount(0);

    // Reopen via badge replay, close, and immediately leave & start a new Seer match.
    const witchBadge = page.locator('button.role-identity-badge[data-role-slug="witch"]');
    await expect(witchBadge).toBeVisible();
    await witchBadge.click();
    const replayDialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="replay"][data-role-slug="witch"]');
    await expect(replayDialog).toBeVisible();
    await replayDialog.getByRole('button', { name: 'Close role showcase' }).click();
    await expect(replayDialog).toHaveCount(0);

    await leaveGameToLobby(page);
    await startMatchFromLobby(page, ROLE_MATRIX[1]); // Seer

    const seerDialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="initial"][data-role-slug="seer"]');
    await expect(seerDialog).toBeVisible();
    await expect(page.locator('dialog[data-role-slug="witch"]')).toHaveCount(0);

    const trackerMatch2 = await getAudioTracker(page);
    const witchAudios = trackerMatch2.instances.filter(i => i.src.includes('/assets/roles/witch/'));
    expect(witchAudios.length).toBeGreaterThan(0);
    for (const oldAudio of witchAudios) {
      expect(oldAudio.pausedAt, 'prior match audio must be paused/stopped').not.toBeNull();
    }

    await seerDialog.getByRole('button', { name: 'Skip match intro' }).click();
    await expect(seerDialog).toHaveCount(0);
    await expect(page.getByText('Your role: Seer', { exact: true })).toBeVisible();
    await waitForPhase(page, 'Seer Checks', 25_000);
    expect(providerRequests).toEqual([]);
  });

  test('bottom-left badge replay preserves active countdown timers and avoids audio overlap', async ({ page }) => {
    test.setTimeout(90_000);
    const providerRequests = watchProviderRequests(page);

    await installTestHarness(page, 0.9999);
    await enterGuestLobby(page);
    await markControlsGuideSeen(page);

    // Start as Werewolf so NIGHT_WEREWOLVES exposes live wolfCountdown timer pill.
    await startMatchFromLobby(page, ROLE_MATRIX[2]);
    const initialDialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="initial"][data-role-slug="werewolf"]');
    await expect(initialDialog).toBeVisible();
    await initialDialog.getByRole('button', { name: 'Skip match intro' }).click();
    await expect(initialDialog).toHaveCount(0);

    await waitForPhase(page, 'Werewolves Hunt', 20_000);
    const countdownPill = page.locator('.phase-panel .timer-pill').first();
    await expect(countdownPill).toBeVisible();

    const initialSeconds = Number.parseInt((await countdownPill.innerText()).replace(/\D/g, ''), 10);
    expect(initialSeconds).toBeGreaterThan(5);
    // Let countdown tick down at least once before opening replay.
    await expect
      .poll(async () => Number.parseInt((await countdownPill.innerText()).replace(/\D/g, ''), 10))
      .toBeLessThan(initialSeconds);
    const beforeSeconds = Number.parseInt((await countdownPill.innerText()).replace(/\D/g, ''), 10);

    const badge = page.locator('button.role-identity-badge[data-role-slug="werewolf"]');
    await badge.click();
    const replayDialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="replay"][data-role-slug="werewolf"]');
    await expect(replayDialog).toBeVisible();
    await expect(replayDialog.locator('.role-showcase-kicker')).toHaveText('Role Showcase');
    await expect(page.locator('dialog[data-showcase-mode="initial"]')).toHaveCount(0);

    await page.waitForTimeout(1_400);
    await replayDialog.getByRole('button', { name: 'Close role showcase' }).click();
    await expect(replayDialog).toHaveCount(0);
    await expect(badge).toBeFocused();

    // Countdown kept running while replay was open and did not reset.
    const afterFirstReplay = Number.parseInt((await countdownPill.innerText()).replace(/\D/g, ''), 10);
    expect(afterFirstReplay).toBeLessThan(beforeSeconds);
    await expect(page.locator(PHASE_LABEL)).toHaveText('Werewolves Hunt');

    // Open and close a second time via Escape -> no overlapping unpaused audio, phase intact.
    await resetAudioTracker(page);
    await badge.click();
    await expect(replayDialog).toBeVisible();
    await expect.poll(async () => (await getAudioTracker(page)).instances.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(replayDialog).toHaveCount(0);
    await expect(page.locator(PHASE_LABEL)).toHaveText('Werewolves Hunt');

    const tracker = await getAudioTracker(page);
    expect(tracker.maxConcurrentPlaying).toBeLessThanOrEqual(1);
    expect(tracker.instances.every(inst => inst.pausedAt !== null)).toBe(true);
    expect(providerRequests).toEqual([]);
  });

  test('night skill VFX positive cases: SEER_CHECK and WOLF_KILL_CONFIRM (no VFX on selection alone)', async ({ page }) => {
    test.setTimeout(90_000);
    const providerRequests = watchProviderRequests(page);

    await installTestHarness(page, 0.25);
    await enterGuestLobby(page);
    await markControlsGuideSeen(page);

    // 1) NIGHT_SEER: seat selection alone triggers NO VFX; CHECK triggers SEER_CHECK & reveals private badge.
    await startMatchFromLobby(page, ROLE_MATRIX[1]); // Seer
    await page.locator('dialog[data-showcase-mode="initial"] button.role-showcase-skip').click();
    await waitForPhase(page, 'Seer Checks', 25_000);

    // Select Player 2 (Villager under 0.25 deal) without clicking CHECK.
    await page.locator('.game-player-seat').nth(1).getByRole('button').click();
    await expect(page.locator('.night-skill-overlay')).toHaveCount(0);

    await page.getByRole('button', { name: 'CHECK', exact: true }).click();
    const seerSnap = await captureSkillOverlay(page, 'SEER_CHECK');
    expect(seerSnap.pointerEvents).toBe('none');
    expect(seerSnap.label).toBe('Seer Check');
    expect(seerSnap.target).toBe('Player 2');
    expect(seerSnap.videoSrc).toMatch(/seer-check\.mp4$/);
    await expect(page.locator('.game-player-seat').nth(1).getByText('Known Good', { exact: true })).toBeVisible();

    // Auto-dismisses cleanly and advances to Day Discussion.
    await expect(page.locator('.night-skill-overlay')).toHaveCount(0, { timeout: 5_000 });
    await waitForPhase(page, 'Day Discussion', 25_000);
    await leaveGameToLobby(page);

    // 2) NIGHT_WEREWOLVES: selection alone triggers NO VFX; KILL triggers WOLF_KILL_CONFIRM once.
    await startMatchFromLobby(page, ROLE_MATRIX[2]); // Werewolf
    await page.locator('dialog[data-showcase-mode="initial"] button.role-showcase-skip').click();
    await waitForPhase(page, 'Werewolves Hunt', 20_000);

    // Seat index 3 (Player 4) is Witch (non-wolf under 0.9999 deal).
    await page.locator('.game-player-seat').nth(3).getByRole('button').click();
    await expect(page.locator('.night-skill-overlay')).toHaveCount(0);

    await page.getByRole('button', { name: 'KILL', exact: true }).click();
    const wolfSnap = await captureSkillOverlay(page, 'WOLF_KILL_CONFIRM');
    expect(wolfSnap.pointerEvents).toBe('none');
    expect(wolfSnap.label).toBe('Target Locked');
    expect(wolfSnap.target).toBe('Player 4');
    expect(wolfSnap.videoSrc).toMatch(/wolf-kill\.mp4$/);
    await expect(page.getByText('Confirmed target: Player 4', { exact: true })).toBeVisible();

    await expect(page.locator('.night-skill-overlay')).toHaveCount(0, { timeout: 5_000 });
    await page.getByRole('button', { name: 'Skip night chat', exact: true }).click();
    await waitForPhase(page, 'Seer Checks', 20_000);
    expect(providerRequests).toEqual([]);
  });

  test('night skill VFX positive cases: WITCH_SAVE, WITCH_POISON, and WITCH_HOLD (PASS)', async ({ page }) => {
    test.setTimeout(120_000);
    const providerRequests = watchProviderRequests(page);

    await installTestHarness(page, 0.2);
    await enterGuestLobby(page);
    await markControlsGuideSeen(page);

    // 1) WITCH_SAVE
    await startMatchFromLobby(page, ROLE_MATRIX[0]); // Witch
    await page.locator('dialog[data-showcase-mode="initial"] button.role-showcase-skip').click();
    await waitForPhase(page, 'Witch Acts', 25_000);

    await page.getByRole('button', { name: 'SAVE', exact: true }).click();
    const saveSnap = await captureSkillOverlay(page, 'WITCH_SAVE');
    expect(saveSnap.pointerEvents).toBe('none');
    expect(saveSnap.label).toBe('Antidote Used');
    expect(saveSnap.videoSrc).toMatch(/witch-save\.mp4$/);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/witch-save-vfx.png` });

    await expect(page.locator('.night-skill-overlay')).toHaveCount(0, { timeout: 5_000 });
    await waitForPhase(page, 'Day Discussion', 25_000);
    await leaveGameToLobby(page);

    // 2) WITCH_POISON (verify selection alone triggers no VFX)
    await startMatchFromLobby(page, ROLE_MATRIX[0]); // Witch
    await page.locator('dialog[data-showcase-mode="initial"] button.role-showcase-skip').click();
    await waitForPhase(page, 'Witch Acts', 25_000);

    await page.locator('.game-player-seat').nth(1).getByRole('button').click();
    await expect(page.locator('.night-skill-overlay')).toHaveCount(0);

    await page.getByRole('button', { name: 'POISON', exact: true }).click();
    const poisonSnap = await captureSkillOverlay(page, 'WITCH_POISON');
    expect(poisonSnap.pointerEvents).toBe('none');
    expect(poisonSnap.label).toBe('Poison Used');
    expect(poisonSnap.target).toBe('Player 2');
    expect(poisonSnap.videoSrc).toMatch(/witch-poison\.mp4$/);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/witch-poison-vfx.png` });

    await expect(page.locator('.night-skill-overlay')).toHaveCount(0, { timeout: 5_000 });
    await waitForPhase(page, 'Day Discussion', 25_000);
    await leaveGameToLobby(page);

    // 3) WITCH_HOLD (PASS static fallback)
    await startMatchFromLobby(page, ROLE_MATRIX[0]); // Witch
    await page.locator('dialog[data-showcase-mode="initial"] button.role-showcase-skip').click();
    await waitForPhase(page, 'Witch Acts', 25_000);

    await page.getByRole('button', { name: 'PASS', exact: true }).click();
    const holdSnap = await captureSkillOverlay(page, 'WITCH_HOLD');
    expect(holdSnap.label).toBe('Potion Held');
    expect(holdSnap.hasStaticEmblem).toBe(true);
    expect(holdSnap.videoSrc).toBeNull();
    expect(holdSnap.imgSrc).toBeNull();

    await expect(page.locator('.night-skill-overlay')).toHaveCount(0, { timeout: 5_000 });
    await waitForPhase(page, 'Day Discussion', 25_000);
    expect(providerRequests).toEqual([]);
  });

  test('night skill VFX negative cases: AI hidden actions, skill media error fallback, and reduced-motion static fallback', async ({ page }) => {
    test.setTimeout(120_000);
    const providerRequests = watchProviderRequests(page);

    await installTestHarness(page, 0.49);
    await enterGuestLobby(page);
    await markControlsGuideSeen(page);

    // 1) AI players' hidden night actions (when human is Villager) NEVER trigger human skill VFX.
    await startMatchFromLobby(page, ROLE_MATRIX[4]); // Villager
    await page.locator('dialog[data-showcase-mode="initial"] button.role-showcase-skip').click();

    await page.evaluate(() => {
      window.__skillOverlaySeenCount = 0;
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement && node.matches('.night-skill-overlay')) {
              window.__skillOverlaySeenCount = (window.__skillOverlaySeenCount ?? 0) + 1;
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    await waitForPhase(page, 'Day Discussion', 35_000);
    const seenOverlays = await page.evaluate(() => window.__skillOverlaySeenCount ?? 0);
    expect(seenOverlays, 'AI night actions must never trigger human skill VFX').toBe(0);
    await leaveGameToLobby(page);

    // 2) Skill .mp4 abort degrades to static poster without blocking phase progression.
    await page.route('**/assets/skills/*.mp4', route => route.abort());
    await startMatchFromLobby(page, ROLE_MATRIX[0]); // Witch
    await page.locator('dialog[data-showcase-mode="initial"] button.role-showcase-skip').click();
    await waitForPhase(page, 'Witch Acts', 25_000);

    await page.getByRole('button', { name: 'SAVE', exact: true }).click();
    const fallbackSaveOverlay = page.locator('.night-skill-overlay[data-skill-kind="WITCH_SAVE"]');
    await expect(fallbackSaveOverlay).toBeVisible();
    await expect(fallbackSaveOverlay.locator('video')).toHaveCount(0);
    await expect(fallbackSaveOverlay.locator('img.night-skill-media')).toHaveAttribute('src', /witch-save\.webp$/);
    await waitForPhase(page, 'Day Discussion', 25_000);
    await leaveGameToLobby(page);

    // 3) prefers-reduced-motion: reduce uses static fallback for showcase & night skill VFX.
    await page.unroute('**/assets/skills/*.mp4');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startMatchFromLobby(page, ROLE_MATRIX[1]); // Seer

    const seerDialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="initial"][data-role-slug="seer"]');
    await expect(seerDialog).toBeVisible();
    await expect(seerDialog.locator('video')).toHaveCount(0);
    await expect(seerDialog.locator('img.role-showcase-media')).toHaveAttribute('src', /portrait\.webp$/);
    await seerDialog.getByRole('button', { name: 'Skip match intro' }).click();
    await expect(seerDialog).toHaveCount(0);

    await waitForPhase(page, 'Seer Checks', 25_000);
    // Seat index 2 (Player 3) is Werewolf under 0.25 deal.
    await page.locator('.game-player-seat').nth(2).getByRole('button').click();
    await page.getByRole('button', { name: 'CHECK', exact: true }).click();

    const reducedSnap = await captureSkillOverlay(page, 'SEER_CHECK');
    expect(reducedSnap.videoSrc).toBeNull();
    expect(reducedSnap.imgSrc).toMatch(/seer-check\.webp$/);
    await expect(page.locator('.game-player-seat').nth(2).getByText('Confirmed Wolf', { exact: true })).toBeVisible();
    await waitForPhase(page, 'Day Discussion', 25_000);

    expect(providerRequests).toEqual([]);
  });

  for (const viewport of [
    { width: 1440, height: 900, tag: 'desktop' },
    { width: 390, height: 844, tag: 'mobile' },
  ] as const) {
    test(`responsive Witch showcase and room badge geometry & screenshots at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const providerRequests = watchProviderRequests(page);

      await installTestHarness(page, 0.2);
      await enterGuestLobby(page);
      await markControlsGuideSeen(page);

      await startMatchFromLobby(page, ROLE_MATRIX[0]); // Witch
      const dialog = page.locator('dialog.role-showcase-dialog[data-showcase-mode="initial"][data-role-slug="witch"]');
      await expect(dialog).toBeVisible();
      await assertShowcaseGeometry(page);
      await waitForShowcaseSettled(dialog);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/witch-${viewport.tag}-showcase.png` });

      await dialog.getByRole('button', { name: 'Skip match intro' }).click();
      await expect(dialog).toHaveCount(0);

      await waitForPhase(page, 'Witch Acts', 25_000);
      await expect(page.locator('.economy-global-feedback--game')).toBeVisible();
      await assertBadgeGeometryAndNoOverlap(page, { checkPhasePanel: true });
      await page.screenshot({ path: `${SCREENSHOT_DIR}/witch-${viewport.tag}-room-badge.png` });

      expect(providerRequests).toEqual([]);
    });
  }
});
