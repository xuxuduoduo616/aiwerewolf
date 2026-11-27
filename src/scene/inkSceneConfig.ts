import type { ShellView } from '../components/GlobalShell';
import type { LobbySubview } from '../lobbyFeatures';

export type InkSceneId =
  | 'sign-in'
  | 'lobby'
  | 'match-setup'
  | 'game-night'
  | 'game-day'
  | 'shop'
  | 'profile'
  | 'village';

/**
 * Normalized UV zone [cx, cy, rx, ry, ampX, ampY, speed] in 0..1 image space.
 * Displacement fades smoothly to zero outside the ellipse so focal subjects
 * (faces, hats, architecture) remain razor-sharp with zero warping.
 */
export type MotionZone = readonly [number, number, number, number, number, number, number];

/** Normalized lantern point [x, y, radius, warmth] in 0..1 image space. */
export type LanternPoint = readonly [number, number, number, number];

export interface InkParticleProfile {
  readonly leaves: number;
  readonly petals: number;
  readonly embers: number;
  readonly inkMotes: number;
  readonly windX: number;
  readonly windY: number;
}

export interface InkSceneSpec {
  readonly id: InkSceneId;
  readonly label: string;
  readonly imageSrc: string;
  readonly desktopFocal: readonly [number, number];
  readonly mobileFocal: readonly [number, number];
  readonly fallbackGradient: string;
  readonly moon: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly crimsonRim: number;
    readonly pulse: number;
  };
  readonly mist: {
    readonly yStart: number;
    readonly yEnd: number;
    readonly speed: number;
    readonly density: number;
    readonly tint: readonly [number, number, number];
  };
  readonly water: {
    readonly enabled: boolean;
    readonly yStart: number;
    readonly yEnd: number;
    readonly strength: number;
    readonly speed: number;
  };
  readonly foliageZones: readonly MotionZone[];
  readonly clothZones: readonly MotionZone[];
  readonly lanterns: readonly LanternPoint[];
  readonly foreground: {
    readonly bambooRight: boolean;
    readonly pineTop: boolean;
    readonly opacity: number;
  };
  readonly particles: InkParticleProfile;
  readonly scrimOpacity: number;
}

export const INK_FOREGROUND_LAYERS = {
  bambooRight: '/assets/scenes/layers/bamboo-foreground-right.webp?v=hd3k',
  pineTop: '/assets/scenes/layers/pine-bough-top.webp?v=hd3k',
} as const;

export const LOBBY_SWORDSMAN_ART = '/assets/scenes/lobby-swordsman.webp?v=hd3k';

export const INK_SCENES: Record<InkSceneId, InkSceneSpec> = {
  'sign-in': {
    id: 'sign-in',
    label: 'Moonlit mountain pass overlooking the misty Jianghu valley',
    imageSrc: '/assets/scenes/sign-in-bg.webp?v=hd3k',
    desktopFocal: [0.58, 0.48],
    mobileFocal: [0.72, 0.44],
    fallbackGradient:
      'radial-gradient(circle at 70% 24%, rgba(185, 195, 206, 0.14), transparent 36%), linear-gradient(180deg, #0b0d11 0%, #151920 55%, #090b0e 100%)',
    moon: { x: 0.695, y: 0.24, radius: 0.17, crimsonRim: 0.34, pulse: 0.08 },
    mist: { yStart: 0.56, yEnd: 0.96, speed: 0.018, density: 0.34, tint: [0.68, 0.72, 0.76] },
    water: { enabled: false, yStart: 0.85, yEnd: 1.0, strength: 0, speed: 1.0 },
    foliageZones: [
      [0.91, 0.25, 0.14, 0.20, 0.0042, 0.0022, 0.62],
      [0.89, 0.58, 0.10, 0.12, 0.0028, 0.0014, 0.78],
      [0.08, 0.48, 0.11, 0.18, 0.0024, 0.0012, 0.51],
    ],
    clothZones: [
      [0.71, 0.66, 0.09, 0.11, 0.0055, 0.0022, 1.35],
      [0.84, 0.56, 0.07, 0.07, 0.0065, 0.0028, 1.65],
      [0.79, 0.35, 0.04, 0.04, 0.0030, 0.0014, 1.85],
    ],
    lanterns: [
      [0.135, 0.67, 0.025, 0.85],
      [0.295, 0.76, 0.028, 0.90],
      [0.163, 0.81, 0.022, 0.75],
      [0.262, 0.78, 0.020, 0.65],
    ],
    foreground: { bambooRight: false, pineTop: true, opacity: 0.34 },
    particles: { leaves: 6, petals: 4, embers: 10, inkMotes: 22, windX: -0.45, windY: 0.28 },
    scrimOpacity: 0.34,
  },
  lobby: {
    id: 'lobby',
    label: 'Moonlit Wolf Village nestled among misty karst peaks',
    imageSrc: '/assets/scenes/lobby-bg.webp?v=hd3k',
    desktopFocal: [0.54, 0.34],
    mobileFocal: [0.64, 0.42],
    fallbackGradient:
      'radial-gradient(circle at 74% 24%, rgba(196, 200, 208, 0.15), transparent 36%), linear-gradient(180deg, #0a0c10 0%, #151920 52%, #080a0d 100%)',
    moon: { x: 0.74, y: 0.24, radius: 0.16, crimsonRim: 0.32, pulse: 0.07 },
    mist: { yStart: 0.46, yEnd: 0.82, speed: 0.015, density: 0.32, tint: [0.70, 0.74, 0.78] },
    water: { enabled: true, yStart: 0.76, yEnd: 1.0, strength: 0.0024, speed: 1.15 },
    foliageZones: [
      [0.94, 0.42, 0.11, 0.34, 0.0046, 0.0020, 0.68],
      [0.07, 0.20, 0.14, 0.22, 0.0036, 0.0018, 0.54],
      [0.08, 0.82, 0.12, 0.18, 0.0038, 0.0018, 0.74],
    ],
    clothZones: [],
    lanterns: [
      [0.58, 0.64, 0.032, 0.90],
      [0.67, 0.68, 0.028, 0.85],
      [0.46, 0.66, 0.026, 0.75],
      [0.77, 0.65, 0.024, 0.70],
    ],
    foreground: { bambooRight: true, pineTop: true, opacity: 0.42 },
    particles: { leaves: 9, petals: 5, embers: 14, inkMotes: 24, windX: -0.38, windY: 0.25 },
    scrimOpacity: 0.28,
  },
  'match-setup': {
    id: 'match-setup',
    label: 'Hilltop celestial observatory terrace above a sea of clouds',
    imageSrc: '/assets/scenes/match-setup-bg.webp?v=hd3k',
    desktopFocal: [0.50, 0.48],
    mobileFocal: [0.55, 0.45],
    fallbackGradient:
      'radial-gradient(circle at 72% 22%, rgba(164, 182, 214, 0.14), transparent 38%), linear-gradient(180deg, #090c14 0%, #131926 56%, #080a0f 100%)',
    moon: { x: 0.72, y: 0.22, radius: 0.15, crimsonRim: 0.26, pulse: 0.08 },
    mist: { yStart: 0.58, yEnd: 0.98, speed: 0.020, density: 0.36, tint: [0.64, 0.70, 0.80] },
    water: { enabled: false, yStart: 0.88, yEnd: 1.0, strength: 0, speed: 1.0 },
    foliageZones: [
      [0.08, 0.36, 0.12, 0.22, 0.0032, 0.0015, 0.56],
      [0.92, 0.40, 0.12, 0.22, 0.0034, 0.0016, 0.64],
    ],
    clothZones: [],
    lanterns: [
      [0.86, 0.52, 0.032, 0.88],
      [0.14, 0.54, 0.030, 0.80],
    ],
    foreground: { bambooRight: false, pineTop: true, opacity: 0.26 },
    particles: { leaves: 4, petals: 2, embers: 16, inkMotes: 26, windX: -0.26, windY: -0.14 },
    scrimOpacity: 0.48,
  },
  'game-night': {
    id: 'game-night',
    label: 'Nocturnal moonlit courtyard surrounded by ink pines and fog',
    imageSrc: '/assets/scenes/game-night-bg.webp?v=hd3k',
    desktopFocal: [0.50, 0.50],
    mobileFocal: [0.50, 0.46],
    fallbackGradient:
      'radial-gradient(circle at 50% 18%, rgba(154, 166, 198, 0.12), transparent 42%), linear-gradient(180deg, #07090d 0%, #10141c 56%, #06070a 100%)',
    moon: { x: 0.54, y: 0.18, radius: 0.14, crimsonRim: 0.30, pulse: 0.07 },
    mist: { yStart: 0.62, yEnd: 1.0, speed: 0.014, density: 0.28, tint: [0.56, 0.62, 0.72] },
    water: { enabled: false, yStart: 0.9, yEnd: 1.0, strength: 0, speed: 1.0 },
    foliageZones: [
      [0.06, 0.44, 0.11, 0.34, 0.0038, 0.0018, 0.60],
      [0.94, 0.44, 0.11, 0.34, 0.0038, 0.0018, 0.67],
    ],
    clothZones: [],
    lanterns: [
      [0.14, 0.78, 0.026, 0.75],
      [0.86, 0.78, 0.026, 0.75],
    ],
    foreground: { bambooRight: true, pineTop: false, opacity: 0.24 },
    particles: { leaves: 5, petals: 2, embers: 8, inkMotes: 18, windX: -0.24, windY: 0.18 },
    scrimOpacity: 0.44,
  },
  'game-day': {
    id: 'game-day',
    label: 'Misty mountain dawn breaking gently over the ink village',
    imageSrc: '/assets/scenes/game-day-bg.webp?v=hd3k',
    desktopFocal: [0.50, 0.50],
    mobileFocal: [0.50, 0.48],
    fallbackGradient:
      'radial-gradient(circle at 50% 24%, rgba(196, 162, 108, 0.14), transparent 46%), linear-gradient(180deg, #13161b 0%, #1d2128 54%, #0f1116 100%)',
    moon: { x: 0.52, y: 0.26, radius: 0.18, crimsonRim: 0.0, pulse: 0.05 },
    mist: { yStart: 0.48, yEnd: 0.95, speed: 0.016, density: 0.32, tint: [0.76, 0.72, 0.66] },
    water: { enabled: false, yStart: 0.9, yEnd: 1.0, strength: 0, speed: 1.0 },
    foliageZones: [
      [0.06, 0.42, 0.11, 0.32, 0.0036, 0.0016, 0.58],
      [0.94, 0.42, 0.11, 0.32, 0.0036, 0.0016, 0.65],
    ],
    clothZones: [],
    lanterns: [],
    foreground: { bambooRight: true, pineTop: false, opacity: 0.22 },
    particles: { leaves: 7, petals: 4, embers: 4, inkMotes: 18, windX: 0.28, windY: 0.20 },
    scrimOpacity: 0.42,
  },
  shop: {
    id: 'shop',
    label: 'Lantern-lit Wuxia treasury veranda framed by plum blossoms',
    imageSrc: '/assets/scenes/shop-bg.webp?v=hd3k',
    desktopFocal: [0.50, 0.50],
    mobileFocal: [0.50, 0.46],
    fallbackGradient:
      'radial-gradient(circle at 82% 26%, rgba(220, 158, 72, 0.14), transparent 40%), linear-gradient(180deg, #0d0c0f 0%, #191519 54%, #09090b 100%)',
    moon: { x: 0.50, y: 0.24, radius: 0.14, crimsonRim: 0.18, pulse: 0.05 },
    mist: { yStart: 0.56, yEnd: 0.94, speed: 0.013, density: 0.26, tint: [0.74, 0.69, 0.64] },
    water: { enabled: false, yStart: 0.9, yEnd: 1.0, strength: 0, speed: 1.0 },
    foliageZones: [
      [0.10, 0.24, 0.15, 0.20, 0.0036, 0.0018, 0.60],
      [0.90, 0.24, 0.15, 0.20, 0.0038, 0.0018, 0.68],
    ],
    clothZones: [
      [0.14, 0.42, 0.06, 0.12, 0.0030, 0.0012, 1.15],
      [0.86, 0.42, 0.06, 0.12, 0.0030, 0.0012, 1.25],
    ],
    lanterns: [
      [0.13, 0.34, 0.048, 0.95],
      [0.87, 0.34, 0.048, 0.95],
      [0.24, 0.28, 0.035, 0.80],
      [0.76, 0.28, 0.035, 0.80],
    ],
    foreground: { bambooRight: false, pineTop: false, opacity: 0 },
    particles: { leaves: 3, petals: 11, embers: 14, inkMotes: 16, windX: -0.32, windY: 0.28 },
    scrimOpacity: 0.52,
  },
  profile: {
    id: 'profile',
    label: 'Tranquil moonlit bamboo courtyard beside a reflecting lotus pond',
    imageSrc: '/assets/scenes/profile-bg.webp?v=hd3k',
    desktopFocal: [0.50, 0.50],
    mobileFocal: [0.54, 0.48],
    fallbackGradient:
      'radial-gradient(circle at 72% 24%, rgba(164, 186, 182, 0.13), transparent 40%), linear-gradient(180deg, #0a0d0f 0%, #13191b 56%, #080a0c 100%)',
    moon: { x: 0.72, y: 0.22, radius: 0.15, crimsonRim: 0.14, pulse: 0.06 },
    mist: { yStart: 0.48, yEnd: 0.78, speed: 0.012, density: 0.28, tint: [0.66, 0.74, 0.73] },
    water: { enabled: true, yStart: 0.72, yEnd: 1.0, strength: 0.0028, speed: 1.05 },
    foliageZones: [
      [0.10, 0.44, 0.16, 0.38, 0.0048, 0.0020, 0.64],
      [0.90, 0.44, 0.16, 0.38, 0.0046, 0.0020, 0.71],
    ],
    clothZones: [],
    lanterns: [],
    foreground: { bambooRight: true, pineTop: false, opacity: 0.30 },
    particles: { leaves: 10, petals: 2, embers: 6, inkMotes: 20, windX: -0.28, windY: 0.22 },
    scrimOpacity: 0.50,
  },
  village: {
    id: 'village',
    label: 'Misty stone arch bridge spanning a lantern-lit mountain river town',
    imageSrc: '/assets/scenes/village-bg.webp?v=hd3k',
    desktopFocal: [0.54, 0.50],
    mobileFocal: [0.62, 0.48],
    fallbackGradient:
      'radial-gradient(circle at 68% 30%, rgba(212, 166, 98, 0.13), transparent 40%), linear-gradient(180deg, #0a0c10 0%, #151820 56%, #08090c 100%)',
    moon: { x: 0.68, y: 0.20, radius: 0.14, crimsonRim: 0.22, pulse: 0.06 },
    mist: { yStart: 0.42, yEnd: 0.74, speed: 0.016, density: 0.30, tint: [0.70, 0.73, 0.77] },
    water: { enabled: true, yStart: 0.68, yEnd: 1.0, strength: 0.0032, speed: 1.25 },
    foliageZones: [
      [0.08, 0.36, 0.14, 0.26, 0.0036, 0.0018, 0.58],
      [0.92, 0.34, 0.14, 0.26, 0.0038, 0.0018, 0.66],
    ],
    clothZones: [],
    lanterns: [
      [0.64, 0.58, 0.036, 0.92],
      [0.74, 0.60, 0.032, 0.88],
      [0.84, 0.56, 0.030, 0.84],
      [0.52, 0.62, 0.028, 0.78],
    ],
    foreground: { bambooRight: false, pineTop: true, opacity: 0.28 },
    particles: { leaves: 6, petals: 4, embers: 16, inkMotes: 20, windX: -0.34, windY: 0.22 },
    scrimOpacity: 0.48,
  },
};

export const resolveShellSceneId = (
  utilityView: string | null,
  activeView: ShellView,
  lobbySubview: LobbySubview,
): InkSceneId => {
  if (utilityView) return 'profile';
  if (activeView === 'shop') return 'shop';
  if (activeView === 'profile') return 'profile';
  if (activeView === 'wolfvillage' || activeView === 'friends') return 'village';
  switch (lobbySubview) {
    case 'mode-choice':
    case 'match-setup':
    case 'online-qualifier':
      return 'match-setup';
    case 'daily-check-in':
    case 'economy-history':
      return 'shop';
    case 'activity':
    case 'faction-support':
    case 'battle-pass':
      return 'village';
    case 'home':
    default:
      return 'lobby';
  }
};
