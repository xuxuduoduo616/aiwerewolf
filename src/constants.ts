import { GameConfig, Role } from './types';
import type { DisplayLanguage } from './i18n';

export const MODE_9_PLAYER: GameConfig = {
  id: '9-standard',
  playerCount: 9,
  name: '9-Player Standard',
  displayName: '9-Player Standard',
  description: '3 Villagers, 3 Werewolves + Seer, Witch, Hunter. Fast-paced and ideal for first-stage AI speech and core-rule testing.',
  roleSummary: '3 Villagers / 3 Werewolves / Seer / Witch / Hunter',
  enabled: true,
  roles: [
    Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF,
    Role.SEER, Role.WITCH, Role.HUNTER,
    Role.VILLAGER, Role.VILLAGER, Role.VILLAGER,
  ],
};

export const MODE_12_PLAYER: GameConfig = {
  id: '12-standard',
  playerCount: 12,
  name: '12-Player Standard',
  displayName: '12-Player Seer-Witch-Hunter-Idiot',
  description: '4 Villagers, 4 Werewolves + Seer, Witch, Hunter, Idiot. Closer to a complete standard game.',
  roleSummary: '4 Villagers / 4 Werewolves / Seer / Witch / Hunter / Idiot',
  enabled: true,
  roles: [
    Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF,
    Role.SEER, Role.WITCH, Role.HUNTER, Role.IDIOT,
    Role.VILLAGER, Role.VILLAGER, Role.VILLAGER, Role.VILLAGER,
  ],
};

export const GAME_MODES = [MODE_9_PLAYER, MODE_12_PLAYER];

export const AI_NAMES = [
  'Luna', 'Marcus', 'Elena', 'Darius', 'Silas', 'Amara',
  'Finn', 'Isla', 'Jasper', 'Nova', 'Orion', 'Freya',
];

export const AVATAR_SEEDS = [
  'Felix', 'Aneka', 'Zoe', 'Midnight', 'Bear', 'Tiger',
  'Lilly', 'Bo', 'Jack', 'Molly', 'Simba', 'Coco',
];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [Role.WEREWOLF]: "Hunt together at night; hide your identity and disrupt the village's perspective by day.",
  [Role.VILLAGER]: 'No night ability; find werewolves through speeches, vote patterns, and logic.',
  [Role.SEER]: 'Check one player each night to learn whether they are a werewolf.',
  [Role.WITCH]: 'Has one antidote and one poison; each can be used only once per game.',
  [Role.HUNTER]: 'May shoot and eliminate one player when normally killed, but cannot shoot if poisoned.',
  [Role.IDIOT]: 'Reveals and survives when exiled during the day, but loses the right to vote afterward.',
};

export const ROLE_LABELS: Record<Role, string> = {
  [Role.WEREWOLF]: 'Werewolf',
  [Role.VILLAGER]: 'Villager',
  [Role.SEER]: 'Seer',
  [Role.WITCH]: 'Witch',
  [Role.HUNTER]: 'Hunter',
  [Role.IDIOT]: 'Idiot',
};

export const PHASE_LABELS: Record<string, string> = {
  LOGIN: 'Login',
  LOBBY: 'Lobby',
  NIGHT_START: 'Nightfall',
  NIGHT_WEREWOLVES: 'Werewolves Hunt',
  NIGHT_SEER: 'Seer Checks',
  NIGHT_WITCH: 'Witch Acts',
  DAY_ANNOUNCE: 'Dawn Report',
  DAY_HUNTER_CHECK: 'Hunter Status',
  DAY_HUNTER_SHOT: 'Hunter Shot',
  DAY_DISCUSSION: 'Day Discussion',
  DAY_VOTING: 'Exile Vote',
  GAME_OVER: 'Game Over',
};

export const PHASE_LABELS_EN: Record<string, string> = {
  LOGIN: 'Login',
  LOBBY: 'Lobby',
  NIGHT_START: 'Nightfall',
  NIGHT_WEREWOLVES: 'Werewolves Hunt',
  NIGHT_SEER: 'Seer Checks',
  NIGHT_WITCH: 'Witch Acts',
  DAY_ANNOUNCE: 'Dawn Report',
  DAY_HUNTER_CHECK: 'Hunter Status',
  DAY_HUNTER_SHOT: 'Hunter Shot',
  DAY_DISCUSSION: 'Day Discussion',
  DAY_VOTING: 'Exile Vote',
  GAME_OVER: 'Game Over',
};

export const getPhaseLabel = (phase: string, language: DisplayLanguage): string =>
  language === 'en' ? (PHASE_LABELS_EN[phase] || phase) : (PHASE_LABELS[phase] || phase);

export const WEREWOLF_SLANG = [
  '金水', '查杀', '悍跳', '倒钩', '冲锋', '铁逻辑',
  '表水', '盘逻辑', '带节奏', '抗推位', '警徽流', '银水',
];
