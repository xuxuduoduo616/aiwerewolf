# Task: ai-speech-roster-name-fix

## Status

Queued

## Objective

Evidence-driven, minimal fix so that no displayed AI speech ever references a player outside the current game roster — covering corpus sanitization, roster-scoped prompting, translation name protection, cache isolation, and a final output guard — turning the detection harness's failing audit command green. Exact fix scope is finalized from the evidence report of `ai-speech-name-detection-harness`; only CONFIRMED hypotheses get code changes.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ai-speech-name-detection-harness.md` (evidence report — defines which fixes below are in scope)
- `memory/coordination/reports/ai-speech-name-detection-harness-samples/` (failure samples)
- `src/services/speechLibrary.ts`, `src/ai/aiOrchestrator.ts`, `src/services/translationService.ts`
- `src/diagnostics/` (the harness this card must satisfy — do not weaken it)

## Context

- **Prerequisite:** `ai-speech-name-detection-harness` is Accepted. Its audit command currently FAILS; this card's success is defined as making that exact command PASS without modifying the harness's assertions.
- **Scope selection rule:** implement fixes ONLY for hypotheses the evidence report marks CONFIRMED. The candidate fix areas below are ordered by expected likelihood; skip any the report refutes, and record the skip + reason in this card's report. If the report surfaces a confirmed cause outside this list, escalate to the coordinator (Blocked) rather than expanding scope silently.
- **Candidate fix areas (from coordinator-verified evidence):**
  - H1 corpus pollution: sanitize `src/data/*_speeches.json` — replace `Agent[XX]` / known AIWolf personal names with role-ized placeholders, or drop the entry when sanitization would gut it. Prefer a repeatable script (`scripts/sanitize-speech-corpus.mjs`) that writes the cleaned JSONs, so the transform is auditable and re-runnable; commit the cleaned data. NOT ad-hoc string replace to arbitrary playerIds — a foreign name must never be mapped onto a real roster player.
  - H2/H3 prompt hygiene: model receives only the current game's canonical roster; any sample/few-shot text included in prompts must be sanitized or removed.
  - H4 index misalignment: replace any array-index-derived player references with stable-playerId lookups (e.g. wolf-chat fallback `aliveGood[i % aliveGood.length]` if confirmed).
  - H5 translation protection: translation prompt must enumerate protected tokens (seat numbers `N号`/`Player N`, roster names) and the result must be verified to preserve referents; on violation, fall back to the original text.
  - H6 cache isolation: any cache whose entries can leak across games/rosters/speakers/languages gets a key including game/roster identity (translation cache `logId:language` — fix only if the harness confirmed cross-game logId collisions).
  - H7 fallback templates: hardcoded fallback lines must reference only roster-derived `${id}号`/`Player ${id}` — no fixed names.
  - H8 output guard (always in scope): a final-boundary check on every displayed speech (LLM, library, and fallback layers): if out-of-roster references are detected → structural-reference repair when unambiguous, else drop to a nameless/safe fallback line. Never display the bad text; never map a foreign name to a guessed playerId.
- **Fix invariants (all must hold):**
  1. Internal identity = stable playerId; seat/displayName resolved only at boundaries.
  2. Model receives only the current game's canonical roster.
  3. Corpus names sanitized to role-ized placeholders or the entry filtered — never masked by wrong-playerId string replacement.
  4. Translation protects player names / seat numbers / structured references.
  5. Any cache is isolated by game/roster/speaker/phase/language.
  6. Final displayed text contains zero out-of-roster player references; on detection → safe retry / structural repair / nameless fallback — never show the bad text.
  7. No game-rule changes; the LLM never decides identity/vote/skill legality.
  8. Diagnostic metadata (source/provider/model/fallbackReason/requestId — no secrets) is available in dev diagnostics (console/dev-only), never shown to players.
- Scope boundary: expression layer only (corpus data, speechLibrary, aiOrchestrator prompts/fallbacks, translationService, new guard utility + tests). `gameEngine.ts`, `beliefTracker.ts`, `actionSelector.ts` rule logic untouched.
- Dependencies: `ai-speech-name-detection-harness` (Accepted).
- Parallel wave: wave 2, runs alone.

## Allowed changes

- `src/data/*_speeches.json` (sanitization output only, via script)
- `scripts/sanitize-speech-corpus.mjs` (new)
- `src/services/speechLibrary.ts`
- `src/ai/aiOrchestrator.ts`
- `src/services/translationService.ts`
- New guard/sanitizer utility + its tests (e.g. `src/services/rosterGuard.ts`, `src/services/rosterGuard.test.ts`)
- Existing test files for the three services above (extend only; do not delete existing assertions)
- `src/diagnostics/` fixtures ONLY if the report identifies a harness fixture bug — detector assertions and thresholds must NOT be weakened, and any such change must be justified in the report

## Do not change

- `src/gameEngine.ts`, `src/hooks/useGameState.ts`, `src/ai/beliefTracker.ts`, `src/ai/actionSelector.ts` (rule logic frozen).
- `netlify/**` functions, `package.json` dependencies, deployment configuration.
- Detection-harness assertion logic (weakening the detector to pass is an automatic FAIL).
- Unrelated code, credentials, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. The harness audit command that failed before this card now PASSES: `SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/` (equivalently `npm run audit:speech-names`) reports zero violations, with unmodified detector assertions.
2. `node scripts/speech-corpus-name-audit.mjs` exits 0: zero `Agent[XX]` references and zero known AIWolf personal names remain in `src/data/*_speeches.json`; `src/data/library_summary.json` counts updated if entries were dropped, and the report states entries dropped vs sanitized per pool.
3. Every CONFIRMED hypothesis from the evidence report has a corresponding minimal fix; every skipped candidate area is listed with its refutation reference. No fix exists for a refuted hypothesis.
4. All eight fix invariants demonstrably hold, each backed by at least one unit test (roster-only prompting, translation referent preservation with mocked responses, cache isolation, output guard repair/fallback behavior, no fixed names in fallback templates).
5. The output guard never maps a foreign name onto a real playerId and never lets detected-bad text reach the display path; nameless fallback lines are roster-safe by construction.
6. Diagnostic metadata (source/provider/model/fallbackReason — no secrets) is attached to generated speeches in dev diagnostics only; player-visible UI is unchanged apart from corrected speech text.
7. `npm run test:run` passes 268+ prior tests plus all new tests, zero regressions; `npm run build` succeeds.

## Verification

```bash
npm run test:run                                     # 268+ prior + new tests, zero regressions
SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/  # MUST PASS now (was failing before this card)
node scripts/speech-corpus-name-audit.mjs            # exit 0, zero corpus violations
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/ai-speech-roster-name-fix.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, per-hypothesis fix/skip mapping with evidence references, corpus sanitization stats (entries sanitized/dropped per pool), verification commands and results (before/after audit output), decisions, residual risks (explicitly: H8 live-model hallucination coverage depends on the output guard, not offline proof), and a recommendation to the coordinator.
