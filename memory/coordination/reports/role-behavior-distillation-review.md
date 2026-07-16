# Review: role-behavior-distillation

Date: 2026-07-16
Reviewer: Debugger (independent verification in coder worktree
`.claude/worktrees/agent-a1a9fb451a7ff0866`, base `b7a8529`)

## 1. Scope check — PASS

`git status --short` / `git diff --cached --stat` in the worktree show exactly
the four allowed paths, all staged, 393 insertions, 0 deletions:

- `src/ai/behaviorSchema.ts` (new, 141 lines)
- `src/ai/behaviorSchema.test.ts` (new, 78 lines)
- `src/services/roleProfiles.ts` (modified, purely additive — zero removed lines)
- `src/services/roleProfiles.test.ts` (modified, purely additive — zero removed lines)

`actionSelector.ts`, `beliefTracker.ts`, `gameEngine.ts`, `aiOrchestrator.ts`
untouched. Untracked items are only the coder's own report copy and the
`node_modules` symlink (worktree setup artifact, not in the patch).

Patch `memory/coordination/runs/role-behavior-distillation-claude.patch`
matches the staged diff (identical per-file stat) and applies cleanly to the
main repo HEAD `b7a8529` (`git apply --check` OK).

## 2. Reproduction — PASS

- `npm run test:run`: **9 files, 60/60 passed** (independently reproduced).
- `npm run build`: success (same non-blocking chunk warning as baseline).
- Baseline arithmetic: 60 total − 10 (new `behaviorSchema.test.ts`) − 3 (tests
  appended to `roleProfiles.test.ts`) = 47 pre-existing, all passing. The
  card's "55/55 baseline" does not match this worktree's HEAD (47); that is a
  card/coordination discrepancy, not a coder defect — the coder disclosed it.
  Zero regressions.

## 3. Honesty audit — PASS (critical criterion)

- Grepped the full staged diff for `aiwolf-distilled`: every occurrence is a
  type declaration, constant, validator guard, negative test, or provenance
  comment. **No data value carries the `aiwolf-distilled` tag** — confirmed by
  reading all 18 profile blocks in `roleProfiles.ts`: only `heuristic()` /
  `synthetic()` helpers are used (Werewolf/Villager/Seer → heuristic;
  Witch/Hunter/Idiot → synthetic), matching the aiwolf-data-research facts.
- Structural prohibition verified: `behaviorSchema.ts:100-105` — `isValidSource`
  rejects `'aiwolf-distilled'` for any role outside `AIWOLF_COVERED_ROLES`
  (= Werewolf/Villager/Seer only, lines 38-42). Negative test
  `behaviorSchema.test.ts:61-65` proves a Witch param tagged aiwolf-distilled
  is rejected.
- Invariant test exists: `roleProfiles.test.ts:93-107`
  (`labels nothing aiwolf-distilled while no AIWolf data has been acquired`)
  sweeps every source tag of every profile, including all optional params.
- Grepped diff for train/trained/training: only (a) a test using `'trained'`
  as an *invalid* source that must be rejected, and (b) the comment "None of
  this involves model training; values are parameterization only"
  (`behaviorSchema.ts:20`). No training claims anywhere.

## 4. Backward compatibility — PASS

- `roleProfiles.ts` diff is purely additive: `ROLE_BEHAVIOR_PROFILES`,
  `RoleBehaviorProfile`, `BehaviorVariant`, `getRoleBehaviorProfile` all still
  exported with unchanged existing fields; new required `params` field only.
- The 4 pre-existing roleProfiles tests are byte-identical (0 removed lines in
  the test-file diff) and pass.
- No product code outside `roleProfiles.ts` constructs `RoleBehaviorProfile`
  values (verified by repo grep), so the added required field breaks nothing.

## 5. Schema grounding — PASS (5 of 7 claims spot-checked against code)

| Param | Claimed consumer | Verified |
| --- | --- | --- |
| `poisonThreshold` | actionSelector POISON gate hardcoded 0.7 | Yes — `src/ai/actionSelector.ts:134` `getSuspicion(...) > 0.7` |
| `voteFollowsSuspicion` | actionSelector VOTE suspicion vs follow-top-voted | Yes — suspicion branch ~line 65, top-voted fallback lines 119-121 |
| `firstNightTargetPriority` | actionSelector KILL revealed-god priority | Yes — lines 56-61 `revealed.sort(godPriority)` |
| `saveThreshold` | useGameState witch save gate ~0.55 | Yes — `src/hooks/useGameState.ts:373` `Math.random() > 0.45` (P(save)=0.55) |
| `shootThreshold` | useGameState hunter shot currently random | Yes — `useGameState.ts:437,448` random target |

`claimTiming` / `speechAggressiveness` map to aiOrchestrator prompt
construction (prompt building exists at `aiOrchestrator.ts:175`); same
intended-consumer status as the pre-existing `speechStyle` /
`systemPromptAddendum` fields. No purely decorative param without a plausible
consumption point. As the coder honestly states, nothing reads `params` at
runtime yet — explicitly out of scope per the card ("no consumer wiring").

## 6. Variant distinctness — PASS

Cautious vs aggressive differ by >= 0.2 in at least 2 new numeric params for
every driven role (e.g. Seer speechAggressiveness 0.3→0.85,
voteFollowsSuspicion 0.85→0.6; Witch saveThreshold 0.3→0.8, poisonThreshold
0.85→0.55; Hunter shootThreshold 0.8→0.45). Enforced by
`roleProfiles.test.ts:109-120`, alongside the untouched legacy invariant test.
Idiot is deliberately near-neutral and excluded from `DRIVEN_ROLES`, with a
code comment explaining why — acceptable (no distinct Idiot strategy exists to
express, and inventing one would be fabrication).

## 7. Type safety — PASS

- No `any` in the diff (grep of added lines: zero hits).
- `ROLE_BEHAVIOR_PROFILES: Record<Role, ...>` is compile-time exhaustive over
  the 6-member Role enum (`src/types.ts:1-8`); build passes, so all roles
  covered. Validator handles role-specific presence/absence per role.

## Acceptance criteria

1. Typed definitions + runtime validator + documented consumer rationale — met.
2. Source tags on every value; Witch/Hunter/Idiot never aiwolf-distilled
   (structural + data + test) — met.
3. No training claims — met.
4. Backward compatible; pre-existing tests unmodified and passing — met.
5. Tests prove schema validity of all 18 profiles and variant distinctness — met.
6. `npm run test:run` 60/60, `npm run build` success, zero regressions — met
   (card's 55/55 baseline figure is stale relative to worktree HEAD's 47;
   disclosed by the coder).

## Defects

None blocking. Observations (no action required):

- Minor: `roleProfiles.ts`/`getRoleBehaviorProfile` currently has no non-test
  product consumer (pre-existing condition, unchanged by this card).
- Minor: the coder report says the witch save gate is "hardcoded 0.55"; the
  code is `Math.random() > 0.45`, i.e. save probability 0.55 — equivalent in
  substance, phrasing only.

VERDICT: PASS
