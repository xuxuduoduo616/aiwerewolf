/**
 * Layer 1 — Per-Seat Visible Event Memory Store
 *
 * Pure TypeScript, zero network / LLM calls.
 * Enforces:
 *  - Strict per-seat visibility gating ('public' | 'seat-private' | 'wolf-team')
 *  - Strict eventId idempotency (replaying the same eventId is a guaranteed no-op)
 *  - Wolf teammate knowledge isolation under public bussing (knownTeammateIds locked <= 0.05)
 *  - Seer private hard-fact protection (confirmed checks never overwritten by speech)
 *  - Per-round duplicate claim suppression per (speaker, target, direction)
 *  - Clean cross-game reset
 */

import { GamePhase, Role, type Player } from '../types';
import type { ParsedRoleClaim, SpeechClaim, SpeechClaimPolarity } from './speechEvidenceParser';

export type { ParsedRoleClaim, SpeechClaim, SpeechClaimPolarity };

export type EventVisibility = 'public' | 'seat-private' | 'wolf-team';

export type VisibleEventKind =
  | 'speech'
  | 'vote'
  | 'death'
  | 'flip'
  | 'seer-check'
  | 'witch-info'
  | 'wolf-plan';

export interface SpeechEventPayload {
  text: string;
  claims: SpeechClaim[];
  roleClaims: ParsedRoleClaim[];
}

export interface VoteEventPayload {
  voterId: number;
  targetId: number | null;
}

export interface DeathEventPayload {
  deadId: number;
  role: Role;
  cause?: 'VOTE' | 'NIGHT' | 'HUNTER' | 'POISON';
}

export interface FlipEventPayload {
  targetId: number;
  role: Role;
}

export interface SeerCheckEventPayload {
  seerId: number;
  targetId: number;
  isGood: boolean;
}

export interface WitchInfoEventPayload {
  wolfKillId: number | null;
  saved?: boolean;
  poisonTargetId?: number | null;
}

export interface WolfPlanEventPayload {
  message: string;
  targetId?: number | null;
}

export type VisibleEventPayload =
  | SpeechEventPayload
  | VoteEventPayload
  | DeathEventPayload
  | FlipEventPayload
  | SeerCheckEventPayload
  | WitchInfoEventPayload
  | WolfPlanEventPayload;

export interface VisibleEvent<P extends VisibleEventPayload = VisibleEventPayload> {
  eventId: string;
  seq: number;
  round: number;
  phase: GamePhase;
  visibility: EventVisibility;
  visibleToSeatIds?: readonly number[];
  kind: VisibleEventKind;
  actorId: number | null;
  payload: P;
}

export interface PublicRoleClaim {
  seatId: number;
  claimedRole: Role;
  round: number;
  eventId: string;
  confidence: number;
  contested: boolean;
}

export interface MemoryReason {
  eventId: string;
  round: number;
  actorId: number | null;
  targetId: number;
  delta: number;
  tag: string;
  polarity?: SpeechClaimPolarity;
}

export interface SeatMemory {
  seatId: number;
  role: Role;
  isHuman: boolean;
  isAlive: boolean;
  /** Locked at match init for werewolves; never mutated by public speech or bussing. */
  knownTeammateIds: Set<number>;
  /** Internal suspicion per target seat [0.0, 1.0]. Wolf teammates stay locked at 0.05. */
  suspicion: Map<number, number>;
  /** Perceived speaker credibility [0.0, 1.0]. Default 0.60, bounded [0.2, 1.0] (0.0 for confirmed enemies). */
  credibility: Map<number, number>;
  /** Seer private verified checks: targetId -> isGood. */
  seerChecks: Map<number, boolean>;
  /** Observed public role claims keyed by claiming seat ID. */
  publicRoleClaims: Map<number, PublicRoleClaim>;
  /** Publicly expressed stance by this seat (kept strictly separate from internal teammate knowledge). */
  publicStance: Map<number, SpeechClaimPolarity>;
  /** Recent explainable belief-update reasons. */
  recentReasons: MemoryReason[];
  /** Applied event IDs for strict idempotency. */
  seenEventIds: Set<string>;
  /** Per-round claim dedupe keys (`${round}:${speakerId}:${targetId}:${direction}`). */
  appliedRoundClaims: Set<string>;
  /** Ordered log of events visible to this seat. */
  visibleEvents: VisibleEvent[];
}

export const DEFAULT_SUSPICION = 0.5;
export const WOLF_TEAMMATE_SUSPICION = 0.05;
export const DEFAULT_CREDIBILITY = 0.6;
export const MIN_CREDIBILITY = 0.2;
export const MAX_CREDIBILITY = 1.0;

const MAX_REASONS_PER_SEAT = 64;

const clamp01 = (value: number): number => Math.max(0.0, Math.min(1.0, value));

const claimDirection = (polarity: SpeechClaimPolarity): 'hostile' | 'supportive' =>
  polarity === 'accuse' || polarity === 'check-wolf' ? 'hostile' : 'supportive';

/**
 * Strict visibility gate determining whether a seat is permitted to read an event.
 *  - 'public'       -> all seats
 *  - 'wolf-team'    -> only Werewolf seats
 *  - 'seat-private' -> only seats explicitly listed in event.visibleToSeatIds
 */
export const canSeatRead = (
  seat: Pick<SeatMemory, 'seatId' | 'role'>,
  event: Pick<VisibleEvent, 'visibility' | 'visibleToSeatIds'>,
): boolean => {
  if (event.visibility === 'public') return true;
  if (event.visibility === 'wolf-team') return seat.role === Role.WEREWOLF;
  if (event.visibility === 'seat-private') {
    return Boolean(event.visibleToSeatIds?.includes(seat.seatId));
  }
  return false;
};

/**
 * Deterministic canonical event ID for public speeches so duplicate commits of
 * the same speech in the same round are strictly idempotent.
 */
export const buildSpeechEventId = (round: number, speakerId: number, text: string): string => {
  const normalized = text.trim().replace(/\s+/g, ' ');
  // Deterministic FNV-1a 32-bit hash (fast, zero deps, pure TS)
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `speech:r${round}:s${speakerId}:${hex}:${normalized.length}`;
};

const baseSpeechDelta = (polarity: SpeechClaimPolarity): number => {
  switch (polarity) {
    case 'accuse':
      return 0.12;
    case 'defend':
      return -0.09;
    case 'check-wolf':
      return 0.22;
    case 'check-good':
      return -0.18;
  }
};

export class PlayerMemoryStore {
  private seats: Map<number, SeatMemory> = new Map();
  private seqCounter = 0;
  private currentRound = 1;

  reset(): void {
    this.seats.clear();
    this.seqCounter = 0;
    this.currentRound = 1;
  }

  init(players: readonly Player[]): void {
    this.reset();
    const wolfIds = players
      .filter(player => player.role === Role.WEREWOLF)
      .map(player => player.id);

    for (const actor of players) {
      const suspicion = new Map<number, number>();
      const credibility = new Map<number, number>();
      const knownTeammateIds = new Set<number>();

      if (actor.role === Role.WEREWOLF) {
        for (const wolfId of wolfIds) {
          if (wolfId !== actor.id) knownTeammateIds.add(wolfId);
        }
      }

      for (const target of players) {
        if (target.id === actor.id) continue;
        suspicion.set(
          target.id,
          knownTeammateIds.has(target.id) ? WOLF_TEAMMATE_SUSPICION : DEFAULT_SUSPICION,
        );
        credibility.set(target.id, DEFAULT_CREDIBILITY);
      }

      this.seats.set(actor.id, {
        seatId: actor.id,
        role: actor.role,
        isHuman: actor.isHuman,
        isAlive: actor.isAlive,
        knownTeammateIds,
        suspicion,
        credibility,
        seerChecks: new Map<number, boolean>(),
        publicRoleClaims: new Map<number, PublicRoleClaim>(),
        publicStance: new Map<number, SpeechClaimPolarity>(),
        recentReasons: [],
        seenEventIds: new Set<string>(),
        appliedRoundClaims: new Set<string>(),
        visibleEvents: [],
      });
    }
  }

  setCurrentRound(round: number): void {
    if (Number.isInteger(round) && round >= 1) {
      this.currentRound = round;
    }
  }

  getCurrentRound(): number {
    return this.currentRound;
  }

  nextSeq(): number {
    this.seqCounter += 1;
    return this.seqCounter;
  }

  getSeatMemory(seatId: number): SeatMemory | undefined {
    return this.seats.get(seatId);
  }

  /** Lazily ensure a seat entry exists when private facts are recorded prior to init(). */
  ensureSeat(seatId: number, role: Role): SeatMemory {
    let seat = this.seats.get(seatId);
    if (!seat) {
      seat = {
        seatId,
        role,
        isHuman: false,
        isAlive: true,
        knownTeammateIds: new Set<number>(),
        suspicion: new Map<number, number>(),
        credibility: new Map<number, number>(),
        seerChecks: new Map<number, boolean>(),
        publicRoleClaims: new Map<number, PublicRoleClaim>(),
        publicStance: new Map<number, SpeechClaimPolarity>(),
        recentReasons: [],
        seenEventIds: new Set<string>(),
        appliedRoundClaims: new Set<string>(),
        visibleEvents: [],
      };
      this.seats.set(seatId, seat);
    }
    return seat;
  }

  getAllSeatIds(): number[] {
    return [...this.seats.keys()];
  }

  /**
   * Read an event from the perspective of a specific seat. Returns `null` if
   * the seat does not exist or lacks visibility permission.
   */
  readEventForSeat(seatId: number, event: VisibleEvent): VisibleEvent | null {
    const seat = this.seats.get(seatId);
    if (!seat || !canSeatRead(seat, event)) return null;
    return event;
  }

  getVisibleEventsForSeat(seatId: number): readonly VisibleEvent[] {
    return this.seats.get(seatId)?.visibleEvents ?? [];
  }

  getRecentReasons(seatId: number, targetId?: number): readonly MemoryReason[] {
    const seat = this.seats.get(seatId);
    if (!seat) return [];
    if (targetId === undefined) return [...seat.recentReasons];
    return seat.recentReasons.filter(reason => reason.targetId === targetId);
  }

  getPublicRoleClaims(seatId: number): readonly PublicRoleClaim[] {
    const seat = this.seats.get(seatId);
    if (!seat) return [];
    return [...seat.publicRoleClaims.values()];
  }

  /**
   * Ingest one VisibleEvent into every seat that passes `canSeatRead` and has
   * not already processed `event.eventId`. Returns `true` if at least one seat
   * newly applied the event, or `false` if it was a duplicate/no-op everywhere.
   */
  ingestEvent(event: VisibleEvent, players?: readonly Player[]): boolean {
    if (players) {
      for (const player of players) {
        const seat = this.seats.get(player.id);
        if (seat) seat.isAlive = player.isAlive;
      }
    }

    let appliedCount = 0;
    for (const seat of this.seats.values()) {
      if (!canSeatRead(seat, event)) continue;
      if (seat.seenEventIds.has(event.eventId)) continue;

      seat.seenEventIds.add(event.eventId);
      seat.visibleEvents.push(event);
      this.applyEventToSeat(seat, event);
      appliedCount += 1;
    }

    return appliedCount > 0;
  }

  private pushReason(seat: SeatMemory, reason: MemoryReason): void {
    seat.recentReasons.push(reason);
    if (seat.recentReasons.length > MAX_REASONS_PER_SEAT) {
      seat.recentReasons.splice(0, seat.recentReasons.length - MAX_REASONS_PER_SEAT);
    }
  }

  private isLockedWolfTeammate(seat: SeatMemory, targetId: number): boolean {
    return seat.role === Role.WEREWOLF && seat.knownTeammateIds.has(targetId);
  }

  private isLockedSeerFact(seat: SeatMemory, targetId: number): boolean {
    return seat.role === Role.SEER && seat.seerChecks.has(targetId);
  }

  private applyEventToSeat(seat: SeatMemory, event: VisibleEvent): void {
    switch (event.kind) {
      case 'speech':
        this.applySpeechToSeat(seat, event as VisibleEvent<SpeechEventPayload>);
        return;
      case 'vote':
        this.applyVoteToSeat(seat, event as VisibleEvent<VoteEventPayload>);
        return;
      case 'death':
      case 'flip':
        this.applyDeathOrFlipToSeat(seat, event as VisibleEvent<DeathEventPayload | FlipEventPayload>);
        return;
      case 'seer-check':
        this.applySeerCheckToSeat(seat, event as VisibleEvent<SeerCheckEventPayload>);
        return;
      case 'witch-info':
        this.applyWitchInfoToSeat(seat, event as VisibleEvent<WitchInfoEventPayload>);
        return;
      case 'wolf-plan':
        // Private wolf-team strategy note: stored in visibleEvents only,
        // never perturbs internal teammate lock.
        return;
    }
  }

  private applySpeechToSeat(seat: SeatMemory, event: VisibleEvent<SpeechEventPayload>): void {
    const speakerId = event.actorId;
    if (speakerId === null) return;
    const { claims, roleClaims } = event.payload;

    // 1. Track public role claims and detect contested Seer counter-claims
    for (const rc of roleClaims) {
      seat.publicRoleClaims.set(rc.speakerId, {
        seatId: rc.speakerId,
        claimedRole: rc.claimedRole,
        round: event.round,
        eventId: event.eventId,
        confidence: rc.confidence,
        contested: false,
      });

      if (rc.claimedRole === Role.SEER) {
        const seerClaimers = [...seat.publicRoleClaims.values()].filter(
          claim => claim.claimedRole === Role.SEER,
        );
        if (seerClaimers.length > 1) {
          for (const claimer of seerClaimers) {
            claimer.contested = true;
          }
        }
        // True Seer knows any other seat claiming Seer is an impostor
        if (seat.role === Role.SEER && rc.speakerId !== seat.seatId) {
          seat.credibility.set(rc.speakerId, 0.0);
          const existing = seat.publicRoleClaims.get(rc.speakerId);
          if (existing) existing.contested = true;
          if (seat.isAlive && !this.isLockedSeerFact(seat, rc.speakerId)) {
            const prevSus = seat.suspicion.get(rc.speakerId) ?? DEFAULT_SUSPICION;
            const nextSus = Math.max(prevSus, 0.95);
            if (nextSus > prevSus + 1e-9) {
              seat.suspicion.set(rc.speakerId, nextSus);
              this.pushReason(seat, {
                eventId: event.eventId,
                round: event.round,
                actorId: rc.speakerId,
                targetId: rc.speakerId,
                delta: nextSus - prevSus,
                tag: 'counter-seer-claim',
                polarity: 'accuse',
              });
            }
          }
        }
      }
    }

    const isSpeaker = seat.seatId === speakerId;
    // Dead listeners still record visibleEvents/publicRoleClaims above, but do
    // not need active belief drift unless they are alive (or speaker itself).
    if (!isSpeaker && !seat.isAlive) return;

    const speakerRoleClaim = seat.publicRoleClaims.get(speakerId);
    const isContestedSeer =
      speakerRoleClaim?.claimedRole === Role.SEER && speakerRoleClaim.contested;
    const speakerCredibility = isSpeaker
      ? 1.0
      : (seat.credibility.get(speakerId) ?? DEFAULT_CREDIBILITY);

    // 2. Apply each parsed claim with strict protection invariants
    for (const claim of claims) {
      if (claim.confidence <= 0) continue;
      if (claim.targetId === speakerId) continue;

      // Record speaker's public stance regardless of internal wolf knowledge
      if (isSpeaker) {
        seat.publicStance.set(claim.targetId, claim.polarity);
      }

      // Never write self-suspicion
      if (claim.targetId === seat.seatId) continue;

      // Wolf bussing / teammate protection: internal suspicion on known
      // teammates is locked at <= 0.05 for both speaker and wolf listeners.
      if (this.isLockedWolfTeammate(seat, claim.targetId)) {
        seat.suspicion.set(claim.targetId, WOLF_TEAMMATE_SUSPICION);
        continue;
      }

      // Seer private hard facts (0.0 / 1.0) are never overwritten by public speech.
      if (this.isLockedSeerFact(seat, claim.targetId)) continue;

      // Per-round duplicate claim suppression: same speaker repeating the same
      // directional claim on the same target in the same round does not stack.
      const dedupeKey = `${event.round}:${speakerId}:${claim.targetId}:${claimDirection(claim.polarity)}`;
      if (seat.appliedRoundClaims.has(dedupeKey)) continue;
      seat.appliedRoundClaims.add(dedupeKey);

      const base = baseSpeechDelta(claim.polarity);
      const contestedFactor =
        !isSpeaker && isContestedSeer && (claim.polarity === 'check-wolf' || claim.polarity === 'check-good')
          ? 0.6
          : 1.0;
      const delta = base * speakerCredibility * claim.confidence * contestedFactor;
      if (delta === 0) continue;

      const current = seat.suspicion.get(claim.targetId) ?? DEFAULT_SUSPICION;
      seat.suspicion.set(claim.targetId, clamp01(current + delta));
      this.pushReason(seat, {
        eventId: event.eventId,
        round: event.round,
        actorId: speakerId,
        targetId: claim.targetId,
        delta,
        tag: claim.tag,
        polarity: claim.polarity,
      });
    }
  }

  private applyVoteToSeat(seat: SeatMemory, event: VisibleEvent<VoteEventPayload>): void {
    const { voterId, targetId } = event.payload;
    if (targetId === null || targetId === seat.seatId) return;
    if (seat.seatId !== voterId) return;
    if (this.isLockedWolfTeammate(seat, targetId)) {
      seat.suspicion.set(targetId, WOLF_TEAMMATE_SUSPICION);
      return;
    }
    if (this.isLockedSeerFact(seat, targetId)) return;

    const current = seat.suspicion.get(targetId) ?? DEFAULT_SUSPICION;
    const delta = 0.15;
    seat.suspicion.set(targetId, clamp01(current + delta));
    this.pushReason(seat, {
      eventId: event.eventId,
      round: event.round,
      actorId: voterId,
      targetId,
      delta,
      tag: 'vote-cast',
    });
  }

  private applyDeathOrFlipToSeat(
    seat: SeatMemory,
    event: VisibleEvent<DeathEventPayload | FlipEventPayload>,
  ): void {
    const targetId = 'deadId' in event.payload ? event.payload.deadId : event.payload.targetId;
    if (seat.seatId === targetId) {
      if (event.kind === 'death') seat.isAlive = false;
      return;
    }

    if (event.kind === 'death') {
      seat.suspicion.set(targetId, 0.0);
    }

    // Confirmed enemy role flips drop credibility to 0.0; confirmed good flips boost within [0.2, 1.0]
    if (event.payload.role === Role.WEREWOLF) {
      seat.credibility.set(targetId, 0.0);
    } else {
      const prev = seat.credibility.get(targetId) ?? DEFAULT_CREDIBILITY;
      seat.credibility.set(targetId, Math.max(MIN_CREDIBILITY, Math.min(MAX_CREDIBILITY, prev + 0.15)));
    }
  }

  private applySeerCheckToSeat(seat: SeatMemory, event: VisibleEvent<SeerCheckEventPayload>): void {
    const { seerId, targetId, isGood } = event.payload;
    if (seat.seatId !== seerId) return;

    seat.seerChecks.set(targetId, isGood);
    const nextScore = isGood ? 0.0 : 1.0;
    const prevScore = seat.suspicion.get(targetId) ?? DEFAULT_SUSPICION;
    seat.suspicion.set(targetId, nextScore);

    if (!isGood) {
      seat.credibility.set(targetId, 0.0);
    } else {
      const prevCred = seat.credibility.get(targetId) ?? DEFAULT_CREDIBILITY;
      seat.credibility.set(targetId, Math.max(MIN_CREDIBILITY, Math.min(MAX_CREDIBILITY, prevCred + 0.25)));
    }

    this.pushReason(seat, {
      eventId: event.eventId,
      round: event.round,
      actorId: seerId,
      targetId,
      delta: nextScore - prevScore,
      tag: isGood ? 'seer-check-good' : 'seer-check-wolf',
      polarity: isGood ? 'check-good' : 'check-wolf',
    });
  }

  private applyWitchInfoToSeat(seat: SeatMemory, event: VisibleEvent<WitchInfoEventPayload>): void {
    const { wolfKillId, saved } = event.payload;
    if (saved && wolfKillId !== null && wolfKillId !== seat.seatId) {
      if (this.isLockedWolfTeammate(seat, wolfKillId)) return;
      const current = seat.suspicion.get(wolfKillId) ?? DEFAULT_SUSPICION;
      const delta = -0.2;
      seat.suspicion.set(wolfKillId, clamp01(current + delta));
      this.pushReason(seat, {
        eventId: event.eventId,
        round: event.round,
        actorId: seat.seatId,
        targetId: wolfKillId,
        delta,
        tag: 'witch-silver-water',
        polarity: 'defend',
      });
    }
  }
}

export { PlayerMemoryStore as MatchMemory };
