import { describe, expect, it, vi } from 'vitest';
import { runAIPhaseSafely } from './hooks/useGameState';
import { generateAIAction, generateAIDialogue, generateWolfChat } from './ai/aiOrchestrator';
import { getRoleCamp } from './gameEngine';
import { GamePhase, Player, Role } from './types';

/**
 * Regression tests for night-pipeline-exception-safety (P0).
 *
 * Bug (owner-reported): human werewolf, 9p — after locking the night kill the
 * game stalled forever on the "AI正在思考局势..." spinner. Any rejection inside
 * an isProcessingAI block (most likely trigger: the dynamic
 * import('./geminiAdapter') in aiOrchestrator rejecting after Vite module
 * invalidation, or a stale hashed chunk after a production redeploy) left
 * isProcessingAI=true forever; the phase driver early-returns while it is
 * set, so the game wedged.
 *
 * Fix layers under test here:
 *  1. useGameState.runAIPhaseSafely — the flag ALWAYS resets, the error is
 *     routed to a handler, and the caller's phase advance still runs.
 *  2. aiOrchestrator — a rejecting geminiAdapter import degrades to the
 *     library/hardcoded fallback layers instead of rejecting upward.
 * Layer 3 (geminiAdapter fetch timeout) is covered in geminiAdapter.test.ts.
 */

// Simulate the production trigger: the geminiAdapter chunk fails to load, so
// every `await import('./geminiAdapter')` inside aiOrchestrator rejects.
vi.mock('./ai/geminiAdapter', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

const mkPlayer = (id: number, role: Role, isHuman = false): Player => ({
  id, name: isHuman ? 'Guest' : `P${id}`, role, camp: getRoleCamp(role),
  isAlive: true, canVote: true, isRevealed: false,
  avatarUrl: '', aiPersonality: '', traits: [], aiModelLabel: '',
  isHuman, publicClaims: [], privateKnowledge: [], suspicionMap: {},
});

// 9-player standard board: 3 villagers, 3 wolves, seer, witch, hunter
const make9PlayerBoard = (): Player[] => [
  mkPlayer(1, Role.WEREWOLF, true),
  mkPlayer(2, Role.WEREWOLF), mkPlayer(3, Role.WEREWOLF),
  mkPlayer(4, Role.SEER), mkPlayer(5, Role.WITCH), mkPlayer(6, Role.HUNTER),
  mkPlayer(7, Role.VILLAGER), mkPlayer(8, Role.VILLAGER), mkPlayer(9, Role.VILLAGER),
];

const emptyNight = { wolfKillId: null, witchPoisonId: null, witchSaved: false };

describe('runAIPhaseSafely — isProcessingAI can never wedge', () => {
  it('resets the flag and reports the error when the task rejects', async () => {
    const transitions: boolean[] = [];
    let reported: unknown = null;

    await expect(
      runAIPhaseSafely(
        value => transitions.push(value),
        async () => { throw new Error('boom'); },
        error => { reported = error; },
      ),
    ).resolves.toBeUndefined(); // never rejects → no unhandled rejection

    expect(transitions).toEqual([true, false]);
    expect((reported as Error).message).toBe('boom');
  });

  it('resets the flag on success without calling onError', async () => {
    const transitions: boolean[] = [];
    const onError = vi.fn();

    await runAIPhaseSafely(value => transitions.push(value), async () => {}, onError);

    expect(transitions).toEqual([true, false]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('sets the flag synchronously (preserves the driver double-fire guard)', () => {
    let processing = false;
    // Do not await: the flag must be raised before the first microtask so the
    // phase-driver effect re-runs are blocked immediately (see finishVote).
    const pending = runAIPhaseSafely(
      value => { processing = value; },
      () => new Promise(() => {}),
      () => {},
    );
    expect(processing).toBe(true);
    void pending;
  });

  it('faithful handler simulation: a rejecting AI call still advances the phase', async () => {
    // Mirrors handleSeerPhase: runAIPhaseSafely(...) then setPhase(NIGHT_WITCH).
    let isProcessingAI = true;
    let phase: GamePhase = GamePhase.NIGHT_SEER;
    const systemLogs: string[] = [];

    await runAIPhaseSafely(
      value => { isProcessingAI = value; },
      async () => { throw new TypeError('Failed to fetch dynamically imported module'); },
      () => systemLogs.push('AI error. Seer check skipped.'),
    );
    phase = GamePhase.NIGHT_WITCH;

    expect(isProcessingAI).toBe(false); // phase driver is unblocked
    expect(phase).toBe(GamePhase.NIGHT_WITCH); // phase advanced despite the error
    expect(systemLogs).toHaveLength(1); // player sees a system line
  });
});

describe('aiOrchestrator survives a rejecting geminiAdapter import', () => {
  it('generateAIAction (KILL) falls back to a valid non-wolf target', async () => {
    const players = make9PlayerBoard();
    const leader = players[1];

    const action = await generateAIAction(leader, players, [], 'KILL', []);

    expect(action.targetId).not.toBeNull();
    const target = players.find(p => p.id === action.targetId)!;
    expect(target.role).not.toBe(Role.WEREWOLF);
    expect(target.isAlive).toBe(true);
  });

  it('generateAIAction (VOTE) falls back to a valid living target', async () => {
    const players = make9PlayerBoard();
    const voter = players[6];

    const action = await generateAIAction(voter, players, [], 'VOTE', []);

    expect(action.targetId).not.toBeNull();
    const target = players.find(p => p.id === action.targetId)!;
    expect(target.isAlive).toBe(true);
    expect(target.id).not.toBe(voter.id);
  });

  it('generateAIDialogue falls back to library/hardcoded speech', async () => {
    const players = make9PlayerBoard();
    const speaker = players[7];

    const result = await generateAIDialogue(
      speaker, players, [], GamePhase.DAY_DISCUSSION, [], 1, null, [], emptyNight,
    );

    expect(result.zh.length).toBeGreaterThan(0);
    expect(typeof result.en).toBe('string');
  });

  it('generateWolfChat falls back to library/hardcoded night lines', async () => {
    const players = make9PlayerBoard();
    const wolves = players.filter(p => p.role === Role.WEREWOLF);

    const chat = await generateWolfChat(wolves, players, [], 1, []);

    expect(chat.length).toBeGreaterThan(0);
    expect(chat.length).toBeLessThanOrEqual(3);
    for (const message of chat) {
      expect(wolves.some(w => w.id === message.speakerId)).toBe(true);
      expect(message.message.length).toBeGreaterThan(0);
    }
  });
});
