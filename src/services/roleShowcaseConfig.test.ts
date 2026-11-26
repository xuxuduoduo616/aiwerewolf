import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MODE_9_PLAYER, MODE_12_PLAYER } from '../constants';
import { Role } from '../types';
import {
  getNightSkillVfxSpec,
  getRoleShowcaseSpec,
  getShowcaseText,
  NIGHT_SKILL_VFX_CONFIG,
  ROLE_SHOWCASE_SPECS,
  SHOWCASE_ROLES,
  type HumanSkillCueKind,
} from './roleShowcaseConfig';

vi.mock('./speechLibrary', () => ({
  preloadSpeechPools: vi.fn(async () => undefined),
}));

import { preloadMatchAssets } from './matchPreload';

describe('roleShowcaseConfig', () => {
  it('enumerates every assignable role from 9-player and 12-player boards', () => {
    const boardRoles = new Set<Role>([
      ...MODE_9_PLAYER.roles,
      ...MODE_12_PLAYER.roles,
    ]);
    expect(new Set(SHOWCASE_ROLES)).toEqual(boardRoles);
    expect(Object.keys(ROLE_SHOWCASE_SPECS).sort()).toEqual([...boardRoles].sort());
  });

  it('provides exact EN and ZH lines and relative ./assets paths for all 6 roles', () => {
    const expectedLines: Record<Role, { en: string; zh: string }> = {
      [Role.WITCH]: {
        en: 'One drop mends the soul; another seals the night.',
        zh: '一滴回魂续命，一滴封喉断夜。',
      },
      [Role.SEER]: {
        en: 'Beneath the ink-stained moon, no mask hides its true shadow.',
        zh: '水墨孤月之下，真假终见分晓。',
      },
      [Role.WEREWOLF]: {
        en: 'Walk among the lanterns by day; let the fangs speak at midnight.',
        zh: '白昼隐入灯火，子夜利爪封喉。',
      },
      [Role.HUNTER]: {
        en: 'Even if I fall tonight, my final bolt never misses.',
        zh: '纵使今夜倒下，最后一箭也绝不落空。',
      },
      [Role.IDIOT]: {
        en: 'Laugh at the fool if you wish—only the waking survive the crowd.',
        zh: '世人笑我痴狂，唯有清醒者死里逃生。',
      },
      [Role.VILLAGER]: {
        en: 'No mystic art in hand, only clear eyes to pierce the fog.',
        zh: '手中虽无奇术，明眼亦能破雾寻狼。',
      },
    };

    for (const role of SHOWCASE_ROLES) {
      const spec = getRoleShowcaseSpec(role);
      expect(getShowcaseText(spec.subtitle, 'en')).toBe(expectedLines[role].en);
      expect(getShowcaseText(spec.subtitle, 'zh')).toBe(expectedLines[role].zh);
      expect(spec.portraitSrc).toBe(`./assets/roles/${spec.slug}/portrait.webp`);
      expect(spec.entranceVideoSrc).toBe(`./assets/roles/${spec.slug}/entrance.mp4`);
      expect(spec.voiceSrc.en).toBe(`./assets/roles/${spec.slug}/voice-en.mp3`);
      expect(spec.voiceSrc.zh).toBe(`./assets/roles/${spec.slug}/voice-zh.mp3`);
      expect(spec.presetDurationMs).toBeGreaterThan(0);
    }
  });

  it('defines night skill VFX config for all 5 human skill cue kinds', () => {
    const kinds: HumanSkillCueKind[] = [
      'SEER_CHECK',
      'WITCH_SAVE',
      'WITCH_POISON',
      'WITCH_HOLD',
      'WOLF_KILL_CONFIRM',
    ];
    expect(Object.keys(NIGHT_SKILL_VFX_CONFIG).sort()).toEqual([...kinds].sort());

    for (const kind of kinds) {
      const spec = getNightSkillVfxSpec(kind);
      expect(spec.durationMs).toBeGreaterThanOrEqual(1000);
      expect(spec.durationMs).toBeLessThanOrEqual(1500);
      if (kind === 'WITCH_HOLD') {
        expect(spec.hasMotionAsset).toBe(false);
        expect(spec.videoSrc).toBeNull();
      } else {
        expect(spec.hasMotionAsset).toBe(true);
        expect(spec.videoSrc).toBe(`./assets/skills/${spec.slug}.mp4`);
        expect(spec.posterSrc).toBe(`./assets/skills/${spec.slug}.webp`);
      }
    }
  });

  it('keeps Han characters strictly inside src/data/roleShowcaseLines.json and out of TS/TSX/CSS', () => {
    const hanPattern = /\p{Script=Han}/u;
    const filesToCheck = [
      '../services/roleShowcaseConfig.ts',
      '../services/roleShowcaseController.ts',
      '../services/matchPreload.ts',
      '../components/RoleBadgeIcon.tsx',
      '../components/RoleIdentityBadge.tsx',
      '../components/RoleShowcaseModal.tsx',
      '../components/NightSkillEffectOverlay.tsx',
      '../styles/transitions.css',
      '../styles/game-responsive.css',
      '../styles/economy.css',
    ];

    for (const relPath of filesToCheck) {
      const content = readFileSync(new URL(relPath, import.meta.url), 'utf8');
      expect(hanPattern.test(content), `${relPath} must not contain Han characters`).toBe(false);
    }
  });
});

describe('preloadMatchAssets', () => {
  it('preloads only humanRole portraitSrc alongside avatars, never all 6 role videos', async () => {
    const loadedUrls: string[] = [];
    const OriginalImage = globalThis.Image;

    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = 'auto';
      set src(value: string) {
        loadedUrls.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    try {
      await preloadMatchAssets(
        [
          { role: Role.WITCH, avatarUrl: 'https://example.com/a1.svg' },
          { role: Role.SEER, avatarUrl: 'https://example.com/a2.svg' },
        ],
        Role.WITCH,
      );
    } finally {
      globalThis.Image = OriginalImage;
    }

    expect(loadedUrls).toContain('./assets/roles/witch/portrait.webp');
    expect(loadedUrls).not.toContain('./assets/roles/seer/portrait.webp');
    expect(loadedUrls.some(url => url.endsWith('.mp4'))).toBe(false);
  });
});
