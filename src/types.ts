export enum Role {
  WEREWOLF = 'Werewolf',
  VILLAGER = 'Villager',
  SEER = 'Seer',
  WITCH = 'Witch',
  HUNTER = 'Hunter',
  IDIOT = 'Idiot',
}

export type Camp = 'WEREWOLF' | 'VILLAGE';

export enum GamePhase {
  LOGIN = 'LOGIN',
  LOBBY = 'LOBBY',
  NIGHT_START = 'NIGHT_START',
  NIGHT_WEREWOLVES = 'NIGHT_WEREWOLVES',
  NIGHT_SEER = 'NIGHT_SEER',
  NIGHT_WITCH = 'NIGHT_WITCH',
  DAY_ANNOUNCE = 'DAY_ANNOUNCE',
  DAY_HUNTER_CHECK = 'DAY_HUNTER_CHECK',
  DAY_HUNTER_SHOT = 'DAY_HUNTER_SHOT',
  DAY_DISCUSSION = 'DAY_DISCUSSION',
  DAY_VOTING = 'DAY_VOTING',
  GAME_OVER = 'GAME_OVER',
}

export type Winner = 'VILLAGERS' | 'WEREWOLVES' | null;

export interface Player {
  id: number;
  name: string;
  role: Role;
  camp: Camp;
  isAlive: boolean;
  canVote: boolean;
  isRevealed: boolean;
  avatarUrl: string;
  aiPersonality: string;
  traits: string[];
  aiModelLabel: string;
  isHuman: boolean;
  isWolfHopper?: boolean;
  publicClaims: string[];
  privateKnowledge: string[];
  suspicionMap: Record<number, number>;
}

export interface GameLog {
  id: string;
  phase: GamePhase;
  speakerId?: number;
  message: string;
  translation?: string;
  isSystem: boolean;
  tone?: 'system' | 'speech' | 'action' | 'wolf' | 'vote' | 'warning';
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy:   '新手',
  normal: '进阶',
  hard:   '高手',
};

export interface DifficultyConfig {
  id: Difficulty;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  // Action selection: higher = AI plays better
  actionAccuracy: number;    // 0–1, probability of choosing optimal action
  // Speech quality: higher = more contextual / less repetitive
  speechQuality: number;     // 0–1
  // Wolf team coordination: how well wolves cooperate
  wolfCoordination: number;  // 0–1
  // Expose logical holes: higher = AI makes more mistakes
  mistakeRate: number;       // 0–1
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: '新手',
    labelEn: 'Beginner',
    description: 'AI 故意暴露逻辑漏洞，适合第一次玩狼人杀的玩家',
    descriptionEn: 'AI deliberately exposes logical flaws — ideal for first-time werewolf players.',
    actionAccuracy: 0.45,
    speechQuality: 0.3,
    wolfCoordination: 0.3,
    mistakeRate: 0.55,
  },
  normal: {
    id: 'normal',
    label: '进阶',
    labelEn: 'Intermediate',
    description: 'AI 使用标准策略，偶有逻辑失误，适合有一定基础的玩家',
    descriptionEn: 'AI uses standard strategy with occasional mistakes — for players with some experience.',
    actionAccuracy: 0.72,
    speechQuality: 0.7,
    wolfCoordination: 0.65,
    mistakeRate: 0.25,
  },
  hard: {
    id: 'hard',
    label: '高手',
    labelEn: 'Expert',
    description: 'AI 接近最优策略，发言真实，难以区分，适合老手挑战',
    descriptionEn: 'AI plays near-optimal strategy with realistic speech, hard to tell apart — a challenge for veterans.',
    actionAccuracy: 0.92,
    speechQuality: 0.95,
    wolfCoordination: 0.90,
    mistakeRate: 0.08,
  },
};

/** Pure pickers for the lobby difficulty selector (display language 'zh' | 'en'). */
export const difficultyLabel = (config: DifficultyConfig, language: 'zh' | 'en'): string =>
  language === 'en' ? config.labelEn : config.label;

export const difficultyDescription = (config: DifficultyConfig, language: 'zh' | 'en'): string =>
  language === 'en' ? config.descriptionEn : config.description;

export interface GameConfig {
  id: '9-standard' | '12-standard';
  playerCount: number;
  roles: Role[];
  name: string;
  displayName: string;
  description: string;
  roleSummary: string;
  enabled: boolean;
}

export interface WitchStatus {
  hasSave: boolean;
  hasPoison: boolean;
}

export interface NightState {
  wolfKillId: number | null;
  witchPoisonId: number | null;
  witchSaved: boolean;
}

export interface PhaseState {
  phase: GamePhase;
  round: number;
  currentSpeakerId: number | null;
  countdown: number | null;
}

export interface VoteRecord {
  round: number;
  voterId: number;
  targetId: number | null;
  phase: GamePhase.DAY_VOTING;
}

export interface NightAction {
  round: number;
  actorId: number;
  type: 'KILL' | 'CHECK' | 'SAVE' | 'POISON' | 'PASS';
  targetId: number | null;
}

export interface GameRecord {
  id: string;
  userId: string;
  boardId: GameConfig['id'];
  role: Role;
  result: 'WIN' | 'LOSE';
  rounds: number;
  summary: string;
  createdAt: string;
}

export interface WolfChatMessage {
  id: string;
  round: number;
  speakerId: number;
  message: string;
  strategyTag: '刀口' | '悍跳' | '冲锋' | '倒钩' | '补位';
}

export interface GameState {
  config: GameConfig | null;
  players: Player[];
  phaseState: PhaseState;
  logs: GameLog[];
  nightActions: NightAction[];
  voteRecords: VoteRecord[];
  wolfChat: WolfChatMessage[];
  winner: Winner;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface SupabaseSession {
  accessToken: string;
  refreshToken?: string;
  user: {
    id: string;
    email?: string;
  };
}
