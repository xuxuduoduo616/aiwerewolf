# Report: role-behavior-distillation

Date: 2026-07-16
Worker: Claude coder (isolated worktree `.claude/worktrees/agent-a1a9fb451a7ff0866`)
Patch: `memory/coordination/runs/role-behavior-distillation-claude.patch`

## Summary

Added a source-tagged behavioral-parameter schema (`src/ai/behaviorSchema.ts`) and
extended every role × variant profile in `src/services/roleProfiles.ts` with a
`params` field conforming to it. No consumer wiring, no engine changes, no LLM
calls — types + data + tests only, per the card's scope boundary.

## Changed files

- `src/ai/behaviorSchema.ts` — new. Types (`BehaviorSource`, `SourcedNumber`,
  `ClaimTiming`, `SourcedClaimTiming`, `RoleBehaviorParams`), constants
  (`BEHAVIOR_SOURCES`, `AIWOLF_COVERED_ROLES`, `CLAIM_TIMINGS`), and a runtime
  validator `isValidRoleBehaviorParams(role, params)` in the
  `isValidBenchmarkResult` style from `src/ai/benchmark.ts`.
- `src/services/roleProfiles.ts` — extended. `RoleBehaviorProfile` gains a
  required `params: RoleBehaviorParams`; all 18 profiles (6 roles × 3 variants)
  populated. All existing fields, exports, and `getRoleBehaviorProfile` are
  unchanged (backward compatible).
- `src/ai/behaviorSchema.test.ts` — new, 10 validator tests (force-added like
  the repo's other tracked `*.test.ts` files, which `.gitignore` nominally
  excludes via `**/*.test.ts`).
- `src/services/roleProfiles.test.ts` — extended with 3 tests; the 4
  pre-existing tests are unmodified.

## Schema design

Every parameter is grounded in an existing consumption point (documented in
code comments on `RoleBehaviorParams`):

| Parameter | Roles | Intended consumer (current hardcode) |
| --- | --- | --- |
| `claimTiming` ('never'/'when-pressured'/'day2'/'day1') | all | `aiOrchestrator` prompt shaping |
| `voteFollowsSuspicion` (0–1) | all | `actionSelector` VOTE: suspicion-driven vs follow-top-voted fallback |
| `speechAggressiveness` (0–1) | all | `aiOrchestrator` prompt emphasis |
| `firstNightTargetPriority` (0–1) | Werewolf only | `actionSelector` KILL revealed-god priority branch |
| `saveThreshold` (0–1) | Witch only | `useGameState.handleWitchPhase` AI save gate (hardcoded 0.55) |
| `poisonThreshold` (0–1) | Witch only | `actionSelector` POISON suspicion gate (hardcoded 0.7) |
| `shootThreshold` (0–1) | Hunter only | `useGameState.handleHunterCheck` AI shot target (currently random) |

The validator enforces: 0–1 ranges, known source tags, known claim timings,
role-specific params present exactly for their owner role and absent elsewhere,
and — structurally — that roles absent from AIWolf (Witch/Hunter/Idiot) can
NEVER carry an `'aiwolf-distilled'` tag.

## Source-labeling honesty statement

- NO AIWolf data has been downloaded (log reuse/redistribution license is
  unresolved per `p2-aiwolf-feasibility.md`), therefore NOTHING in this change
  is labeled `'aiwolf-distilled'`, and a test
  (`labels nothing aiwolf-distilled while no AIWolf data has been acquired`)
  enforces this for the profile data.
- Werewolf/Villager/Seer values are labeled `'heuristic'` (hand-authored;
  actual distillation is pending license confirmation — documented in code).
- Witch/Hunter/Idiot values are labeled `'synthetic'` (no AIWolf equivalent
  exists; template values from the project's own rules).
- No wording anywhere claims model training; code comments explicitly state
  this is parameterization/distillation only.

## Verification

- `npm run test:run`: 9 files, **60/60 passed** (this worktree's HEAD baseline
  was 47 tests; 13 added: 10 schema + 3 profile-params. All 47 pre-existing
  tests pass unmodified). Note: the card cites a 55/55 baseline and
  PROJECT_STATE cites 158/158 — this worktree's HEAD contains 47; no
  pre-existing test was changed or removed.
- `npm run build`: success (same non-blocking Gemini chunk warning as baseline).
- `git status --short`: only the four allowed paths staged (plus the untracked
  `node_modules` symlink required by worktree setup, not in the patch).
- Distinctness invariant: cautious vs aggressive differ by >= 0.2 in at least
  2 new numeric params for every driven role (Seer/Witch/Hunter/Villager/
  Werewolf), enforced by test alongside the pre-existing invariant test.

## Decisions

- Attached `params` directly to `RoleBehaviorProfile` (required field) rather
  than a parallel table, so `getRoleBehaviorProfile` returns everything and the
  type system forces completeness. Backward compatible because no existing code
  constructs `RoleBehaviorProfile` values outside `roleProfiles.ts`.
- Role-specific params are optional-typed but presence-validated per role, so
  no meaningless zero-values on roles whose consumers can't read them (unlike
  the legacy `poisonSaveThreshold: 0` pattern, which was left untouched for
  backward compatibility).
- Small `heuristic()`/`synthetic()` helpers keep the 18 data blocks compact and
  make mislabeling a one-line review check.

## Limitations / residual risks

- No consumer reads `params` yet (explicitly out of scope). Wiring
  `actionSelector`/`useGameState`/`aiOrchestrator` to these values is a
  follow-up card; until then the hardcoded values (0.7 poison gate, 0.55 save
  probability, random hunter shot) remain authoritative at runtime.
- All values are hand-authored heuristics/templates. Actual AIWolf distillation
  for Werewolf/Villager/Seer requires license resolution first; the
  `'aiwolf-distilled'` tag and `AIWOLF_COVERED_ROLES` guard are ready for it.
- `saveThreshold` semantics are "higher = spends save more readily" (matching
  the legacy `poisonSaveThreshold` direction), while `poisonThreshold` /
  `shootThreshold` are "higher = more evidence required". Documented in code;
  the consumer-wiring card should keep these directions straight.

## Recommendation to coordinator

Accept. Follow-up cards suggested: (1) wire `params` into
`actionSelector`/`useGameState`/`aiOrchestrator` behind the existing
difficulty system; (2) an `aiwolf-license-inquiry` task before any value may be
relabeled `'aiwolf-distilled'`.
