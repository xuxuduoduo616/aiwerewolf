import { Role } from '../types';
import type { DisplayLanguage } from '../i18n';
import roleShowcaseLines from '../data/roleShowcaseLines.json';

export interface LocalizedShowcaseText {
  en: string;
  zh: string;
}

export interface RoleShowcaseSpec {
  role: Role;
  slug: string;
  roleTitle: LocalizedShowcaseText;
  badgeLabel: LocalizedShowcaseText;
  subtitle: LocalizedShowcaseText;
  portraitSrc: string;
  entranceVideoSrc: string;
  voiceSrc: Record<DisplayLanguage, string>;
  presetDurationMs: number;
}

export type HumanSkillCueKind =
  | 'SEER_CHECK'
  | 'WITCH_SAVE'
  | 'WITCH_POISON'
  | 'WITCH_HOLD'
  | 'WOLF_KILL_CONFIRM';

export interface HumanSkillCueEvent {
  id: string;
  kind: HumanSkillCueKind;
  actorId: number;
  targetId: number | null;
  round: number;
}

export type NightSkillAccent = 'seer' | 'save' | 'poison' | 'hold' | 'wolf';

export interface NightSkillVfxSpec {
  kind: HumanSkillCueKind;
  slug: string;
  label: string;
  videoSrc: string | null;
  posterSrc: string | null;
  hasMotionAsset: boolean;
  durationMs: number;
  accent: NightSkillAccent;
}

const ROLE_SLUGS: Record<Role, string> = {
  [Role.WEREWOLF]: 'werewolf',
  [Role.VILLAGER]: 'villager',
  [Role.SEER]: 'seer',
  [Role.WITCH]: 'witch',
  [Role.HUNTER]: 'hunter',
  [Role.IDIOT]: 'idiot',
};

const ROLE_PRESET_DURATIONS_MS: Record<Role, number> = {
  [Role.WEREWOLF]: 4000,
  [Role.VILLAGER]: 4000,
  [Role.SEER]: 4000,
  [Role.WITCH]: 4000,
  [Role.HUNTER]: 4000,
  [Role.IDIOT]: 4000,
};

type RoleLinesRecord = Record<Role, {
  roleTitle: LocalizedShowcaseText;
  badgeLabel: LocalizedShowcaseText;
  subtitle: LocalizedShowcaseText;
}>;

const LINES = roleShowcaseLines as RoleLinesRecord;

const createRoleShowcaseSpec = (role: Role): RoleShowcaseSpec => {
  const slug = ROLE_SLUGS[role];
  const lines = LINES[role];
  return {
    role,
    slug,
    roleTitle: lines.roleTitle,
    badgeLabel: lines.badgeLabel,
    subtitle: lines.subtitle,
    portraitSrc: `./assets/roles/${slug}/portrait.webp`,
    entranceVideoSrc: `./assets/roles/${slug}/entrance.mp4`,
    voiceSrc: {
      en: `./assets/roles/${slug}/voice-en.mp3`,
      zh: `./assets/roles/${slug}/voice-zh.mp3`,
    },
    presetDurationMs: ROLE_PRESET_DURATIONS_MS[role],
  };
};

export const SHOWCASE_ROLES: readonly Role[] = [
  Role.WEREWOLF,
  Role.VILLAGER,
  Role.SEER,
  Role.WITCH,
  Role.HUNTER,
  Role.IDIOT,
];

export const ROLE_SHOWCASE_SPECS: Record<Role, RoleShowcaseSpec> = {
  [Role.WEREWOLF]: createRoleShowcaseSpec(Role.WEREWOLF),
  [Role.VILLAGER]: createRoleShowcaseSpec(Role.VILLAGER),
  [Role.SEER]: createRoleShowcaseSpec(Role.SEER),
  [Role.WITCH]: createRoleShowcaseSpec(Role.WITCH),
  [Role.HUNTER]: createRoleShowcaseSpec(Role.HUNTER),
  [Role.IDIOT]: createRoleShowcaseSpec(Role.IDIOT),
};

export const getRoleShowcaseSpec = (role: Role): RoleShowcaseSpec =>
  ROLE_SHOWCASE_SPECS[role] ?? ROLE_SHOWCASE_SPECS[Role.VILLAGER];

export const getShowcaseText = (
  text: LocalizedShowcaseText,
  language: DisplayLanguage,
): string => (language === 'zh' ? text.zh : text.en);

export const NIGHT_SKILL_VFX_CONFIG: Record<HumanSkillCueKind, NightSkillVfxSpec> = {
  SEER_CHECK: {
    kind: 'SEER_CHECK',
    slug: 'seer-check',
    label: 'Seer Check',
    videoSrc: './assets/skills/seer-check.mp4',
    posterSrc: './assets/skills/seer-check.webp',
    hasMotionAsset: true,
    durationMs: 1300,
    accent: 'seer',
  },
  WITCH_SAVE: {
    kind: 'WITCH_SAVE',
    slug: 'witch-save',
    label: 'Antidote Used',
    videoSrc: './assets/skills/witch-save.mp4',
    posterSrc: './assets/skills/witch-save.webp',
    hasMotionAsset: true,
    durationMs: 1400,
    accent: 'save',
  },
  WITCH_POISON: {
    kind: 'WITCH_POISON',
    slug: 'witch-poison',
    label: 'Poison Used',
    videoSrc: './assets/skills/witch-poison.mp4',
    posterSrc: './assets/skills/witch-poison.webp',
    hasMotionAsset: true,
    durationMs: 1400,
    accent: 'poison',
  },
  WITCH_HOLD: {
    kind: 'WITCH_HOLD',
    slug: 'witch-hold',
    label: 'Potion Held',
    videoSrc: null,
    posterSrc: null,
    hasMotionAsset: false,
    durationMs: 1100,
    accent: 'hold',
  },
  WOLF_KILL_CONFIRM: {
    kind: 'WOLF_KILL_CONFIRM',
    slug: 'wolf-kill',
    label: 'Target Locked',
    videoSrc: './assets/skills/wolf-kill.mp4',
    posterSrc: './assets/skills/wolf-kill.webp',
    hasMotionAsset: true,
    durationMs: 1300,
    accent: 'wolf',
  },
};

export const getNightSkillVfxSpec = (kind: HumanSkillCueKind): NightSkillVfxSpec =>
  NIGHT_SKILL_VFX_CONFIG[kind];
