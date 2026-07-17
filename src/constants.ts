import { GameConfig, Role } from './types';
import type { DisplayLanguage } from './i18n';

export const MODE_9_PLAYER: GameConfig = {
  id: '9-standard',
  playerCount: 9,
  name: '9-Player Standard',
  displayName: '9人标准场',
  description: '3民3狼 + 预言家、女巫、猎人。节奏快，适合第一阶段调试AI发言和基础规则。',
  roleSummary: '3民 / 3狼 / 预言家 / 女巫 / 猎人',
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
  displayName: '12人预女猎白',
  description: '4民4狼 + 预言家、女巫、猎人、白痴。更接近完整标准局。',
  roleSummary: '4民 / 4狼 / 预言家 / 女巫 / 猎人 / 白痴',
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
  [Role.WEREWOLF]: '夜晚共同刀人，白天隐藏身份、扰乱好人视角。',
  [Role.VILLAGER]: '没有夜间技能，依靠发言、票型和逻辑找狼。',
  [Role.SEER]: '每晚查验一名玩家，得知其是否为狼人。',
  [Role.WITCH]: '拥有一瓶解药和一瓶毒药，每瓶全局只能使用一次。',
  [Role.HUNTER]: '正常死亡时可以开枪带走一名玩家，被毒死不能开枪。',
  [Role.IDIOT]: '白天被投出时翻牌免死，但之后失去投票权。',
};

export const ROLE_LABELS: Record<Role, string> = {
  [Role.WEREWOLF]: '狼人',
  [Role.VILLAGER]: '平民',
  [Role.SEER]: '预言家',
  [Role.WITCH]: '女巫',
  [Role.HUNTER]: '猎人',
  [Role.IDIOT]: '白痴',
};

export const PHASE_LABELS: Record<string, string> = {
  LOGIN: '登录',
  LOBBY: '大厅',
  NIGHT_START: '入夜',
  NIGHT_WEREWOLVES: '狼人夜聊/刀人',
  NIGHT_SEER: '预言家查验',
  NIGHT_WITCH: '女巫行动',
  DAY_ANNOUNCE: '公布死讯',
  DAY_HUNTER_CHECK: '猎人状态',
  DAY_HUNTER_SHOT: '猎人开枪',
  DAY_DISCUSSION: '白天发言',
  DAY_VOTING: '放逐投票',
  GAME_OVER: '游戏结束',
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
