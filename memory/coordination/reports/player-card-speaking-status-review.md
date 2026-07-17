# Review: player-card-speaking-status

## Verification

| Command | Result |
|---|---|
| `npm run test:run` | 26 files, 280 tests PASS (268 baseline + 12 new), zero regressions |
| `npm run build` | tsc + vite success, 1575 modules, zero errors |

## Diff analysis

4 files changed (43 insertions, 3 deletions), plus 1 new test file:

- `src/hooks/useGameState.ts` (+27/-1): Added `spokenPlayerIds` Set state (line 171); added `computeSpeakingStatus` pure helper (lines 109-123); marked spoken at 5 speech-finish points; reset in `handleDayAnnounce`; exposed `spokenPlayerIds` in return object.
- `src/components/PlayerCard.tsx` (+13/-1): Added `hasSpoken?: boolean` prop; emerald-600 checkmark badge at bottom-right of avatar (mutually exclusive with mic via guard); `opacity-90` dimming for spoken-alive-non-speaking cards; imported `Check` from lucide.
- `src/App.tsx` (+1): Passed `hasSpoken` prop on seat-stage PlayerCard render, gated to `DAY_DISCUSSION` phase.
- `src/speakingStatus.test.ts` (new, 12 tests): Non-discussion phases, dead players, speaking/spoken/pending, multiple players, reset semantics, hunter re-entry safety.

## Acceptance criteria map

1. **5 speech-finish paths all tracked**: PASS. Confirmed all `setSpokenPlayerIds` call sites:
   - Line 230: timer auto-skip (human — MY_PLAYER_ID)
   - Line 585: dead-human skip (handleDiscussion — nextSpeaker.id)
   - Line 607: AI speech success (handleDiscussion — nextSpeaker.id)
   - Line 610: AI error skip (handleDiscussion — nextSpeaker.id)
   - Line 709: human submit (handleHumanSpeechSubmit — MY_PLAYER_ID)
   - Queue-empty end-discussion (line 573-576): no speaker to mark — the queue is empty, so this is correct. Discussion ends and moves to voting.

2. **Reset at handleDayAnnounce, NOT enterDiscussion**: PASS. `setSpokenPlayerIds(new Set())` is at line 521 inside `handleDayAnnounce`, placed before last-words are queued. `enterDiscussion` has no reset call — hunter re-entry preserves earlier speakers.

3. **Current speaker keeps ring + mic; spoken players get green checkmark + dimming; unspoken unchanged**: PASS. PlayerCard condition `&& player.isAlive && !isSpeaking` ensures the checkmark and mic never coexist. `opacity-90` applied via Tailwind class, distinctly weaker than the dead-card `opacity-75 brightness-[0.65]`. Pending (unspoken) players get no visual change.

4. **Outside DAY_DISCUSSION renders exactly as today**: PASS. `hasSpoken` prop in App.tsx is gated: `game.phase === GamePhase.DAY_DISCUSSION && game.spokenPlayerIds.has(player.id)` — evaluates to `false` in all other phases. `computeSpeakingStatus` returns `'none'` for non-DAY_DISCUSSION phases.

5. **new tests cover status helper**: PASS. 12 tests: non-discussion phases (night, voting, gameOver), dead player during discussion, speaking, speaking-over-spoken, spoken, pending, empty-spoken-set, multiple players, reset semantics (9 players all pending), hunter re-entry (spoken set survives discussion re-enter).

6. **Original speech-finish code paths NOT altered**: PASS. All `setSpokenPlayerIds(...)` calls are purely additive — inserted as additional lines after or alongside the existing code. No structural changes to `handleDiscussion`, `handleHumanSpeechSubmit`, dead-human skip, or auto-skip effect. The original `setCurrentSpeaker(null)`, `addLog(...)`, `setUserInput('')`, etc. calls are all preserved unchanged.

7. **Hunter re-entry safe**: PASS. The spoken set resets only at `handleDayAnnounce` (new day), never in `enterDiscussion`. If a hunter dies mid-discussion and discussion re-enters, the spoken set survives. The test explicitly verifies this scenario with a Set containing {2, 3} and a new speaker 4.

8. **Visual states correct**: PASS.
   - Speaking: existing ring + mic (line 63: `ring-2 ring-zinc-100` + line 97-101: Mic badge)
   - Spoken: `opacity-90` class (line 64) + emerald-600 Check badge with `aria-label="已发言"` (lines 102-109)
   - Pending: default (no special styling)
   - Dead: `computeSpeakingStatus` returns `'none'` for dead players → no badge, no dimming from this card (dead styling from pre-existing code)
   - Night/voting/gameover: `hasSpoken` evaluates to `false` → no badge

9. **Badge positioning does not collide**: PASS. Checkmark at bottom-right of avatar (`-bottom-1 -right-1`), same position as mic. They never coexist (guard: `hasSpoken && player.isAlive && !isSpeaking`). Other badges at different positions: seat number top-left, 无票 top-right, customBadge avatar top-right, wolf teammate bottom-left.

10. **Baseline tests pass**: PASS. 280/280 total (268 + 12), zero regressions.

11. **Build succeeds**: PASS.

## Residual notes

- Internal representation uses `Set<number>` with immutable copies (`new Set(prev).add(id)`). O(1) lookup. Exposed directly in hook return for `.has()` usage in App.tsx.
- Set serialization risk: if any future code tries `JSON.stringify(game)` on the hook return, Sets don't serialize. Not currently done anywhere.
- Dead players recorded in the spoken set (dead-human skip) for correctness of hunter re-entry, but `computeSpeakingStatus` returns `'none'` for dead players, so they never show the green checkmark — this is correct.

VERDICT: PASS
