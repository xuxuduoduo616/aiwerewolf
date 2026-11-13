/**
 * H2-E: "AI's view of you" post-game share card.
 *
 * The model is a pure projection of one finished `ReplayRecord`: no DOM, no
 * storage, no network, no `Date` / `Math.random`. The canvas layer only renders
 * that model, and the export layer only turns a canvas into a local PNG download
 * (`canvas.toBlob('image/png')` → `URL.createObjectURL` → `<a download>`).
 *
 * Nothing here uploads data or calls a server; a missing canvas / `toBlob` /
 * object-URL implementation degrades to `{ ok: false }` instead of throwing.
 */

import type { ReplayPlayerSeat, ReplayRecord } from '../replay/replayTypes';
import {
  buildFinalSuspicionRanking,
  buildVoteReasonGroups,
  buildWolfChatGroups,
  type ReplayVoteReasonRow,
  type ReplayWolfChatRow,
} from '../replay/replaySelectors';

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1350;
export const SHARE_CARD_MAX_QUOTES = 3;
export const SHARE_CARD_QUOTE_MAX_CHARS = 132;
export const SHARE_CARD_PNG_MIME = 'image/png';

/** Exact English chrome required by the failure path (AC6). */
export const SHARE_CARD_EXPORT_UNAVAILABLE = 'Export unavailable in this browser';
/** Exact English line used when the replay has no usable final suspicion data. */
export const SHARE_CARD_SUSPICION_UNAVAILABLE = 'final suspicion unavailable';

const BOARD_LABELS: Record<string, string> = {
  '9-standard': '9-Player Standard',
  '12-standard': '12-Player Standard',
};

const WINNER_LABELS: Record<string, string> = {
  VILLAGERS: 'Village Wins',
  WEREWOLVES: 'Werewolves Win',
};

export interface ShareCardQuote {
  kind: 'vote' | 'wolf-chat';
  round: number;
  speakerId: number;
  targetId: number | null;
  /** Short English source line, e.g. `Day 2 · Seat 4 voted for you`. */
  label: string;
  /** Whitespace-normalized, length-capped quote (may end with an ellipsis). */
  text: string;
  truncated: boolean;
}

export interface ShareCardStat {
  key: 'average' | 'rank' | 'most-suspicious';
  label: string;
  value: string;
  detail: string;
}

/**
 * Fixed, deterministic data for both the DOM preview and the canvas render.
 * Every displayed string lives here so the canvas layer cannot invent content.
 */
export interface ShareCardModel {
  gameId: string;
  /** Suggested download name, e.g. `ai-view-of-you-<gameId>.png`. */
  fileName: string;
  title: string;
  subtitle: string;
  boardLabel: string;
  outcomeLabel: string;
  humanSeat: number;
  /** Revealed only because this model is built from a finished replay. */
  humanRole: string | null;
  seatLine: string;
  metaLine: string;
  roundsLine: string;
  finalRound: number | null;
  suspicionAvailable: boolean;
  suspicionUnavailableText: string;
  averageSuspicion: number | null;
  averageSuspicionPercent: string | null;
  humanRank: number | null;
  rankedPlayerCount: number;
  rankText: string;
  mostSuspiciousSeat: number | null;
  mostSuspiciousScore: number | null;
  mostSuspiciousPercent: string | null;
  mostSuspiciousText: string;
  stats: ShareCardStat[];
  quotesTitle: string;
  quotes: ShareCardQuote[];
  emptyQuotesText: string;
  footer: string;
  width: number;
  height: number;
}

const percent = (score: number | null): string | null => (
  score === null ? null : `${Math.round(score * 100)}%`
);

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Cap a quote on Unicode code points (not UTF-16 units) so an emoji or CJK
 * character is never cut in half. `truncated` tells tests/UI whether the
 * ellipsis is part of the source text or added here.
 */
export const truncateShareCardQuote = (
  text: string,
  maxChars: number = SHARE_CARD_QUOTE_MAX_CHARS,
): { text: string; truncated: boolean } => {
  const normalized = normalizeWhitespace(text);
  if (maxChars <= 0) return { text: '…', truncated: normalized.length > 0 };
  const characters = Array.from(normalized);
  if (characters.length <= maxChars) return { text: normalized, truncated: false };
  return {
    text: `${characters.slice(0, maxChars).join('').trimEnd()}…`,
    truncated: true,
  };
};

const safeFileStem = (gameId: string): string => {
  const normalized = typeof gameId === 'string' ? gameId : '';
  const cleaned = normalized
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'match';
};

const playerForHuman = (players: readonly ReplayPlayerSeat[]): ReplayPlayerSeat | null => (
  players.find(player => player.isHuman)
  ?? players.find(player => player.seat === 1)
  ?? players[0]
  ?? null
);

/** AI exile votes aimed at the human, then wolf night chat, at most three. */
const collectQuotes = (replay: ReplayRecord, humanSeat: number): ShareCardQuote[] => {
  const voteRows: ReplayVoteReasonRow[] = buildVoteReasonGroups(replay)
    .flatMap(group => group.rows)
    .filter(row => row.hasReason && row.voterId !== humanSeat && row.targetId === humanSeat);
  const wolfRows: ReplayWolfChatRow[] = buildWolfChatGroups(replay)
    .flatMap(group => group.rows);

  const candidates: {
    kind: ShareCardQuote['kind'];
    round: number;
    speakerId: number;
    targetId: number | null;
    label: string;
    rawText: string;
  }[] = [
    ...voteRows.map(row => ({
      kind: 'vote' as const,
      round: row.round,
      speakerId: row.voterId,
      targetId: row.targetId,
      label: `Day ${row.round} · Seat ${row.voterId} voted for you`,
      rawText: row.reason,
    })),
    ...wolfRows.map(row => ({
      kind: 'wolf-chat' as const,
      round: row.round,
      speakerId: row.speakerId,
      targetId: null,
      label: `Night ${row.round} · Seat ${row.speakerId} wolf chat`,
      rawText: row.message,
    })),
  ];

  const seen = new Set<string>();
  const quotes: ShareCardQuote[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate.rawText);
    if (!normalized) continue;
    // Deduplicate on the full text before truncation so two different long
    // reasons that share a prefix still both qualify.
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const capped = truncateShareCardQuote(normalized);
    quotes.push({
      kind: candidate.kind,
      round: candidate.round,
      speakerId: candidate.speakerId,
      targetId: candidate.targetId,
      label: candidate.label,
      text: capped.text,
      truncated: capped.truncated,
    });
    if (quotes.length >= SHARE_CARD_MAX_QUOTES) break;
  }
  return quotes;
};

/**
 * Pure: the same replay always yields a deep-equal model, and a replay without
 * usable suspicion data yields `suspicionAvailable: false` instead of a
 * fabricated score. It never throws on partial/malformed runtime input.
 */
export const buildShareCardModel = (replay: ReplayRecord): ShareCardModel => {
  const safeReplay = (replay ?? {}) as ReplayRecord;
  const players: ReplayPlayerSeat[] = Array.isArray(safeReplay.players) ? safeReplay.players : [];
  const human = playerForHuman(players);
  const humanSeat = human?.seat ?? 1;
  const humanRole = human?.role ?? null;
  const ranking = buildFinalSuspicionRanking(safeReplay);

  const hasSuspicion = Boolean(
    ranking
    && ranking.humanRank !== null
    && ranking.averageSuspicionOfHuman !== null,
  );
  const averageSuspicion = hasSuspicion ? ranking!.averageSuspicionOfHuman : null;
  const humanRank = hasSuspicion ? ranking!.humanRank : null;
  const finalRound = ranking?.round ?? null;
  const rankedPlayerCount = ranking?.entries.length ?? 0;
  const mostSuspicious = hasSuspicion ? ranking!.mostSuspiciousActor : null;
  const mostSuspiciousSeat = mostSuspicious?.seat ?? null;
  const mostSuspiciousScore = mostSuspicious?.score ?? null;
  const averageSuspicionPercent = percent(averageSuspicion);
  const mostSuspiciousPercent = percent(mostSuspiciousScore);
  const rankText = humanRank !== null ? `#${humanRank} of ${rankedPlayerCount}` : '—';
  const mostSuspiciousText = mostSuspiciousSeat !== null
    ? `Seat ${mostSuspiciousSeat} · ${mostSuspiciousPercent ?? '—'}`
    : '—';

  const boardLabel = BOARD_LABELS[safeReplay.boardId] ?? safeReplay.boardId ?? 'Standard';
  const outcomeLabel = WINNER_LABELS[safeReplay.outcome?.winner] ?? safeReplay.outcome?.winner ?? 'Match complete';
  const rounds = typeof safeReplay.outcome?.rounds === 'number' ? safeReplay.outcome.rounds : 0;
  const roundsLine = `${rounds} round${rounds === 1 ? '' : 's'} · ${outcomeLabel}`;
  const seatLine = `Seat ${humanSeat}${humanRole ? ` · ${humanRole}` : ''}`;

  const stats: ShareCardStat[] = hasSuspicion ? [
    {
      key: 'average',
      label: 'AI average suspicion',
      value: averageSuspicionPercent ?? '—',
      detail: `Final read · Day ${finalRound} · scale 0–100%`,
    },
    {
      key: 'rank',
      label: 'Your rank',
      value: rankText,
      detail: `Among ${rankedPlayerCount} living seats`,
    },
    {
      key: 'most-suspicious',
      label: 'Most suspicious AI',
      value: mostSuspiciousText,
      detail: 'Highest final suspicion of you',
    },
  ] : [];

  const gameId = typeof safeReplay.gameId === 'string' ? safeReplay.gameId : '';

  return {
    gameId,
    fileName: `ai-view-of-you-${safeFileStem(gameId)}.png`,
    title: "AI's view of you",
    subtitle: 'How the table read you across the match',
    boardLabel,
    outcomeLabel,
    humanSeat,
    humanRole,
    seatLine,
    metaLine: `${boardLabel} · ${roundsLine}`,
    roundsLine,
    finalRound,
    suspicionAvailable: hasSuspicion,
    suspicionUnavailableText: SHARE_CARD_SUSPICION_UNAVAILABLE,
    averageSuspicion,
    averageSuspicionPercent,
    humanRank,
    rankedPlayerCount,
    rankText,
    mostSuspiciousSeat,
    mostSuspiciousScore,
    mostSuspiciousPercent,
    mostSuspiciousText,
    stats,
    quotesTitle: 'Why they suspected you',
    quotes: collectQuotes(safeReplay, humanSeat),
    emptyQuotesText: 'No AI vote reasons or wolf chat were recorded for this match.',
    footer: 'Built locally from your saved replay. Nothing leaves this browser.',
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
  };
};

/* ─── Canvas drawing layer ─────────────────────────────────────────────── */

/**
 * The minimal 2D-context surface this card uses. Keeping it structural lets the
 * unit tests pass a plain recording stub (no `document`, no jsdom).
 */
export interface ShareCardGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface ShareCardCanvasContextLike {
  fillStyle: string | ShareCardGradientLike;
  strokeStyle: string | ShareCardGradientLike;
  lineWidth: number;
  font: string;
  textAlign: 'left' | 'center' | 'right';
  textBaseline: 'top' | 'middle' | 'alphabetic' | 'bottom';
  globalAlpha: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  save(): void;
  restore(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): ShareCardGradientLike;
}

export interface ShareCardCanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): ShareCardCanvasContextLike | null;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
}

const FONT_STACK = '"Inter", "Noto Sans", system-ui, -apple-system, sans-serif';
const font = (weight: number, size: number): string => `${weight} ${size}px ${FONT_STACK}`;

/**
 * Greedy wrap for mixed English/CJK quotes. Tokens that do not fit on their own
 * fall back to code-point splitting, so Chinese text wraps instead of clipping.
 */
const wrapCanvasText = (
  ctx: ShareCardCanvasContextLike,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] => {
  const words = normalizeWhitespace(text).split(' ');
  const lines: string[] = [];
  let current = '';

  const pushLongToken = (token: string) => {
    let fragment = '';
    for (const character of Array.from(token)) {
      const candidate = `${fragment}${character}`;
      if (fragment && ctx.measureText(candidate).width > maxWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = candidate;
      }
    }
    current = fragment;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (ctx.measureText(word).width > maxWidth) {
      pushLongToken(word);
    } else {
      current = word;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines) {
    // `maxLines` is a hard cap: signal clipping with an ellipsis.
    const consumed = lines.join(' ').length;
    if (consumed < normalizeWhitespace(text).length) {
      let last = lines[lines.length - 1].trimEnd();
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = Array.from(last).slice(0, -1).join('');
      }
      lines[lines.length - 1] = `${last}…`;
    }
  }
  return lines.length > 0 ? lines : [''];
};

/**
 * Draw the card into a 1080×1350 canvas. Throws only on a missing 2D context;
 * `exportShareCardPng` catches that and returns a failure result.
 */
export const drawShareCard = (
  model: ShareCardModel,
  canvas: ShareCardCanvasLike,
): ShareCardCanvasContextLike => {
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Share card canvas 2D context is unavailable.');

  const width = SHARE_CARD_WIDTH;
  const height = SHARE_CARD_HEIGHT;
  const pad = 72;
  const contentWidth = width - pad * 2;

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#09090b');
  background.addColorStop(0.55, '#111114');
  background.addColorStop(1, '#1c1013');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Blood-red top rule and a faint moon: the only decoration, drawn locally.
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(0, 0, width, 8);
  ctx.fillStyle = 'rgba(244,244,245,0.07)';
  ctx.beginPath();
  ctx.arc(width - 150, 140, 96, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(244,244,245,0.05)';
  ctx.beginPath();
  ctx.arc(width - 150, 140, 132, 0, Math.PI * 2);
  ctx.fill();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.font = font(700, 24);
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText('AI WEREWOLF · POST-GAME', pad, 92);

  ctx.font = font(900, 66);
  ctx.fillStyle = '#fafafa';
  ctx.fillText(model.title, pad, 176);

  ctx.font = font(500, 30);
  ctx.fillStyle = '#d4d4d8';
  ctx.fillText(model.subtitle, pad, 226);

  ctx.font = font(500, 26);
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText(model.metaLine, pad, 272);

  ctx.fillStyle = 'rgba(244,244,245,0.14)';
  ctx.fillRect(pad, 300, contentWidth, 2);

  // Seat + revealed role.
  ctx.fillStyle = 'rgba(24,24,27,0.92)';
  ctx.fillRect(pad, 328, contentWidth, 118);
  ctx.font = font(700, 22);
  ctx.fillStyle = '#71717a';
  ctx.fillText('YOUR SEAT · REVEALED AT GAME OVER', pad + 26, 366);
  ctx.font = font(800, 48);
  ctx.fillStyle = '#f4f4f5';
  ctx.fillText(model.seatLine, pad + 26, 424);
  ctx.textAlign = 'right';
  ctx.font = font(500, 24);
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText(model.outcomeLabel, pad + contentWidth - 26, 424);
  ctx.textAlign = 'left';

  let cursorY = 474;
  if (model.suspicionAvailable) {
    for (const stat of model.stats) {
      ctx.fillStyle = 'rgba(9,9,11,0.6)';
      ctx.fillRect(pad, cursorY, contentWidth, 96);
      ctx.fillStyle = '#71717a';
      ctx.font = font(700, 20);
      ctx.fillText(stat.label.toUpperCase(), pad + 24, cursorY + 32);
      ctx.fillStyle = '#fafafa';
      ctx.font = font(800, 44);
      ctx.fillText(stat.value, pad + 24, cursorY + 78);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#a1a1aa';
      ctx.font = font(500, 22);
      ctx.fillText(stat.detail, pad + contentWidth - 24, cursorY + 56);
      ctx.textAlign = 'left';
      cursorY += 106;
    }
  } else {
    ctx.fillStyle = 'rgba(127,29,29,0.35)';
    ctx.fillRect(pad, cursorY, contentWidth, 96);
    ctx.fillStyle = '#fca5a5';
    ctx.font = font(700, 34);
    ctx.fillText(SHARE_CARD_SUSPICION_UNAVAILABLE, pad + 24, cursorY + 58);
    cursorY += 106;
  }

  cursorY += 44;
  ctx.font = font(800, 32);
  ctx.fillStyle = '#f4f4f5';
  ctx.fillText(model.quotesTitle, pad, cursorY);
  cursorY += 30;

  if (model.quotes.length === 0) {
    ctx.font = font(500, 26);
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(model.emptyQuotesText, pad, cursorY + 34);
  } else {
    for (const quote of model.quotes) {
      const lines = wrapCanvasText(ctx, quote.text, contentWidth - 48, 2);
      const blockHeight = 62 + lines.length * 32;
      ctx.fillStyle = 'rgba(24,24,27,0.9)';
      ctx.fillRect(pad, cursorY, contentWidth, blockHeight);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(pad, cursorY, 4, blockHeight);
      ctx.font = font(700, 19);
      ctx.fillStyle = '#a1a1aa';
      ctx.fillText(quote.label.toUpperCase(), pad + 24, cursorY + 28);
      ctx.font = font(400, 26);
      ctx.fillStyle = '#e4e4e7';
      lines.forEach((line, index) => {
        ctx.fillText(line, pad + 24, cursorY + 60 + index * 32);
      });
      cursorY += blockHeight + 14;
    }
  }

  ctx.fillStyle = 'rgba(244,244,245,0.14)';
  ctx.fillRect(pad, height - 66, contentWidth, 1);
  ctx.font = font(500, 20);
  ctx.fillStyle = '#71717a';
  ctx.fillText(model.footer, pad, height - 32);

  return ctx;
};

/* ─── PNG export layer ─────────────────────────────────────────────────── */

export type ShareCardExportFailureReason =
  | 'environment-unavailable'
  | 'canvas-unavailable'
  | 'draw-failed'
  | 'to-blob-unavailable'
  | 'blob-empty'
  | 'object-url-unavailable'
  | 'download-failed';

export type ShareCardExportResult =
  | {
    ok: true;
    fileName: string;
    mimeType: typeof SHARE_CARD_PNG_MIME;
    width: number;
    height: number;
  }
  | {
    ok: false;
    reason: ShareCardExportFailureReason;
    message: string;
  };

const exportFailure = (
  reason: ShareCardExportFailureReason,
  message: string,
): ShareCardExportResult => ({ ok: false, reason, message });

/** Injectable seam so tests can run without `document` or a real canvas. */
export interface ShareCardExportEnvironment {
  createCanvas(): ShareCardCanvasLike | null;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  triggerDownload(url: string, fileName: string): void;
}

/** `document` / `URL` based environment; `null` outside a browser. */
export const createBrowserShareCardEnvironment = (): ShareCardExportEnvironment | null => {
  if (typeof document === 'undefined') return null;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;

  return {
    createCanvas: () => {
      try {
        const canvas = document.createElement('canvas');
        return canvas as unknown as ShareCardCanvasLike;
      } catch {
        return null;
      }
    },
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    },
    triggerDownload: (url, fileName) => {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      const parent = document.body ?? document.documentElement;
      parent.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    },
  };
};

const canvasToPngBlob = (canvas: ShareCardCanvasLike): Promise<Blob | null> => (
  new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('canvas.toBlob is unavailable'));
      return;
    }
    try {
      canvas.toBlob(blob => resolve(blob), SHARE_CARD_PNG_MIME);
    } catch (error) {
      reject(error);
    }
  })
);

/**
 * Render + download the card as `ai-view-of-you-<gameId>.png`.
 *
 * Never throws: every unsupported browser capability or canvas error becomes
 * `{ ok: false }`, so the replay dialog keeps working and can show the exact
 * "Export unavailable in this browser" line.
 */
export const exportShareCardPng = async (
  model: ShareCardModel,
  environment: ShareCardExportEnvironment | null = createBrowserShareCardEnvironment(),
): Promise<ShareCardExportResult> => {
  if (!environment) {
    return exportFailure(
      'environment-unavailable',
      'This browser does not expose canvas blob export.',
    );
  }

  let objectUrl: string | null = null;
  try {
    const canvas = environment.createCanvas();
    if (!canvas) {
      return exportFailure('canvas-unavailable', 'Could not create a local canvas element.');
    }
    if (typeof canvas.toBlob !== 'function') {
      return exportFailure('to-blob-unavailable', 'canvas.toBlob is unavailable.');
    }

    try {
      drawShareCard(model, canvas);
    } catch {
      return exportFailure('draw-failed', 'Could not draw the share card.');
    }

    let blob: Blob | null = null;
    try {
      blob = await canvasToPngBlob(canvas);
    } catch {
      return exportFailure('download-failed', 'PNG encoding failed.');
    }
    if (!blob) {
      return exportFailure('blob-empty', 'PNG encoding returned no data.');
    }

    try {
      objectUrl = environment.createObjectURL(blob);
    } catch {
      return exportFailure('object-url-unavailable', 'Could not create a local blob URL.');
    }

    try {
      environment.triggerDownload(objectUrl, model.fileName);
    } catch {
      return exportFailure('download-failed', 'The download could not be started.');
    }

    return {
      ok: true,
      fileName: model.fileName,
      mimeType: SHARE_CARD_PNG_MIME,
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
    };
  } catch {
    return exportFailure('download-failed', 'The share card could not be exported.');
  } finally {
    if (objectUrl) {
      try {
        environment.revokeObjectURL(objectUrl);
      } catch {
        // Revoking is best-effort; the PNG has already been handed to download.
      }
    }
  }
};

/**
 * Cheap capability probe for the UI. It never throws and returns `false` during
 * SSR / in browsers without canvas blob support.
 */
export const isShareCardExportSupported = (): boolean => {
  const environment = createBrowserShareCardEnvironment();
  if (!environment) return false;
  let canvas: ShareCardCanvasLike | null = null;
  try {
    canvas = environment.createCanvas();
  } catch {
    return false;
  }
  if (!canvas || typeof canvas.toBlob !== 'function') return false;
  try {
    return Boolean(canvas.getContext('2d'));
  } catch {
    return false;
  }
};
