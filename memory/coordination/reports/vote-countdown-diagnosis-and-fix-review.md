# Debugger Review: vote-countdown-diagnosis-and-fix

**Role:** $aiwerewolf-debugger
**Date:** 2026-07-18
**Card:** `memory/coordination/tasks/vote-countdown-diagnosis-and-fix.md`
**Coder report:** `memory/coordination/reports/vote-countdown-diagnosis-and-fix.md`

## 1. File boundary verification

`git diff --stat HEAD` shows changes ONLY in:
- `src/hooks/useGameState.ts` (+61 lines, exports, state, effects)
- `src/App.tsx` (+5 lines, vote countdown pill)
- New: `src/voteCountdown.test.ts` (19 tests)

Zero diffs in:
- `src/gameEngine.ts` — frozen, confirmed
- `src/components/ActionBar.tsx` — untouched, confirmed
- `netlify/` — no changes
- `package.json` — no changes

The two `memory/coordination/tasks/*.md` diffs are status-text-only (Ready for review). All changes are within Allowed changes. **PASS.**

## 2. Verification commands

### 2.1. `npm run test:run`

```
28 passed | 1 skipped (29 files)
328 passed | 5 skipped (333 tests)
```

Baseline was 309. 19 new tests pass; zero regressions. **PASS.**

### 2.2. `npm run build`

TypeScript + Vite production build succeeds (950ms). **PASS.**

### 2.3. `npm run audit:speech-names`

Speech name audit: 2 files passed, 15 tests, 0 violations.
Fallback-dominant: 105 texts, 0 violations. Remote-model: 39 texts, 0 violations.
**PASS.**

### 2.4. `node scripts/speech-corpus-name-audit.mjs`

All 6 speech pools audited. Total violations: 0. **PASS.**

## 3. Acceptance criteria verification

### Criterion 1: Failing-test-first evidence

The report documents a genuine red-to-green cycle: 17 of 19 tests failed before the implementation (imports returned `undefined`), all 19 pass after. The test file (`src/voteCountdown.test.ts`) follows the repo convention of pure-helper tests (no jsdom). **PASS.**

### Criterion 2: Countdown pill at 10, single constant

`VOTE_DURATION_MS = 10_000` is a single exported constant. The setup effect computes `deadline = nowFn() + VOTE_DURATION_MS` and sets `voteTimer` to `computeVoteRemaining(deadline, nowFn())` which returns 10 on the initial tick. No scattered `10` anywhere. **PASS.**

### Criterion 3: Stable integer display, no reset on rerender

Displayed seconds are `Math.ceil((deadline - now) / 1000)`, floored at 0 — stable integer with no size jumps. The setup effect's deps are `[phase, roundCount, me?.isAlive, me?.canVote]` — a rerender within the same vote round has identical deps, so the effect does not re-fire and the captured deadline persists. Test (e) verifies: captured deadline preserved after 3s gives 7, not 10. **PASS.**

### Criterion 4: Vote confirm stops timer, double-submit locked

`finishVote` clears `voteDeadline` and `voteTimer` **synchronously** before the `await runAIPhaseSafely(...)`. The timeout effect's first guard is `!voteDeadline`. In React 18, `setVoteDeadline(null)`, `setVoteTimer(null)`, and `setIsProcessingAI(true)` (inside `runAIPhaseSafely`) are all batched in the same render from an event handler. The timeout effect then sees `voteDeadline === null` and returns. The click handler (`handlePlayerAction`) guards `isProcessingAI` at entry. Tests (h1-h3) simulate both race directions and the null-guard; all pass. **PASS.**

### Criterion 5: Timeout records abstain, not random vote

Timeout effect calls `finishVote(null)`. Inside `finishVote`, `humanTargetId === null` falls through to the abstain branch ("你无票或弃票。"). No random-vote code exists. **PASS.**

### Criterion 6: Fresh entry restarts 10s, cleanup on exit

Effect deps `[phase, roundCount, me?.isAlive, me?.canVote]`. Any change triggers the cleanup callback (`clearInterval`) and re-initializes with a fresh `nowFn() + 10_000` deadline. Phase leave, new game, game over, or unmount: the first guard (`phase !== DAY_VOTING || !isAlive || !canVote`) clears deadline and timer to `null` and returns (no interval created). Tests (d) and (f) verify. **PASS.**

### Criterion 7: Dead/vote-stripped/auto-vote no countdown, unchanged

Setup effect guard: `!me?.isAlive || !me.canVote` — clears deadline and timer. The existing `shouldAutoResolveVote(phase, me)` in the phase driver (line 300) handles dead/vote-stripped humans by calling `finishVote(null)` — this code is unchanged. The vote countdown and `shouldAutoResolveVote` are complements: when the latter returns true, the countdown is never started. When the countdown is active, the latter returns false. **PASS.**

### Criterion 8: Deadline-based with injectable clock

`computeVoteRemaining(deadline, now)` recomputes from the fixed deadline on every tick — background tabs with throttled intervals see the true remaining value. `nowFn` is a module-level injectable `() => number` defaulting to `Date.now`. `shouldAutoResolveVoteTimeout(deadline, now)` is a pure predicate. Tests (g1, g2) simulate clock drift and confirm deadline-based correctness. **PASS.**

React Strict Mode analysis:
- Setup effect double-mount: first interval cleaned up, second created — only one active at any time.
- Timeout effect double-mount: both runs see the same `voteTimer` state (React reuses state on remount in Strict Mode), deadline not expired, both return early. No double-fire.
**PASS.**

### Criterion 9: Required tests, each explicit

| Test case | Location | Status |
|---|---|---|
| (a) Normal 10s decrement 10->0 + ceiling | `computeVoteRemaining` describe, 7 tests | PASS |
| (b) Cancel on vote confirm (null deadline) | `shouldAutoResolveVoteTimeout` describe, test 4 | PASS |
| (c) Timeout -> abstain (predicate timing) | `shouldAutoResolveVoteTimeout` describe, tests 1-3 | PASS |
| (d) Tie/new-entry reset to full 10s | describe line 109, 1 test | PASS |
| (e) Rerender within phase does not reset | describe line 123, 1 test | PASS |
| (f) Unmount/phase-leave cleanup | describe line 142, 1 test | PASS |
| (g) Background-drift via injected clock | describe line 80, 2 tests | PASS |
| (h) No double-submit | describe line 156, 3 tests | PASS |

All 19 tests pass. **PASS.**

### Criterion 10: Baseline + build

328 passed (309 baseline + 19 new), zero regressions. `npm run build` succeeds. **PASS.**

## 4. Timer design correctness (deep review)

### 4.1. `VOTE_DURATION_MS` — single exported constant

Yes. `export const VOTE_DURATION_MS = 10_000;` at module scope. One definition; all consumers reference it.

### 4.2. Injectable clock (`nowFn`)

Yes. `export let nowFn: () => number = () => Date.now();` — module-level variable, test-overridable. Tests inject clock values directly into the pure helpers, which is correct for the repo's pure-helper test convention.

### 4.3. Pure exported functions

`computeVoteRemaining(deadline: number, now: number): number` — pure, no side effects, no `useState`.
`shouldAutoResolveVoteTimeout(deadline: number | null, now: number): boolean` — pure, returns false for null deadline.
Both exported, both testable in isolation. **PASS.**

### 4.4. Timeout auto-abstain

Timeout effect calls `finishVote(null)` → abstain path inside `finishVote`. Never calls with a non-null target. **PASS.**

### 4.5. Tick derives from deadline, not decrement

Each interval tick calls `setVoteTimer(computeVoteRemaining(deadline, nowFn()))` — recomputed from the fixed deadline on every tick. This is strictly better than a decrement counter.

Deadline cleared on:
- Confirm vote: `finishVote` sets both to null synchronously (lines 673-674)
- Tie/new-day: effect re-fires with new `roundCount`, capture block captures fresh deadline
- Phase leave: setup effect guard clears both
- Unmount: cleanup function clears interval; state is reset by the guard on next mount (or just garbage collected)

**PASS.**

### 4.6. Vote confirm: timer stop + repeat-submit lock

`finishVote` clears deadline/timer synchronously. `handlePlayerAction` guards `isProcessingAI` at entry. Timeout effect guards `!voteDeadline || isProcessingAI`. The combined guards prevent exactly-one-`finishVote`-per-round. **PASS.**

### 4.7. Tie/revote: fresh deadline

Effect deps include `roundCount`. A tie increments `roundCount` (the phase driver calls `setPhase(GamePhase.NIGHT_START)` then `setPhase(GamePhase.DAY_VOTING)` or equivalent), which triggers the effect's cleanup + re-init with a fresh deadline. **PASS.**

### 4.8. New-day cleanup

Phase change from `DAY_VOTING` triggers the setup effect guard (`phase !== DAY_VOTING`), which clears state and returns (no interval). **PASS.**

### 4.9. Dead-player bypass

Guard `!me?.isAlive || !me.canVote` prevents timer creation for dead or vote-stripped (Idiot) humans. **PASS.**

### 4.10. React Strict Mode — no parallel intervals

Already analyzed in criterion 8. Double-mount creates one interval (second run's; first was cleaned up). Double-fire is impossible because both timeout effect runs see the same state and return early (deadline not expired). **PASS.**

## 5. UI soundness

Vote timer pill (App.tsx line 279):
```
{game.voteTimer !== null && (
  <div className={`timer-pill${game.voteTimer <= 3 ? ' urgent' : ''}`}>
    <Clock3 className="w-4 h-4" />{game.voteTimer}s
  </div>
)}
```

- `timer-pill` and `urgent` classes are defined in `index.css` (lines 280, 291) and are the SAME classes used by `wolfCountdown` (line 276) and `speechTimer` (line 284). Confirmed reuse — no new CSS.
- `urgent` is applied at `voteTimer <= 3` (same threshold pattern as wolfCountdown).
- Visibility condition: `game.voteTimer !== null` — which is only set by the setup effect, which only fires for alive, vote-holding humans in `DAY_VOTING`. Dead/vote-stripped/AI never see the pill.
- Rendering position: between wolfCountdown and speechTimer pills in the UI header. Logical grouping.

**PASS.**

## 6. QUIET regression audit

### AI auto-vote flow

The vote timer operates entirely within the `DAY_VOTING` phase on the human player. AI auto-voting lives inside `finishVote` (line 689-700) which is called by the same `finishVote` function whether triggered by timeout, click, or auto-resolve. No new AI code path. No change to `generateAIAction` or the AI orchestrator. **No impact.**

### Wolf-countdown timer

The wolf countdown operates in `NIGHT_WEREWOLVES` phase (guard: `phase !== GamePhase.NIGHT_WEREWOLVES`). The vote timer operates in `DAY_VOTING`. These phases never overlap. The `wolfCountdown` state, effect, and UI pill are unchanged. **No impact.**

### Speech timer

The speech timer operates in `DAY_DISCUSSION`. No overlap with `DAY_VOTING`. Unchanged. **No impact.**

### Phase transition path

The timeout advances the phase through `finishVote(null)` → the EXISTING `runAIPhaseSafely` wrapper → the same vote-collection and resolution logic. It does NOT create a new code-unreachable phase transition. Inside `finishVote`:
- AI votes are collected (existing loop, line 689-700)
- `resolveVoteResult(votes)` is called (existing, line 712)
- On tie: `setPhase(GamePhase.NIGHT_START)` (existing, line 715)
- On elimination: the existing elimination/winner-check/hunter-shoot pipeline runs (existing, lines 718+)
- On error: the catch block calls `setPhase(GamePhase.NIGHT_START)` (existing, line 758)

**No new phase transition path created. PASS.**

### `shouldAutoResolveVote` interaction

The existing `shouldAutoResolveVote(phase, me)` in the phase driver (line 300) is unchanged. It returns `true` for dead/vote-stripped humans and `false` for alive vote-holders. The vote countdown setup effect's guard (`!me?.isAlive || !me.canVote`) is the exact complement: it activates only when `shouldAutoResolveVote` returns `false`. These two code paths are provably disjoint. When the phase driver calls `finishVote(null)` for a dead human, the setup effect has already cleared the deadline (same render cycle, batched state). **PASS.**

## 7. Code quality observation (non-blocking)

The vote timeout effect's dependency array is `[voteTimer, isProcessingAI, phase]`. Variables `voteDeadline`, `me`, `me?.isAlive`, `me.canVote`, and `finishVote` are read inside the effect body but not listed in deps. This is **consistent with existing patterns in this codebase**: the speech timer auto-skip effect (line 282-287) reads `currentSpeaker?.id` and calls `addLog`/`setSpokenPlayerIds`/`setCurrentSpeaker` without including them in deps. The wolf auto-select effect (line 228-237) includes `me` and `players` in deps, showing inconsistency in the existing codebase itself.

The omission is **not a functional bug** because `voteTimer` is in the deps array and changes every second, causing the effect to re-run with fresh closure values on every tick. Future cleanup work could unify the deps-array discipline across all effects, but that is outside this card's scope.

## Summary

| Check | Result |
|---|---|
| File boundaries (allowed only) | PASS |
| `npm run test:run` (328 pass, 0 regressions) | PASS |
| `npm run build` | PASS |
| `npm run audit:speech-names` (0 violations) | PASS |
| `node scripts/speech-corpus-name-audit.mjs` (0 violations) | PASS |
| Criterion 1: Failing-test-first evidence | PASS |
| Criterion 2: Single constant, pill at 10 | PASS |
| Criterion 3: Stable display, no reset on rerender | PASS |
| Criterion 4: Timer stop + double-submit lock | PASS |
| Criterion 5: Abstain on timeout, no random vote | PASS |
| Criterion 6: Fresh restart + cleanup on exit | PASS |
| Criterion 7: Dead/vote-stripped unchanged | PASS |
| Criterion 8: Deadline-based + injectable clock + Strict Mode | PASS |
| Criterion 9: All 8 test cases explicit | PASS |
| Criterion 10: Baseline 309+ + build | PASS |
| Timer design correctness (all 4.x checks) | PASS |
| UI soundness (CSS reuse, visibility guard) | PASS |
| QUIET regression (AI/wolf/speech/phase-driver) | PASS |

**VERDICT: PASS**
