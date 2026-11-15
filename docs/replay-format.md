# Replay Format (`schemaVersion: 1`)

A finished match produces a structured replay stored in the current browser. The replay supports post-game review and offline analysis. Recording does not add a database table, contact Supabase, or send match data over the network.

## Code map

- Public entry point: `src/replay/index.ts`.
- Types: `src/replay/replayTypes.ts` (`ReplayRecord` and related types).
- Recording and normalization: `src/replay/replayRecorder.ts` (`buildReplay`, `createReplayRecorder`).
- Storage and export: `src/replay/replayStore.ts` (`saveReplay`, `listReplays`, `loadReplay`, `exportReplay`, `clearReplays`).
- Collection points: `src/hooks/useGameState.ts`.

The recorder observes the game; it does not replace phase progression, timers, voting, or AI action selection.

## Versioning

`REPLAY_SCHEMA_VERSION` is currently `1`. Adding an optional field can preserve the version. Renaming or removing a field, changing its meaning, or making it required needs a version increment and corresponding reader/test updates.

Readers accept only the supported version. The storage key, `werewolf.replays.v1`, also includes the major version. An incompatible version needs a new key; older data is not silently migrated or deleted.

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Replay schema version. |
| `gameId` | `string` | Local UUID or replay identifier for indexing and deduplication; not an account ID. |
| `createdAt` | ISO `string` | Time the finished replay was saved. |
| `boardId` | `'9-standard'` or `'12-standard'` | Board configuration. |
| `difficulty` | `'easy'`, `'normal'`, or `'hard'` | Difficulty selected at match start. |
| `language` | `'zh'` or `'en'` | AI expression language. |
| `isGuest` | `boolean` | Guest/account mode; no account identity is included. |
| `players` | `ReplayPlayerSeat[]` | Seats containing only `seat`, `role`, and `isHuman`; no display names. |
| `phases` | `ReplayPhaseEntry[]` | Ordered `{ phase, round }` entries, from `NIGHT_START:0` to `GAME_OVER`. |
| `speeches` | `ReplaySpeech[]` | Public speeches: `{ round, phase, speakerId, text }`; human text is preserved verbatim. |
| `votes` | `ReplayVote[]` | `{ round, voterId, targetId, reason? }`; abstention/lost vote uses `targetId: null`. AI reasons come from action generation; human votes omit `reason`. |
| `beliefSnapshots` | `ReplayBeliefSnapshot[]` | `{ round, actorId, scores: [{ targetId, score }] }` for living AI seats. |
| `wolfChat` | `ReplayWolfChatEntry[]` | Werewolf night messages: `{ round, speakerId, message }`. |
| `checks` | `ReplayCheck[]` | Seer checks: `{ round, actorId, targetId, isGood }`, including both AI and human Seer paths. |
| `outcome` | `{ winner, rounds }` | Winner is `'VILLAGERS'` or `'WEREWOLVES'`; the final round count is at least one. |

Top-level key order is stable. Exports omit `undefined` fields. Event arrays retain recording order. Belief snapshots are sorted by round and actor; scores are descending, with ties ordered by target seat. Scores are clamped to `[0, 1]`, and invalid entries are discarded rather than persisted.

## Collection semantics

| Data | Collection point |
| --- | --- |
| Phases | Read-only effect after phase/round changes; adjacent duplicates are removed. |
| AI speeches | After the public discussion entry is committed in `handleDiscussion`. |
| Human speeches | After submission in `handleHumanSpeechSubmit`. |
| Votes and AI reasons | During `settleVote`, before exile resolution. |
| AI Seer checks | After the check is committed in `handleSeerPhase`. |
| Human Seer checks | After a target is selected in the `NIGHT_SEER` action path. |
| Wolf chat | After messages are committed inside the active werewolf-phase callback. |
| Belief snapshots | At vote settlement; also at game over if the match ends during a night or Hunter action. |

Suspicion snapshots read `globalBeliefTracker.snapshot(actorId)` without initializing or updating the tracker. Only living AI actors and their living alternative targets are included, so each score list has `living players - 1` entries. If the tracker was never initialized, no empty snapshot is invented.

## Persistence and recovery

Recording accumulates in memory. A replay is saved only when a non-null winner and `GAME_OVER` are present. The save effect, one-shot `finalize()`, and `gameId`-based upsert provide idempotency. Leaving an unfinished match creates no replay.

The storage value is `{ "version": 1, "replays": [...] }`. At most five finished replays are retained, newest first. Missing or inaccessible local storage, corrupt JSON, and quota failures switch the module into session-memory mode without interrupting the match. Subsequent reads use that memory to avoid restoring stale browser data. `clearReplays()` clears memory and resets degraded mode.

Stored records are validated at runtime. Unknown properties, including accidental name/email fields, are stripped; records with an invalid core shape are ignored.

## API

```ts
import {
  listReplays,   // (): ReplayRecord[] - newest first
  loadReplay,    // (id: string): ReplayRecord | null
  exportReplay,  // (id: string): string | null - stable, two-space JSON
  clearReplays,  // (): void
  saveReplay,    // (record: ReplayRecord): boolean - internal/test use
  type ReplayRecord,
} from '../replay';
```

`exportReplay()` serializes a stored record; it does not write a file or make a network request. A missing or cleared replay returns `null`, which consumers should present as an empty state.

## Illustrative record

This example illustrates the schema rather than measured player behavior. Several event arrays are abbreviated. Full recordings include each recorded speech, vote, and living AI actor's per-round snapshot. Example reason strings are shown in English for readability; real exports preserve the recorded text and language.

```json
{
  "schemaVersion": 1,
  "gameId": "b4c1f0d6-5d2a-4c3e-9b1f-6a0d8f7e2c11",
  "createdAt": "2026-11-12T09:30:00.000Z",
  "boardId": "9-standard",
  "difficulty": "normal",
  "language": "en",
  "isGuest": true,
  "players": [
    { "seat": 1, "role": "Villager", "isHuman": true },
    { "seat": 2, "role": "Werewolf", "isHuman": false },
    { "seat": 3, "role": "Seer", "isHuman": false },
    { "seat": 4, "role": "Witch", "isHuman": false },
    { "seat": 5, "role": "Villager", "isHuman": false },
    { "seat": 6, "role": "Hunter", "isHuman": false },
    { "seat": 7, "role": "Werewolf", "isHuman": false },
    { "seat": 8, "role": "Villager", "isHuman": false },
    { "seat": 9, "role": "Werewolf", "isHuman": false }
  ],
  "phases": [
    { "phase": "NIGHT_START", "round": 0 },
    { "phase": "NIGHT_WEREWOLVES", "round": 1 },
    { "phase": "NIGHT_SEER", "round": 1 },
    { "phase": "NIGHT_WITCH", "round": 1 },
    { "phase": "DAY_ANNOUNCE", "round": 1 },
    { "phase": "DAY_HUNTER_CHECK", "round": 1 },
    { "phase": "DAY_DISCUSSION", "round": 1 },
    { "phase": "DAY_VOTING", "round": 1 },
    { "phase": "GAME_OVER", "round": 1 }
  ],
  "speeches": [
    {
      "round": 1,
      "phase": "DAY_DISCUSSION",
      "speakerId": 1,
      "text": "Player 2 spoke first last round and avoided naming a target. I am voting there."
    },
    {
      "round": 1,
      "phase": "DAY_DISCUSSION",
      "speakerId": 2,
      "text": "Player 1 is reading too much into one speech, but I will answer questions."
    }
  ],
  "votes": [
    { "round": 1, "voterId": 1, "targetId": 2 },
    { "round": 1, "voterId": 2, "targetId": 1, "reason": "Highest-suspicion target: Player 1" },
    { "round": 1, "voterId": 3, "targetId": 2, "reason": "Highest-suspicion target: Player 2" }
  ],
  "beliefSnapshots": [
    {
      "round": 1,
      "actorId": 2,
      "scores": [
        { "targetId": 1, "score": 0.9 },
        { "targetId": 3, "score": 0.83 },
        { "targetId": 4, "score": 0.76 },
        { "targetId": 5, "score": 0.69 },
        { "targetId": 6, "score": 0.62 },
        { "targetId": 7, "score": 0.55 },
        { "targetId": 8, "score": 0.48 },
        { "targetId": 9, "score": 0.41 }
      ]
    },
    {
      "round": 1,
      "actorId": 3,
      "scores": [
        { "targetId": 1, "score": 0.9 },
        { "targetId": 2, "score": 0.83 },
        { "targetId": 4, "score": 0.76 },
        { "targetId": 5, "score": 0.69 },
        { "targetId": 6, "score": 0.62 },
        { "targetId": 7, "score": 0.55 },
        { "targetId": 8, "score": 0.48 },
        { "targetId": 9, "score": 0.41 }
      ]
    }
  ],
  "wolfChat": [
    {
      "round": 1,
      "speakerId": 2,
      "message": "Player 3 is the seer, push Player 1 instead."
    }
  ],
  "checks": [
    { "round": 1, "actorId": 3, "targetId": 2, "isGood": false }
  ],
  "outcome": { "winner": "VILLAGERS", "rounds": 1 }
}
```

## Reading and exporting a finished match

Use `listReplays()` for the newest-first list and `loadReplay(id)` for details. Align speech, votes, checks, and wolf chat by round; `phases` supplies the sequence. Replay scores are recorded relative suspicions and should not be substituted for a live player's `suspicionMap`.

For development inspection in Chrome/Edge, finish a match, open the site's Local Storage in Developer Tools, and inspect `werewolf.replays.v1`. The following uses the browser's `copy` helper:

```js
copy(JSON.stringify(JSON.parse(localStorage.getItem('werewolf.replays.v1')).replays[0], null, 2))
```

In memory-only mode, the replay does not survive a refresh and is unavailable through the storage key. The in-page replay API remains the appropriate reader for the active session.

## Privacy and limits

- Replay identity fields omit names, email addresses, account UUIDs, sessions, and credentials. The human is identified by seat and `isHuman` only.
- Speech is stored verbatim and may itself contain personal information entered by a player. Review an export before sharing it; the schema cannot sanitize arbitrary free text by omitting identity fields alone.
- Storage is browser-local, retains only five matches, and is lost when site data is cleared. There is no cross-device or cross-profile synchronization.
- The replay does not record the full system log, every night-action detail, or every interface event.
- If belief tracking was unavailable, the corresponding snapshots are absent.
- Storage degradation remains active for the page session until clearing or refreshing.
- Cross-device storage would require a separately designed remote persistence and access-control boundary.
