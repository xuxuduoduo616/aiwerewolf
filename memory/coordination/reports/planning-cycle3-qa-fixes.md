# Planning — Cycle 3: QA fixes (browser-verification-cycle2 follow-up)

Date: 2026-07-16 · Planner report.
Input: `memory/coordination/reports/browser-verification-cycle2.md` (baseline verified: 163/163 tests, build clean, unified provider adapter + i18n display translation on HEAD).

## Cards (one parallel wave — wave 3, non-overlapping paths)

| Card | Priority | Scope | Allowed paths |
|---|---|---|---|
| `tasks/dead-player-vote-autoresolve.md` | P0 | `DAY_VOTING` never auto-resolves when the human is dead; add `DAY_VOTING` branch to the phase driver calling `finishVote(null)` when the human has no vote | `src/hooks/useGameState.ts` + tests |
| `tasks/speech-quality-filter.md` | P1 | Leakage filter (wolf/possessed self-reveals in day picks; seer CO exempt) + display-language preference with fallback | `src/services/speechLibrary.ts` + tests |
| `tasks/en-display-translation-improvement.md` | P1 | EN mode: translate zh original instead of showing the canned fallback stub; "view original" affordance for this path | `src/components/LogMessage.tsx`, `src/i18n/index.ts`, `src/services/translationService.ts` (helper only) + tests |

All three may run concurrently — allowed paths do not intersect. Each card verifies with `npm run test:run` (163 baseline, zero regressions) + `npm run build`.

## Risks

1. **Vote auto-resolve double-fire** (card 1): the phase-driver effect re-runs on many dependencies; if the new `DAY_VOTING` branch does not respect the `isProcessingAI` gate/timeout cleanup, `finishVote` could fire twice and duplicate vote records. Card mandates a single-invocation acceptance criterion and explicit tests.
2. **Over-filtering the speech corpus** (card 2): aggressive leakage/language filters could empty small day-matched pools and degrade speech variety; card requires graceful fallback and forbids breaking the existing API (aiOrchestrator untouched).
3. **Stub false-positives** (card 3): stub detection must be exact-match/narrow-pattern (`Speaks based on game situation.`, `Pushes suspicion on Player N.`) so genuine English speeches are never replaced; zh mode must be provably unchanged.
4. **Shared test files**: cards 1 and 2/3 may each add tests; workers must create card-specific test files (or touch distinct existing ones) to avoid merge friction within the wave.
5. Environment note carried from QA (not carded): Vite watching `.claude/worktrees/**` triggers reloads during multi-agent runs; coordinator may want a separate low-priority card for `server.watch.ignored`.

## Recommendation

Dispatch all three in parallel. Review card 1 first on return (P0, gameplay-blocking).
