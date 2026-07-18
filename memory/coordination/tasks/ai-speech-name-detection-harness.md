# Task: ai-speech-name-detection-harness

## Status

Accepted

**Result summary (2026-07-17):** Bug reproduced offline and deterministically.
`npm run audit:speech-names` (= `SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/`)
FAILS as designed: fallback-dominant path 126 violations / 105 texts (all
library-sourced AIWolf names), mocked remote path 94, translation drift 3 —
identical counts across reruns. Static scan `node scripts/speech-corpus-name-audit.mjs`
exits 1 with 17,848 corpus entity refs (Agent-entry counts match coordinator
evidence exactly). `npm run test:run` 278 passed / 5 skipped (baseline 268 + 10
new detector tests, audit gated off); `npm run build` passes. H1/H2/H3(partial)/H5(channel)
CONFIRMED, H4/H6/H7 REFUTED, H8 UNTESTABLE-OFFLINE. Report:
`memory/coordination/reports/ai-speech-name-detection-harness.md`; 23 sanitized
samples in `.../ai-speech-name-detection-harness-samples/`.

## Objective

Build a reproducible, offline detection harness that catches AI speeches referencing wrong / out-of-roster player names, plus an evidence report that gives a falsifiable verdict on each hypothesis H1–H8 below. This card is DIAGNOSIS ONLY: no product-code fix. Its single audit command must FAIL on the current codebase (reproducing the bug) and is the exact command the follow-up fix card must turn green.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `src/services/speechLibrary.ts` (pick pipeline: self-reveal filter + language filter only — NO name filter)
- `src/ai/aiOrchestrator.ts` (3-layer speech generation, prompts inject `${player.id}号 ${player.name}`, hardcoded fallbacks)
- `src/services/translationService.ts` (display-layer translation, prompt has no roster protection, cache key = `logId:language`)
- `src/data/library_summary.json` (pool sizes; the `*_speeches.json` files are large — sample, do not read fully)
- `src/ai/evaluation.ts` + `src/ai/evaluation.test.ts` (existing deterministic offline replay harness — reuse its patterns: mock provider, zero network, fixed fixtures)
- `scripts/provider-dry-run.mjs` (existing zero-network dry-run script pattern)

## Context

- **Symptom (owner report):** AI speech references player names that do not match the current game roster.
- **Coordinator-verified evidence (trust, do not re-derive):**
  - Before 2026-07-17 every production game used the speech-library fallback (both Netlify functions 502'd silently since first deploy). Functions are live as of 2026-07-17.
  - The corpus `src/data/*_speeches.json` contains RAW AIWolf-log entities: ≥368 entries with `Agent[XX]` references (werewolf 100, villager 138, seer 83, possessed 47) and many Japanese personal names (Ryuji, Sakura, Yumi, Mio, George, Asuka, Benjamin, Servas, Smith, Midori, Shion, アレン, ハル, カナ, ユウ, ハナ, …). No name sanitization exists anywhere in the code.
  - `speechLibrary.ts` filters only wolf self-reveals and display language. `translationService.ts` prompt says "keep player references natural" with no roster list. `aiOrchestrator.ts` uses stable numeric player ids in prompts.
- **Hypotheses to test falsifiably (each gets a verdict: CONFIRMED / REFUTED / UNTESTABLE-OFFLINE, with evidence):**
  - H1: Corpus contains AIWolf leftover names / hardcoded seat refs that reach displayed text (quantify: counts per pool, per name class).
  - H2: Un-sanitized AIWolf samples are injected as few-shot examples into LLM prompts (trace every prompt-building site).
  - H3: Roster not fully passed to the model, or name↔seat mapping wrong in prompt construction.
  - H4: Array-index vs stable-playerId misalignment after deaths/reordering (e.g. `aliveGood[i % aliveGood.length]` style indexing in wolf-chat fallback).
  - H5: Translation layer rewrites player names/seat numbers.
  - H6: Cache key missing gameId/roster/speaker — prior-game or prior-speaker text reused (`translationCache` key is `logId:language`; check logId uniqueness across games; check `pools` module cache).
  - H7: API-failure fallback templates contain fixed names (audit `buildFallback` and wolf-chat hardcoded lines).
  - H8: The model itself hallucinates out-of-roster names in free text (offline: mark UNTESTABLE-OFFLINE unless dry-run evidence exists; do NOT make paid live calls).
- **Strict attribution rule (must be used in the report):** names appearing in the static library or prompt samples = "data un-sanitized / template pollution", NOT "model memory". Only actual fine-tuning could be training memory, and this project has none.
- **Call-chain confirmation:** document the real chain UI → aiOrchestrator → geminiAdapter → Netlify fn (provider-adapter / genai-proxy) → upstream → translation/fallback, using code tracing plus zero-network dry-runs (`ADAPTER_DRY_RUN`, `scripts/provider-dry-run.mjs` pattern). Never print keys or auth headers; no paid live calls without coordinator approval.
- **Determinism:** `speechLibrary` and fallbacks use `Math.random` — the harness must install a seeded PRNG (e.g. `vi.spyOn(Math, 'random')` with a mulberry32-style seed) so runs are reproducible.
- **Keeping the baseline green:** the audit assertions must NOT run inside plain `npm run test:run` (they would fail by design pre-fix). Gate them behind an env var (e.g. `describe.skipIf(!process.env.SPEECH_NAME_AUDIT)`), so the default suite stays at 268+ passing while the audit command fails.
- Scope boundary: no changes to any file under `src/` except NEW files in a new `src/diagnostics/` directory; no changes to corpus JSONs, services, orchestrator, or netlify functions.
- Dependencies: none.
- Parallel wave: wave 1, runs alone (sequential pipeline).

## Allowed changes

- `src/diagnostics/` (new directory: harness, detector utilities, fixed-roster fixtures, env-gated audit test files)
- `scripts/speech-corpus-name-audit.mjs` (new: static corpus scan, plain Node over the JSON files)
- `package.json` (ONLY adding npm script entries for the audit commands — no dependency changes)
- `memory/coordination/reports/ai-speech-name-detection-harness.md` (report)
- `memory/coordination/reports/ai-speech-name-detection-harness-samples/` (sanitized failure samples)

## Do not change

- `src/data/*_speeches.json`, `src/services/**`, `src/ai/**`, `src/gameEngine.ts`, `src/hooks/**`, `src/components/**`, `netlify/**` — this card diagnoses, it does not fix.
- Existing test files.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. A fixed test game exists as a fixture: fixed roster (ids, seats, names, roles for the 9p board), fixed seed. The harness generates ≥100 speeches offline through the REAL pipeline code (`generateAIDialogue`, `generateWolfChat`, vote-reason path of `generateAIAction`, and a last-words/fallback path), covering: day speech, wolf night chat, vote reasoning, last words.
2. Detector assertions implemented and applied to every generated text: (a) only current-roster players referenced; (b) every name/seat reference maps to the correct playerId/seat; (c) zero AIWolf entities (`Agent[XX]`, the known JA/EN personal-name list), zero prior-game players, zero template example names, zero nonexistent seat numbers (e.g. 10号 in a 9p game); (d) translation must not change referents — verified with a mocked translation response path (no network).
3. ONE documented audit command — `SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/` (or an equivalent single command wired as `npm run audit:speech-names`) — FAILS on the current codebase with a violation count > 0, and the card/report explicitly states: "this exact command must PASS after the fix card". `npm run test:run` (default, env unset) still passes 268+ with zero regressions.
4. `scripts/speech-corpus-name-audit.mjs` statically scans all `src/data/*_speeches.json` and prints per-pool violation counts (Agent refs, personal names, seat refs), exiting non-zero when violations exist — quantifying H1 exactly.
5. Sanitized failure samples (≥10, covering each speech context) saved under `memory/coordination/reports/ai-speech-name-detection-harness-samples/`: roster, speaker, phase, sanitized prompt, raw response, translated response, final text, and source (remote-model vs library vs hardcoded fallback). No secrets, no API keys, no auth headers.
6. The report gives each of H1–H8 an explicit verdict (CONFIRMED / REFUTED / UNTESTABLE-OFFLINE) with pointed evidence (file:line or sample id), applies the strict AIWolf attribution rule, includes the call-chain confirmation (dry-run based, zero paid calls), and ends with a ranked, minimal fix-scope recommendation for the fix card.
7. Harness is deterministic: two consecutive runs of the audit command produce identical violation counts.
8. `npm run build` succeeds.

## Verification

```bash
npm run test:run                                   # 268+ pass, zero regressions (audit gated off)
SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/  # MUST FAIL now (reproduces the bug); rerun → identical counts
node scripts/speech-corpus-name-audit.mjs          # non-zero exit, per-pool violation counts printed
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/ai-speech-name-detection-harness.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results (including the expected-failure output of the audit command), H1–H8 verdicts with evidence, decisions, residual risks, and a recommendation to the coordinator on the exact minimal fix scope for `ai-speech-roster-name-fix`.
