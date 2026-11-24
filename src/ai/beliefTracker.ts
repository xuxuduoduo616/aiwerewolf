/**
 * Layer 1 — BeliefTracker
 * Maintains per-player suspicion scores (0.0–1.0) backed by per-seat
 * PlayerMemoryStore with visibility isolation, idempotent event ingestion,
 * clause-level bilingual speech evidence parsing, and wolf-bussing protection.
 * Runs in the browser, no LLM needed.
 */

import { GamePhase, Role, type Player } from '../types';
import {
  buildSpeechEventId,
  DEFAULT_CREDIBILITY,
  DEFAULT_SUSPICION,
  PlayerMemoryStore,
  WOLF_TEAMMATE_SUSPICION,
  type MemoryReason,
  type PublicRoleClaim,
  type SeatMemory,
  type SpeechEventPayload,
  type VisibleEvent,
  type VoteEventPayload,
  type WitchInfoEventPayload,
} from './playerMemory';
import { parseSpeechEvidence } from './speechEvidenceParser';

export interface SpeechUpdateOptions {
  round?: number;
  phase?: GamePhase;
  eventId?: string;
}

export interface VoteUpdateOptions {
  round?: number;
  eventId?: string;
  players?: readonly Player[];
}

export interface DeathUpdateOptions {
  round?: number;
  phase?: GamePhase;
  eventId?: string;
  cause?: 'VOTE' | 'NIGHT' | 'HUNTER' | 'POISON';
}

export interface FlipUpdateOptions {
  round?: number;
  phase?: GamePhase;
  eventId?: string;
}

export interface SeerCheckOptions {
  round?: number;
  eventId?: string;
}

export interface WitchInfoOptions {
  round?: number;
  eventId?: string;
}

const TIE_EPSILON = 1e-9;
const MAX_REASONS_PER_SEAT = 64;

const clamp01 = (value: number): number => Math.max(0.0, Math.min(1.0, value));

const pickUniformIndex = (length: number, rng: () => number): number => {
  const raw = rng();
  const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1 - Number.EPSILON) : 0;
  return Math.floor(clamped * length);
};

const pushSeatReason = (seat: SeatMemory, reason: MemoryReason): void => {
  seat.recentReasons.push(reason);
  if (seat.recentReasons.length > MAX_REASONS_PER_SEAT) {
    seat.recentReasons.splice(0, seat.recentReasons.length - MAX_REASONS_PER_SEAT);
  }
};

const revealedGodBonus = (role: Role): number => {
  switch (role) {
    case Role.SEER:
      return 0.4;
    case Role.WITCH:
      return 0.3;
    case Role.HUNTER:
      return 0.2;
    case Role.IDIOT:
      return 0.1;
    default:
      return 0.0;
  }
};

export class BeliefTracker {
  private readonly store = new PlayerMemoryStore();
  /** Seats publicly revealed as confirmed village-side (e.g. flipped Idiot). */
  private readonly confirmedGoodIds = new Set<number>();

  reset(): void {
    this.store.reset();
    this.confirmedGoodIds.clear();
  }

  init(players: Player[]): void {
    this.store.init(players);
    this.confirmedGoodIds.clear();
  }

  setRound(round: number): void {
    this.store.setCurrentRound(round);
  }

  getSeatMemory(seatId: number): SeatMemory | undefined {
    return this.store.getSeatMemory(seatId);
  }

  isConfirmedGood(seatId: number): boolean {
    return this.confirmedGoodIds.has(seatId);
  }

  getRecentReasons(seatId: number, targetId?: number): readonly MemoryReason[] {
    return this.store.getRecentReasons(seatId, targetId);
  }

  getPublicRoleClaims(seatId: number): readonly PublicRoleClaim[] {
    return this.store.getPublicRoleClaims(seatId);
  }

  /** Direct structured VisibleEvent ingestion (idempotent by eventId, gated by visibility). */
  ingestEvent(event: VisibleEvent, players?: readonly Player[]): boolean {
    return this.store.ingestEvent(event, players);
  }

  /** Alias for P1A/P1B consumers referencing ingestVisibleEvent. */
  ingestVisibleEvent(event: VisibleEvent, players?: readonly Player[]): boolean {
    return this.store.ingestEvent(event, players);
  }

  getSuspicion(actorId: number, targetId: number): number {
    return this.store.getSeatMemory(actorId)?.suspicion.get(targetId) ?? DEFAULT_SUSPICION;
  }

  /** Record a Seer check privately for that Seer only (never leaks to other actors). */
  recordSeerCheck(
    seerId: number,
    targetId: number,
    isGood: boolean,
    options: SeerCheckOptions = {},
  ): void {
    const round = options.round ?? this.store.getCurrentRound();
    const seq = this.store.nextSeq();
    const eventId = options.eventId ?? `seer-check:r${round}:s${seerId}:t${targetId}:${seq}`;

    // Support direct callers that invoke recordSeerCheck before init()
    if (!this.store.getSeatMemory(seerId)) {
      this.store.ensureSeat(seerId, Role.SEER);
    }

    this.store.ingestEvent({
      eventId,
      seq,
      round,
      phase: GamePhase.NIGHT_SEER,
      visibility: 'seat-private',
      visibleToSeatIds: [seerId],
      kind: 'seer-check',
      actorId: seerId,
      payload: { seerId, targetId, isGood },
    });
  }

  /** Record Witch private night outcome (visible ONLY to the Witch seat). */
  recordWitchInfo(
    witchId: number,
    payload: WitchInfoEventPayload,
    options: WitchInfoOptions = {},
  ): void {
    const round = options.round ?? this.store.getCurrentRound();
    const seq = this.store.nextSeq();
    const eventId = options.eventId ?? `witch-info:r${round}:w${witchId}:${seq}`;

    if (!this.store.getSeatMemory(witchId)) {
      this.store.ensureSeat(witchId, Role.WITCH);
    }

    this.store.ingestEvent({
      eventId,
      seq,
      round,
      phase: GamePhase.NIGHT_WITCH,
      visibility: 'seat-private',
      visibleToSeatIds: [witchId],
      kind: 'witch-info',
      actorId: witchId,
      payload,
    });
  }

  /** Return the private set of target IDs already checked by a Seer. */
  getCheckedTargets(seerId: number): ReadonlySet<number> {
    const checks = this.store.getSeatMemory(seerId)?.seerChecks;
    return new Set(checks ? checks.keys() : []);
  }

  private enforceConfirmedGoodLock(): void {
    if (this.confirmedGoodIds.size === 0) return;
    for (const seatId of this.store.getAllSeatIds()) {
      const seat = this.store.getSeatMemory(seatId);
      if (!seat || seat.role === Role.WEREWOLF) continue;
      for (const goodId of this.confirmedGoodIds) {
        if (goodId !== seat.seatId) {
          seat.suspicion.set(goodId, 0.0);
        }
      }
    }
  }

  /**
   * After someone speaks publicly (human or AI), parse structured clause-level
   * evidence and ingest a public speech VisibleEvent into all seats.
   * For AI speakers who already hold prior evidence-backed beliefs, phrasing
   * variance updates listeners and the speaker's `publicStance` without
   * rewriting the speaker's own internal suspicion map.
   */
  updateFromSpeech(
    speakerId: number,
    speech: string,
    allPlayers: Player[],
    options: SpeechUpdateOptions = {},
  ): VisibleEvent<SpeechEventPayload> | null {
    const speakerSeat = this.store.getSeatMemory(speakerId);
    if (!speakerSeat) return null;

    const round = options.round ?? this.store.getCurrentRound();
    if (options.round !== undefined) {
      this.store.setCurrentRound(options.round);
    }
    const phase = options.phase ?? GamePhase.DAY_DISCUSSION;
    const eventId = options.eventId ?? buildSpeechEventId(round, speakerId, speech);
    const parsed = parseSpeechEvidence(speech, speakerId, allPlayers, { round, eventId });

    const preserveSpeakerBeliefs =
      !speakerSeat.isHuman && speakerSeat.recentReasons.length > 0;
    const prevSpeakerSuspicion = preserveSpeakerBeliefs
      ? new Map(speakerSeat.suspicion)
      : null;

    const event: VisibleEvent<SpeechEventPayload> = {
      eventId,
      seq: this.store.nextSeq(),
      round,
      phase,
      visibility: 'public',
      kind: 'speech',
      actorId: speakerId,
      payload: {
        text: speech,
        claims: parsed.claims,
        roleClaims: parsed.roleClaims,
      },
    };

    this.store.ingestEvent(event, allPlayers);

    if (prevSpeakerSuspicion) {
      for (const [targetId, score] of prevSpeakerSuspicion.entries()) {
        speakerSeat.suspicion.set(targetId, score);
      }
    }
    this.enforceConfirmedGoodLock();
    return event;
  }

  /**
   * After a public vote, update both the voter's own stance (without polluting
   * wolf teammates) and living observers' suspicion of the voted target.
   */
  updateFromVote(voterId: number, targetId: number | null, options?: VoteUpdateOptions): void;
  updateFromVote(
    voterId: number,
    targetId: number | null,
    players?: readonly Player[],
    round?: number,
    eventId?: string,
  ): void;
  updateFromVote(
    voterId: number,
    targetId: number | null,
    optionsOrPlayers?: VoteUpdateOptions | readonly Player[],
    roundArg?: number,
    eventIdArg?: string,
  ): void {
    if (!targetId) return;
    const voterSeat = this.store.getSeatMemory(voterId);
    if (!voterSeat) return;

    const opts: VoteUpdateOptions = Array.isArray(optionsOrPlayers)
      ? { players: optionsOrPlayers, round: roundArg, eventId: eventIdArg }
      : ((optionsOrPlayers as VoteUpdateOptions | undefined) ?? {});

    const round = opts.round ?? this.store.getCurrentRound();
    if (opts.round !== undefined) {
      this.store.setCurrentRound(opts.round);
    }
    const seq = this.store.nextSeq();
    const eventId = opts.eventId ?? `vote:r${round}:v${voterId}:t${targetId}:${seq}`;

    const applied = this.store.ingestEvent(
      {
        eventId,
        seq,
        round,
        phase: GamePhase.DAY_VOTING,
        visibility: 'public',
        kind: 'vote',
        actorId: voterId,
        payload: { voterId, targetId },
      },
      opts.players,
    );

    if (!applied) return;

    // Observer-aware updates for all living seats other than the voter.
    for (const observerId of this.store.getAllSeatIds()) {
      if (observerId === voterId) continue;
      const observer = this.store.getSeatMemory(observerId);
      if (!observer || !observer.isAlive) continue;
      if (targetId === observer.seatId) continue;

      if (observer.role === Role.WEREWOLF && observer.knownTeammateIds.has(targetId)) {
        observer.suspicion.set(targetId, WOLF_TEAMMATE_SUSPICION);
        continue;
      }
      if (observer.role === Role.SEER && observer.seerChecks.has(targetId)) {
        continue;
      }
      if (observer.role !== Role.WEREWOLF && this.confirmedGoodIds.has(targetId)) {
        observer.suspicion.set(targetId, 0.0);
        continue;
      }

      const voterSus = observer.suspicion.get(voterId) ?? DEFAULT_SUSPICION;
      let delta: number;
      let tag: string;
      if (voterSus >= 0.7) {
        delta = -0.05;
        tag = 'vote-observer-contra';
      } else {
        const credibility = observer.credibility.get(voterId) ?? DEFAULT_CREDIBILITY;
        delta = 0.04 * credibility;
        tag = 'vote-observer-follow';
      }

      const current = observer.suspicion.get(targetId) ?? DEFAULT_SUSPICION;
      observer.suspicion.set(targetId, clamp01(current + delta));
      pushSeatReason(observer, {
        eventId,
        round,
        actorId: voterId,
        targetId,
        delta,
        tag,
      });
    }

    this.enforceConfirmedGoodLock();
  }

  /**
   * After an elimination, clear the dead seat from active suspicion rankings
   * without EVER reading or leaking an unrevealed role (`revealedRole === null`).
   */
  updateFromDeath(
    deadId: number,
    revealedRole: Role | null,
    allPlayers: Player[],
    options: DeathUpdateOptions = {},
  ): void {
    const round = options.round ?? this.store.getCurrentRound();
    if (options.round !== undefined) {
      this.store.setCurrentRound(options.round);
    }
    const seq = this.store.nextSeq();
    const eventId = options.eventId ?? `death:r${round}:d${deadId}:${seq}`;

    // Sync liveness across seats without reading any hidden roles.
    for (const player of allPlayers) {
      const seat = this.store.getSeatMemory(player.id);
      if (seat) seat.isAlive = player.isAlive;
    }

    if (revealedRole !== null) {
      this.store.ingestEvent(
        {
          eventId,
          seq,
          round,
          phase: options.phase ?? GamePhase.DAY_ANNOUNCE,
          visibility: 'public',
          kind: 'death',
          actorId: null,
          payload: { deadId, role: revealedRole, cause: options.cause },
        },
        allPlayers,
      );
      this.enforceConfirmedGoodLock();
      return;
    }

    // Dark-card / unrevealed death: never inspect deadPlayer.role or mutate credibility.
    for (const seatId of this.store.getAllSeatIds()) {
      const seat = this.store.getSeatMemory(seatId);
      if (!seat || seat.seenEventIds.has(eventId)) continue;
      seat.seenEventIds.add(eventId);
      if (seat.seatId === deadId) {
        seat.isAlive = false;
        continue;
      }
      const prev = seat.suspicion.get(deadId) ?? DEFAULT_SUSPICION;
      seat.suspicion.set(deadId, 0.0);
      if (seat.isAlive) {
        pushSeatReason(seat, {
          eventId,
          round,
          actorId: null,
          targetId: deadId,
          delta: -prev,
          tag: 'death-unrevealed',
        });
      }
    }
  }

  /**
   * Public Idiot flip on first exile vote: Idiot survives with `isRevealed: true`.
   * Good seats lock suspicion(idiot) = 0.0; wolves register high public god threat.
   */
  updateFromIdiotFlip(
    idiotId: number,
    allPlayers: Player[],
    options: FlipUpdateOptions = {},
  ): void {
    const round = options.round ?? this.store.getCurrentRound();
    if (options.round !== undefined) {
      this.store.setCurrentRound(options.round);
    }
    const seq = this.store.nextSeq();
    const eventId = options.eventId ?? `flip:r${round}:i${idiotId}:${seq}`;

    this.confirmedGoodIds.add(idiotId);

    const applied = this.store.ingestEvent(
      {
        eventId,
        seq,
        round,
        phase: options.phase ?? GamePhase.DAY_VOTING,
        visibility: 'public',
        kind: 'flip',
        actorId: idiotId,
        payload: { targetId: idiotId, role: Role.IDIOT },
      },
      allPlayers,
    );

    if (!applied) return;

    for (const seatId of this.store.getAllSeatIds()) {
      const seat = this.store.getSeatMemory(seatId);
      if (!seat || seat.seatId === idiotId) continue;

      seat.publicRoleClaims.set(idiotId, {
        seatId: idiotId,
        claimedRole: Role.IDIOT,
        round,
        eventId,
        confidence: 1.0,
        contested: false,
      });

      if (seat.role !== Role.WEREWOLF) {
        const prev = seat.suspicion.get(idiotId) ?? DEFAULT_SUSPICION;
        seat.suspicion.set(idiotId, 0.0);
        pushSeatReason(seat, {
          eventId,
          round,
          actorId: idiotId,
          targetId: idiotId,
          delta: -prev,
          tag: 'idiot-flip-good',
        });
      } else {
        pushSeatReason(seat, {
          eventId,
          round,
          actorId: idiotId,
          targetId: idiotId,
          delta: 0,
          tag: 'idiot-flip-god-threat',
        });
      }
    }
  }

  /**
   * Estimate public table heat against `targetId` strictly from public events
   * observed by `actorId` (zero omniscient reads). Bounded in [0, 1].
   */
  getPublicHeat(actorId: number, targetId: number, players?: readonly Player[]): number {
    const seat = this.store.getSeatMemory(actorId);
    if (!seat) return 0;

    const aliveIds = players
      ? new Set(players.filter(p => p.isAlive).map(p => p.id))
      : null;

    const hostileByActor = new Map<number, number>();
    const supportiveActors = new Set<number>();
    const voteActors = new Set<number>();

    for (const event of seat.visibleEvents) {
      if (event.visibility !== 'public') continue;
      if (event.kind === 'speech') {
        const speakerId = event.actorId;
        if (speakerId === null || speakerId === targetId) continue;
        if (aliveIds && !aliveIds.has(speakerId)) continue;
        const payload = event.payload as SpeechEventPayload;
        for (const claim of payload.claims) {
          if (claim.targetId !== targetId || claim.confidence <= 0) continue;
          if (claim.polarity === 'check-wolf') {
            hostileByActor.set(speakerId, Math.max(hostileByActor.get(speakerId) ?? 0, 0.4));
          } else if (claim.polarity === 'accuse') {
            hostileByActor.set(speakerId, Math.max(hostileByActor.get(speakerId) ?? 0, 0.25));
          } else if (claim.polarity === 'defend' || claim.polarity === 'check-good') {
            supportiveActors.add(speakerId);
          }
        }
      } else if (event.kind === 'vote') {
        const payload = event.payload as VoteEventPayload;
        if (payload.targetId !== targetId || payload.voterId === targetId) continue;
        if (aliveIds && !aliveIds.has(payload.voterId)) continue;
        voteActors.add(payload.voterId);
      }
    }

    let heat = 0;
    for (const weight of hostileByActor.values()) heat += weight;
    heat += voteActors.size * 0.2;
    heat -= supportiveActors.size * 0.15;
    return clamp01(heat);
  }

  /**
   * Estimate vocal/public leadership influence of `targetId` strictly from
   * public speeches visible to `actorId`. Bounded in [0, 1].
   */
  getPublicInfluence(actorId: number, targetId: number): number {
    const seat = this.store.getSeatMemory(actorId);
    if (!seat) return 0;

    let speechContributions = 0;
    for (const event of seat.visibleEvents) {
      if (event.visibility !== 'public' || event.kind !== 'speech') continue;
      if (event.actorId !== targetId) continue;
      const payload = event.payload as SpeechEventPayload;
      if (payload.claims.length > 0 || payload.roleClaims.length > 0) {
        speechContributions += 1;
      } else if (payload.text.trim().length >= 16) {
        speechContributions += 0.5;
      }
    }

    if (speechContributions === 0) return 0;
    const credibility = seat.credibility.get(targetId) ?? DEFAULT_CREDIBILITY;
    return clamp01(Math.min(0.75, speechContributions * 0.25) * (0.7 + 0.5 * credibility));
  }

  /**
   * Public threat score for wolf night kill / faction-gain evaluation.
   * NEVER peeks at `target.role` unless `target.isRevealed === true`.
   */
  getPublicThreatScore(actorId: number, target: Player): number {
    const seat = this.store.getSeatMemory(actorId);
    let score = 0;

    if (target.isRevealed && target.role !== Role.VILLAGER && target.role !== Role.WEREWOLF) {
      score += 3.0 + revealedGodBonus(target.role);
    } else if (seat) {
      const claim = seat.publicRoleClaims.get(target.id);
      if (claim && !seat.knownTeammateIds.has(target.id)) {
        switch (claim.claimedRole) {
          case Role.SEER:
            score += claim.contested ? 1.9 : 2.2;
            break;
          case Role.WITCH:
            score += 1.8;
            break;
          case Role.HUNTER:
            score += 1.4;
            break;
          case Role.IDIOT:
            score += 1.1;
            break;
          default:
            break;
        }
      }
    }

    score += 0.5 * this.getPublicInfluence(actorId, target.id);
    score += 0.25 * this.getSuspicion(actorId, target.id);
    return score;
  }

  /** Return the most suspicious alive player for a given actor, breaking ties uniformly via rng */
  getMostSuspicious(
    actorId: number,
    players: Player[],
    filter: (p: Player) => boolean = () => true,
    rng: () => number = Math.random,
  ): Player | null {
    const actorMap = this.store.getSeatMemory(actorId)?.suspicion;
    if (!actorMap) return null;

    const candidates = players.filter(p => p.isAlive && p.id !== actorId && filter(p));
    if (candidates.length === 0) return null;

    let bestScore = -Infinity;
    let tied: Player[] = [];
    for (const p of candidates) {
      const score = actorMap.get(p.id) ?? DEFAULT_SUSPICION;
      if (score > bestScore + TIE_EPSILON) {
        bestScore = score;
        tied = [p];
      } else if (Math.abs(score - bestScore) <= TIE_EPSILON) {
        tied.push(p);
      }
    }

    return tied.length === 1 ? tied[0] : tied[pickUniformIndex(tied.length, rng)];
  }

  /** Return the most uncertain alive player (closest to 0.5), breaking ties uniformly via rng */
  getLeastVerified(
    actorId: number,
    players: Player[],
    rng: () => number = Math.random,
  ): Player | null {
    const actorMap = this.store.getSeatMemory(actorId)?.suspicion;
    if (!actorMap) return null;

    const candidates = players.filter(p => p.isAlive && p.id !== actorId);
    if (candidates.length === 0) return null;

    let bestDist = Infinity;
    let tied: Player[] = [];
    for (const p of candidates) {
      const dist = Math.abs((actorMap.get(p.id) ?? DEFAULT_SUSPICION) - 0.5);
      if (dist < bestDist - TIE_EPSILON) {
        bestDist = dist;
        tied = [p];
      } else if (Math.abs(dist - bestDist) <= TIE_EPSILON) {
        tied.push(p);
      }
    }

    return tied.length === 1 ? tied[0] : tied[pickUniformIndex(tied.length, rng)];
  }

  snapshot(actorId: number): Array<{ targetId: number; score: number }> {
    const actorMap = this.store.getSeatMemory(actorId)?.suspicion;
    if (!actorMap) return [];
    return [...actorMap.entries()]
      .map(([targetId, score]) => ({ targetId, score }))
      .sort((a, b) => b.score - a.score);
  }
}

// Singleton tracker per game session
export const globalBeliefTracker = new BeliefTracker();
