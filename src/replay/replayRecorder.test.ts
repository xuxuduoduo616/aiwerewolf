import { describe, expect, it } from 'vitest';
import { GamePhase, Role } from '../types';
import {
  REPLAY_SCHEMA_VERSION,
  buildReplay,
  canonicalizeReplay,
  createReplayRecorder,
  type ReplayDraft,
  type ReplayPlayerSeat,
} from './index';

const players: ReplayPlayerSeat[] = [
  { seat: 1, role: Role.VILLAGER, isHuman: true },
  { seat: 2, role: Role.WEREWOLF, isHuman: false },
  { seat: 3, role: Role.SEER, isHuman: false },
  { seat: 4, role: Role.WITCH, isHuman: false },
];

const draft = (overrides: Partial<ReplayDraft> = {}): ReplayDraft => ({
  gameId: 'fixture-game',
  createdAt: '2026-01-02T03:04:05.000Z',
  boardId: '9-standard',
  difficulty: 'normal',
  language: 'en',
  isGuest: true,
  players,
  phases: [],
  speeches: [],
  votes: [],
  beliefSnapshots: [],
  wolfChat: [],
  checks: [],
  outcome: { winner: 'VILLAGERS', rounds: 1 },
  ...overrides,
});

describe('buildReplay', () => {
  it('writes the versioned schema with a fixed top-level key order', () => {
    const record = buildReplay(draft());
    expect(record.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(Object.keys(record)).toEqual([
      'schemaVersion',
      'gameId',
      'createdAt',
      'boardId',
      'difficulty',
      'language',
      'isGuest',
      'players',
      'phases',
      'speeches',
      'votes',
      'beliefSnapshots',
      'wolfChat',
      'checks',
      'outcome',
    ]);
    expect(record.players).toEqual(players);
    expect(record.players[0]).not.toHaveProperty('name');
    expect(JSON.stringify(record)).not.toContain('undefined');
  });

  it('sorts seats, drops malformed entries and leaves no undefined vote reason', () => {
    const record = buildReplay(draft({
      players: [
        { seat: 3, role: Role.SEER, isHuman: false },
        { seat: 0, role: Role.VILLAGER, isHuman: true } as ReplayPlayerSeat,
        { seat: 2, role: 'NotARole' as Role, isHuman: false },
        { seat: 1, role: Role.VILLAGER, isHuman: true },
      ],
      votes: [
        { round: 1, voterId: 1, targetId: 2 },
        { round: 1, voterId: 2, targetId: 1, reason: 'Player 1 is pushing too hard.' },
      ],
    }));
    expect(record.players.map(player => player.seat)).toEqual([1, 3]);
    expect(record.votes[0]).toEqual({ round: 1, voterId: 1, targetId: 2 });
    expect('reason' in record.votes[0]).toBe(false);
    expect(record.votes[1].reason).toBe('Player 1 is pushing too hard.');
  });

  it('clamps belief scores to [0,1] and sorts them by score desc then seat', () => {
    const record = buildReplay(draft({
      beliefSnapshots: [{
        round: 1,
        actorId: 2,
        scores: [
          { targetId: 4, score: 1.7 },
          { targetId: 1, score: -0.4 },
          { targetId: 3, score: 0.5 },
          { targetId: 3, score: 0.9 },
        ],
      }],
    }));
    expect(record.beliefSnapshots).toEqual([{
      round: 1,
      actorId: 2,
      scores: [
        { targetId: 4, score: 1 },
        { targetId: 3, score: 0.5 },
        { targetId: 1, score: 0 },
      ],
    }]);
  });

  it('normalizes zero event rounds to one while phases may keep round zero', () => {
    const record = buildReplay(draft({
      phases: [{ phase: GamePhase.NIGHT_START, round: 0 }],
      speeches: [{ round: 0, phase: GamePhase.DAY_DISCUSSION, speakerId: 2, text: 'Hello.' }],
      outcome: { winner: 'WEREWOLVES', rounds: 0 },
    }));
    expect(record.phases).toEqual([{ phase: GamePhase.NIGHT_START, round: 0 }]);
    expect(record.speeches[0].round).toBe(1);
    expect(record.outcome.rounds).toBe(1);
  });

  it('canonicalization strips foreign fields such as a player name', () => {
    const withName = draft({
      players: [{ seat: 1, role: Role.VILLAGER, isHuman: true, name: 'Alice' } as ReplayPlayerSeat],
    });
    const record = buildReplay(withName);
    expect(record.players).toEqual([{ seat: 1, role: Role.VILLAGER, isHuman: true }]);
    expect(JSON.stringify(canonicalizeReplay(record))).not.toContain('Alice');
  });
});

describe('createReplayRecorder', () => {
  const recorderInput = {
    gameId: 'fixture-recorder',
    createdAt: '2026-01-02T03:04:05.000Z',
    boardId: '9-standard' as const,
    difficulty: 'easy' as const,
    language: 'en' as const,
    isGuest: true,
    players,
  };

  it('collects phases, speeches, votes, checks, wolf chat and belief snapshots', () => {
    const recorder = createReplayRecorder(recorderInput);
    recorder.recordPhase(GamePhase.NIGHT_START, 0);
    recorder.recordPhase(GamePhase.NIGHT_START, 0);
    recorder.recordPhase(GamePhase.NIGHT_WEREWOLVES, 1);
    recorder.recordSpeech({ round: 1, phase: GamePhase.DAY_DISCUSSION, speakerId: 1, text: 'I am with the village.' });
    recorder.recordVote({ round: 1, voterId: 1, targetId: 2 });
    recorder.recordVote({ round: 1, voterId: 1, targetId: 3 });
    recorder.recordVote({ round: 1, voterId: 2, targetId: 1, reason: 'random fallback' });
    recorder.recordCheck({ round: 1, actorId: 3, targetId: 2, isGood: false });
    recorder.recordWolfChat({ round: 1, speakerId: 2, message: 'Push Player 1.' });
    recorder.recordBeliefSnapshots([
      { round: 1, actorId: 2, scores: [{ targetId: 1, score: 0.6 }] },
      { round: 1, actorId: 2, scores: [{ targetId: 1, score: 0.9 }] },
      { round: 1, actorId: 3, scores: [{ targetId: 1, score: 0.7 }, { targetId: 2, score: 0.3 }] },
    ]);

    expect(recorder.isFinalized()).toBe(false);
    const record = recorder.finalize({ winner: 'WEREWOLVES', rounds: 2 });
    expect(record).not.toBeNull();
    expect(record!.gameId).toBe('fixture-recorder');
    expect(record!.phases).toEqual([
      { phase: GamePhase.NIGHT_START, round: 0 },
      { phase: GamePhase.NIGHT_WEREWOLVES, round: 1 },
    ]);
    expect(record!.speeches).toHaveLength(1);
    expect(record!.votes).toEqual([
      { round: 1, voterId: 1, targetId: 2 },
      { round: 1, voterId: 2, targetId: 1, reason: 'random fallback' },
    ]);
    expect(record!.checks).toHaveLength(1);
    expect(record!.wolfChat).toHaveLength(1);
    expect(record!.beliefSnapshots).toEqual([
      { round: 1, actorId: 2, scores: [{ targetId: 1, score: 0.6 }] },
      { round: 1, actorId: 3, scores: [{ targetId: 1, score: 0.7 }, { targetId: 2, score: 0.3 }] },
    ]);
    expect(record!.outcome).toEqual({ winner: 'WEREWOLVES', rounds: 2 });
    expect(recorder.isFinalized()).toBe(true);
  });

  it('is one-shot and ignores recording after finalize', () => {
    const recorder = createReplayRecorder(recorderInput);
    recorder.recordPhase(GamePhase.NIGHT_START, 0);
    const first = recorder.finalize({ winner: 'VILLAGERS', rounds: 1 });
    expect(first).not.toBeNull();
    recorder.recordSpeech({ round: 1, phase: GamePhase.DAY_DISCUSSION, speakerId: 2, text: 'late' });
    expect(recorder.finalize({ winner: 'VILLAGERS', rounds: 1 })).toBeNull();
    expect(first!.speeches).toHaveLength(0);
  });

  it('requires a resolved winner', () => {
    const recorder = createReplayRecorder(recorderInput);
    expect(recorder.finalize({ winner: 'UNKNOWN' as 'VILLAGERS', rounds: 1 })).toBeNull();
    expect(recorder.isFinalized()).toBe(false);
  });
});
