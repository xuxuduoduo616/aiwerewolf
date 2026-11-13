import { describe, expect, it, vi } from 'vitest';
import { GamePhase, Role } from '../types';
import type {
  ReplayBeliefSnapshot,
  ReplayPlayerSeat,
  ReplayRecord,
  ReplayVote,
  ReplayWolfChatEntry,
} from '../replay/replayTypes';
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_MAX_QUOTES,
  SHARE_CARD_QUOTE_MAX_CHARS,
  SHARE_CARD_SUSPICION_UNAVAILABLE,
  SHARE_CARD_WIDTH,
  buildShareCardModel,
  createBrowserShareCardEnvironment,
  drawShareCard,
  exportShareCardPng,
  isShareCardExportSupported,
  truncateShareCardQuote,
  type ShareCardCanvasContextLike,
  type ShareCardCanvasLike,
  type ShareCardExportEnvironment,
  type ShareCardModel,
} from './shareCardImage';

/* ─── Fixtures ─────────────────────────────────────────────────────────── */

const ROLE_ORDER_9: Role[] = [
  Role.VILLAGER, Role.WEREWOLF, Role.SEER, Role.WITCH, Role.VILLAGER,
  Role.HUNTER, Role.WEREWOLF, Role.VILLAGER, Role.WEREWOLF,
];
const ROLE_ORDER_12: Role[] = [
  ...ROLE_ORDER_9, Role.VILLAGER, Role.WEREWOLF, Role.IDIOT,
];

const playersFor = (playerCount: 9 | 12): ReplayPlayerSeat[] => {
  const roles = playerCount === 9 ? ROLE_ORDER_9 : ROLE_ORDER_12;
  return roles.map((role, index) => ({ seat: index + 1, role, isHuman: index === 0 }));
};

/**
 * Controlled final-round scores: every AI seat gives the human 0.6, seat 2 gets
 * 0.9 from the other AI seats, and every other target gets 0.2. That makes the
 * human rank #2 with a deterministic 60% average.
 */
const beliefSnapshotsFor = (
  playerCount: number,
  rounds: number[] = [1, 2, 3],
): ReplayBeliefSnapshot[] => rounds.flatMap(round => (
  Array.from({ length: playerCount }, (_, index) => index + 1)
    .filter(actorId => actorId !== 1)
    .map(actorId => ({
      round,
      actorId,
      scores: Array.from({ length: playerCount }, (_, index) => index + 1)
        .filter(targetId => targetId !== actorId)
        .map(targetId => ({
          targetId,
          score: targetId === 1 ? 0.6 : targetId === 2 ? 0.9 : 0.2,
        })),
    }))
));

const LONG_REASON = `Seat 2 spends the whole day explaining, at considerable length, why the human seat is the only possible wolf and why every other vote is a mistake. ${'Detail continues. '.repeat(20)}`;

const votesFor = (): ReplayVote[] => [
  { round: 1, voterId: 4, targetId: 1, reason: 'Seat 4 says the human seat dodged every question.' },
  { round: 2, voterId: 2, targetId: 1, reason: LONG_REASON },
  { round: 1, voterId: 1, targetId: 3 },
  { round: 1, voterId: 5, targetId: 7, reason: 'Seat 5 piles on seat 7.' },
  { round: 3, voterId: 6, targetId: 1 },
];

const wolfChatFor = (): ReplayWolfChatEntry[] => [
  { round: 1, speakerId: 7, message: 'Wolf chat: keep the human seat under pressure.' },
  { round: 1, speakerId: 2, message: 'Wolf chat: keep the human seat under pressure.' },
  { round: 2, speakerId: 3, message: 'Follow the vote onto seat 1.' },
];

const makeReplay = (
  playerCount: 9 | 12,
  overrides: Partial<ReplayRecord> = {},
): ReplayRecord => ({
  schemaVersion: 1,
  gameId: `share-card-fixture-${playerCount}`,
  createdAt: '2026-11-12T09:30:00.000Z',
  boardId: playerCount === 9 ? '9-standard' : '12-standard',
  difficulty: 'normal',
  language: 'en',
  isGuest: true,
  players: playersFor(playerCount),
  phases: [
    { phase: GamePhase.NIGHT_START, round: 0 },
    { phase: GamePhase.DAY_DISCUSSION, round: 1 },
    { phase: GamePhase.GAME_OVER, round: 3 },
  ],
  speeches: [],
  votes: votesFor(),
  beliefSnapshots: beliefSnapshotsFor(playerCount),
  wolfChat: wolfChatFor(),
  checks: [],
  outcome: { winner: 'VILLAGERS', rounds: 3 },
  ...overrides,
});

/* ─── Canvas stub (no DOM / jsdom) ─────────────────────────────────────── */

interface CanvasCall {
  method: string;
  args: unknown[];
}

interface CanvasStubOptions {
  contextMissing?: boolean;
  toBlob?: boolean;
  blob?: Blob | null;
  toBlobThrows?: boolean;
}

const makeCanvasStub = (options: CanvasStubOptions = {}) => {
  const calls: CanvasCall[] = [];
  const fillTexts: string[] = [];
  const gradient = { addColorStop: vi.fn() };
  const record = (method: string, args: unknown[]) => { calls.push({ method, args }); };

  const context: ShareCardCanvasContextLike = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    fillRect: (x, y, width, height) => record('fillRect', [x, y, width, height]),
    strokeRect: (x, y, width, height) => record('strokeRect', [x, y, width, height]),
    fillText: (text, x, y) => {
      fillTexts.push(text);
      record('fillText', [text, x, y]);
    },
    measureText: text => {
      record('measureText', [text]);
      return { width: Array.from(text).length * 12 };
    },
    beginPath: () => record('beginPath', []),
    arc: (x, y, radius, startAngle, endAngle) => record('arc', [x, y, radius, startAngle, endAngle]),
    fill: () => record('fill', []),
    stroke: () => record('stroke', []),
    moveTo: (x, y) => record('moveTo', [x, y]),
    lineTo: (x, y) => record('lineTo', [x, y]),
    save: () => record('save', []),
    restore: () => record('restore', []),
    createLinearGradient: () => gradient,
  };

  const canvas: ShareCardCanvasLike = {
    width: 0,
    height: 0,
    getContext: () => (options.contextMissing ? null : context),
  };
  if (options.toBlob !== false) {
    canvas.toBlob = (callback: (blob: Blob | null) => void, type?: string) => {
      record('toBlob', [type]);
      if (options.toBlobThrows) throw new Error('toBlob exploded');
      const blob = options.blob === undefined
        ? new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
        : options.blob;
      callback(blob);
    };
  }

  return { canvas, context, calls, fillTexts, gradient };
};

const makeExportEnvironment = (overrides: Partial<ShareCardExportEnvironment> = {}) => {
  const { canvas } = makeCanvasStub();
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:share-card-test');
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  const triggerDownload = vi.fn((_url: string, _fileName: string) => undefined);
  const environment: ShareCardExportEnvironment = {
    createCanvas: () => canvas,
    createObjectURL,
    revokeObjectURL,
    triggerDownload,
    ...overrides,
  };
  return { environment, createObjectURL, revokeObjectURL, triggerDownload, canvas };
};

/* ─── Model ────────────────────────────────────────────────────────────── */

describe('buildShareCardModel', () => {
  it('projects a 9-player replay into seat, suspicion stats and quotes', () => {
    const replay = makeReplay(9);
    const model = buildShareCardModel(replay);

    expect(model.fileName).toBe('ai-view-of-you-share-card-fixture-9.png');
    expect(model.title).toBe("AI's view of you");
    expect(model.boardLabel).toBe('9-Player Standard');
    expect(model.outcomeLabel).toBe('Village Wins');
    expect(model.metaLine).toBe('9-Player Standard · 3 rounds · Village Wins');
    expect(model.humanSeat).toBe(1);
    expect(model.humanRole).toBe(Role.VILLAGER);
    expect(model.seatLine).toBe('Seat 1 · Villager');

    expect(model.suspicionAvailable).toBe(true);
    expect(model.finalRound).toBe(3);
    expect(model.averageSuspicion).toBeCloseTo(0.6);
    expect(model.averageSuspicionPercent).toBe('60%');
    expect(model.humanRank).toBe(2);
    expect(model.rankedPlayerCount).toBe(9);
    expect(model.rankText).toBe('#2 of 9');
    expect(model.mostSuspiciousSeat).toBe(2);
    expect(model.mostSuspiciousScore).toBeCloseTo(0.6);
    expect(model.mostSuspiciousPercent).toBe('60%');
    expect(model.mostSuspiciousText).toBe('Seat 2 · 60%');
    expect(model.stats.map(stat => stat.key)).toEqual(['average', 'rank', 'most-suspicious']);
    expect(model.stats[0].value).toBe('60%');
    expect(model.stats[1].value).toBe('#2 of 9');
    expect(model.stats[2].value).toBe('Seat 2 · 60%');

    expect(model.quotes).toHaveLength(SHARE_CARD_MAX_QUOTES);
    expect(model.quotes[0]).toMatchObject({
      kind: 'vote',
      round: 1,
      speakerId: 4,
      targetId: 1,
      label: 'Day 1 · Seat 4 voted for you',
      text: 'Seat 4 says the human seat dodged every question.',
      truncated: false,
    });
    expect(model.quotes[1].kind).toBe('vote');
    expect(model.quotes[1].speakerId).toBe(2);
    expect(model.quotes[1].truncated).toBe(true);
    expect(model.quotes[2]).toMatchObject({
      kind: 'wolf-chat',
      round: 1,
      speakerId: 7,
      label: 'Night 1 · Seat 7 wolf chat',
    });
    // Human votes, votes against other seats and empty reasons are excluded.
    expect(model.quotes.some(quote => quote.speakerId === 1)).toBe(false);
    expect(model.quotes.some(quote => quote.speakerId === 5)).toBe(false);
  });

  it('uses the 12-player board for rank totals and the board label', () => {
    const model = buildShareCardModel(makeReplay(12));

    expect(model.boardLabel).toBe('12-Player Standard');
    expect(model.metaLine).toBe('12-Player Standard · 3 rounds · Village Wins');
    expect(model.rankedPlayerCount).toBe(12);
    expect(model.rankText).toBe('#2 of 12');
    expect(model.stats[1].detail).toBe('Among 12 living seats');
    expect(model.quotes).toHaveLength(SHARE_CARD_MAX_QUOTES);
  });

  it('shows "final suspicion unavailable" when belief snapshots are missing', () => {
    const model = buildShareCardModel(makeReplay(9, { beliefSnapshots: [] }));

    expect(model.suspicionAvailable).toBe(false);
    expect(model.suspicionUnavailableText).toBe(SHARE_CARD_SUSPICION_UNAVAILABLE);
    expect(model.averageSuspicion).toBeNull();
    expect(model.averageSuspicionPercent).toBeNull();
    expect(model.humanRank).toBeNull();
    expect(model.mostSuspiciousSeat).toBeNull();
    expect(model.mostSuspiciousText).toBe('—');
    expect(model.stats).toEqual([]);
    expect(model.finalRound).toBeNull();
    // The rest of the card still renders from the replay.
    expect(model.quotes).toHaveLength(SHARE_CARD_MAX_QUOTES);
    expect(model.seatLine).toBe('Seat 1 · Villager');
  });

  it('degrades to unavailable when snapshots never score the human seat', () => {
    const snapshots = beliefSnapshotsFor(9, [1]).map(snapshot => ({
      ...snapshot,
      scores: snapshot.scores.map(score => (
        score.targetId === 1 ? { ...score, targetId: 3 } : score
      )),
    }));
    const model = buildShareCardModel(makeReplay(9, { beliefSnapshots: snapshots }));

    expect(model.suspicionAvailable).toBe(false);
    expect(model.humanRank).toBeNull();
    expect(model.averageSuspicionPercent).toBeNull();
    expect(model.suspicionUnavailableText).toBe('final suspicion unavailable');
  });

  it('truncates an overlong quote with an ellipsis and never exceeds the cap', () => {
    const replay = makeReplay(9, { beliefSnapshots: [] });
    const model = buildShareCardModel(replay);
    const overlong = model.quotes.find(quote => quote.speakerId === 2);

    expect(overlong).toBeTruthy();
    expect(overlong?.truncated).toBe(true);
    expect(overlong?.text.endsWith('…')).toBe(true);
    expect(Array.from(overlong?.text ?? '').length).toBeLessThanOrEqual(
      SHARE_CARD_QUOTE_MAX_CHARS + 1,
    );
    expect(overlong?.text).not.toContain(LONG_REASON);
    expect(model.quotes.length).toBeLessThanOrEqual(SHARE_CARD_MAX_QUOTES);
  });

  it('is deterministic and does not invent suspicion values on a partial replay', () => {
    const replay = makeReplay(9);
    expect(buildShareCardModel(replay)).toEqual(buildShareCardModel(replay));

    const noPlayers = buildShareCardModel(makeReplay(9, { players: [] }));
    expect(noPlayers.humanSeat).toBe(1);
    expect(noPlayers.humanRole).toBeNull();
    expect(noPlayers.seatLine).toBe('Seat 1');
  });
});

describe('truncateShareCardQuote', () => {
  it('normalizes whitespace and caps by code point', () => {
    expect(truncateShareCardQuote('  a\n\n b  ')).toEqual({ text: 'a b', truncated: false });

    const emoji = '🐺'.repeat(10);
    const capped = truncateShareCardQuote(emoji, 4);
    expect(capped.truncated).toBe(true);
    expect(capped.text).toBe('🐺🐺🐺🐺…');
    expect(Array.from(capped.text)).toHaveLength(5);
  });
});

/* ─── Canvas drawing ───────────────────────────────────────────────────── */

describe('drawShareCard', () => {
  it('draws the fixed 1080x1350 card and its key text with a minimal 2D stub', () => {
    const model = buildShareCardModel(makeReplay(9));
    const { canvas, calls, fillTexts } = makeCanvasStub();

    expect(() => drawShareCard(model, canvas)).not.toThrow();
    expect(canvas.width).toBe(SHARE_CARD_WIDTH);
    expect(canvas.height).toBe(SHARE_CARD_HEIGHT);

    expect(calls.some(call => call.method === 'fillRect')).toBe(true);
    expect(calls.some(call => call.method === 'arc')).toBe(true);
    expect(calls.some(call => call.method === 'measureText')).toBe(true);
    expect(fillTexts).toContain(model.title);
    expect(fillTexts).toContain(model.subtitle);
    expect(fillTexts).toContain(model.seatLine);
    expect(fillTexts).toContain('60%');
    expect(fillTexts).toContain('#2 of 9');
    expect(fillTexts.some(text => text.includes('Seat 2'))).toBe(true);
    expect(fillTexts.join(' ')).toContain('Why they suspected you');
    expect(fillTexts.join(' ')).toContain('Seat 4 says the human seat dodged');
  });

  it('draws the exact unavailable line when suspicion data is missing', () => {
    const model = buildShareCardModel(makeReplay(9, { beliefSnapshots: [] }));
    const { canvas, fillTexts } = makeCanvasStub();

    drawShareCard(model, canvas);

    expect(fillTexts).toContain(SHARE_CARD_SUSPICION_UNAVAILABLE);
    expect(fillTexts).not.toContain('60%');
  });

  it('throws only when the 2D context is unavailable (export catches it)', () => {
    const model = buildShareCardModel(makeReplay(9));
    const { canvas } = makeCanvasStub({ contextMissing: true });

    expect(() => drawShareCard(model, canvas)).toThrow(/2D context/);
  });
});

/* ─── PNG export ───────────────────────────────────────────────────────── */

describe('exportShareCardPng', () => {
  it('encodes image/png, creates a blob URL and triggers the download', async () => {
    const model = buildShareCardModel(makeReplay(9));
    const { environment, createObjectURL, revokeObjectURL, triggerDownload, canvas } =
      makeExportEnvironment();

    const result = await exportShareCardPng(model, environment);

    expect(result).toEqual({
      ok: true,
      fileName: 'ai-view-of-you-share-card-fixture-9.png',
      mimeType: 'image/png',
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
    });
    expect(canvas.width).toBe(SHARE_CARD_WIDTH);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(triggerDownload).toHaveBeenCalledWith(
      'blob:share-card-test',
      'ai-view-of-you-share-card-fixture-9.png',
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:share-card-test');
  });

  it('returns a failure result instead of throwing for every unsupported path', async () => {
    const model = buildShareCardModel(makeReplay(9));

    const noEnvironment = await exportShareCardPng(model, null);
    expect(noEnvironment).toMatchObject({ ok: false, reason: 'environment-unavailable' });

    const noCanvas = await exportShareCardPng(
      model,
      makeExportEnvironment({ createCanvas: () => null }).environment,
    );
    expect(noCanvas).toMatchObject({ ok: false, reason: 'canvas-unavailable' });

    const noContext = await exportShareCardPng(
      model,
      makeExportEnvironment({
        createCanvas: () => makeCanvasStub({ contextMissing: true }).canvas,
      }).environment,
    );
    expect(noContext).toMatchObject({ ok: false, reason: 'draw-failed' });

    const noToBlob = await exportShareCardPng(
      model,
      makeExportEnvironment({
        createCanvas: () => makeCanvasStub({ toBlob: false }).canvas,
      }).environment,
    );
    expect(noToBlob).toMatchObject({ ok: false, reason: 'to-blob-unavailable' });

    const emptyBlob = await exportShareCardPng(
      model,
      makeExportEnvironment({
        createCanvas: () => makeCanvasStub({ blob: null }).canvas,
      }).environment,
    );
    expect(emptyBlob).toMatchObject({ ok: false, reason: 'blob-empty' });

    const throwingToBlob = await exportShareCardPng(
      model,
      makeExportEnvironment({
        createCanvas: () => makeCanvasStub({ toBlobThrows: true }).canvas,
      }).environment,
    );
    expect(throwingToBlob).toMatchObject({ ok: false, reason: 'download-failed' });

    const createObjectURL = vi.fn((_blob: Blob) => {
      throw new Error('object URL blocked');
    });
    const noObjectUrl = await exportShareCardPng(
      model,
      makeExportEnvironment({ createObjectURL }).environment,
    );
    expect(noObjectUrl).toMatchObject({ ok: false, reason: 'object-url-unavailable' });
  });

  it('reports an unavailable browser environment outside the DOM', async () => {
    expect(createBrowserShareCardEnvironment()).toBeNull();
    expect(isShareCardExportSupported()).toBe(false);

    const model: ShareCardModel = buildShareCardModel(makeReplay(9));
    await expect(exportShareCardPng(model)).resolves.toMatchObject({
      ok: false,
      reason: 'environment-unavailable',
    });
  });
});
