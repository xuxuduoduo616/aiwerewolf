# Review: ai-speech-name-detection-harness

**Reviewer:** aiwerewolf-debugger
**Date:** 2026-07-17
**Card:** `memory/coordination/tasks/ai-speech-name-detection-harness.md`
**Coder report:** `memory/coordination/reports/ai-speech-name-detection-harness.md`

All verification was reproduced independently on the uncommitted working tree.

## Scope check (git status / diff)

- Only tracked-file modification: `package.json` — diff contains exactly two new
  script entries (`audit:speech-names`, `audit:speech-corpus`); dependencies and
  devDependencies untouched. PASS.
- New files: `src/diagnostics/` (6 files), `scripts/speech-corpus-name-audit.mjs`,
  the report, 23 samples + `index.md`, and the card itself (Status update allowed).
  All within Allowed changes.
- No touch of `src/services/**`, `src/ai/**`, `src/data/**`, `netlify/**`,
  existing tests, or `PROJECT_STATE.md` (git status shows zero modifications
  there). Other untracked entries in the tree (`.agents/`, `.codex/`,
  `.env.example`, `.mcp.json`, `.playwright-mcp/`, `Werewolf copy/`,
  `screenshots/`, the plan doc, and the follow-up fix card) all carry mtimes
  predating this task's work window (Jul 3 – Jul 17 23:59 vs harness files
  Jul 18 00:12+) — pre-existing workspace/coordinator artifacts, not this card's
  changes. PASS.

## Reproduced verification

| Command | My result | Matches claim |
| --- | --- | --- |
| `npm run test:run` | 278 passed / 5 skipped, 26 files passed / 1 skipped, zero failures; audit suite skipped by default (`describe.skipIf(!AUDIT_ENABLED)`, speechNameAudit.test.ts:132) | Yes (baseline 268 + 10 new detector tests; no existing test file modified, so baseline is unchanged by construction) |
| `npm run audit:speech-names` run 1 | FAILS: 4 failed / 11 passed. Fallback-dominant: texts=105 violations=126 byKind={aiwolf-name:126} byContext={day-speech:88,last-words:14,wolf-chat:24} bySource={library:126}. Remote-success: 94 (agent-ref 34, aiwolf-name 34, out-of-roster-seat 26). Translation drift: 3 (sample-23) | Yes |
| `npm run audit:speech-names` run 2 | Exit code 1; identical counts (126 / 94 / 3); in-suite double-run determinism test passed | Yes — deterministic |
| `node scripts/speech-corpus-name-audit.mjs` | Exit 1; per-pool counts printed; TOTAL 17,848; Agent-bearing entries werewolf 100, villager 138, seer 83, possessed 47 — exact match with coordinator evidence | Yes |
| `npm run build` | tsc + vite success | Yes |

## Acceptance criteria

1. **Fixture + real pipeline, ≥100 texts, 4 contexts — PASS.**
   `src/diagnostics/fixtures.ts` — fixed 9p roster (3 villagers / 3 wolves /
   seer-witch-hunter), names assigned exactly like `startGame`
   (`AI_NAMES[index % AI_NAMES.length]`, verified against
   `src/hooks/useGameState.ts:326` and `src/constants.ts:36`), fixed seed
   `0x5eed2026`, mulberry32 PRNG. `speechAuditHarness.ts` imports and calls the
   REAL `generateAIDialogue`, `generateWolfChat`, `generateAIAction('VOTE')`
   from `src/ai/aiOrchestrator.ts` (lines 20, 191, 210, 224, 245) — no
   reimplementation. 105 texts on the fallback run: 54 day speeches, 6
   last-words (dead speakers through the same generateAIDialogue path), 18
   wolf-chat messages, 27 vote reasons.
2. **Detector assertions — PASS.** `nameDetector.ts` covers (a) roster-only
   seats/names, (b) name↔seat pair correctness, (c) Agent[XX] + 69-name AIWolf
   JA/EN list + off-roster product names + nonexistent seats, (d)
   `detectTranslationReferentDrift` applied to a mocked translation response.
   Applied to every generated text (speechAuditHarness.ts:179).
3. **Single failing audit command — PASS.** `npm run audit:speech-names`
   (= `SPEECH_NAME_AUDIT=1 vitest run src/diagnostics/`) fails with
   violations > 0; report states the exact must-pass-after-fix sentence
   (report lines 20–25, 52–53); default suite green.
4. **Static corpus scan — PASS.** Per-pool counts printed, exit 1, quantifies
   H1 exactly; zero-dependency plain Node; shares the entity list with the
   runtime detector (`src/diagnostics/aiwolf-entities.json`).
5. **Samples — PASS.** 23 samples, all four contexts covered on both paths;
   every required field present (roster, speaker, phase, sanitized prompt, raw
   response, translated response, final text, source). Grep of the samples dir
   and report for `sk-`, `api key`, `Bearer`, `authorization` found nothing;
   prompts are client-side only and pass through `sanitizePrompt`.
6. **Report H1–H8 — PASS.** Every hypothesis has an explicit verdict with
   file:line or sample-id evidence; I spot-checked the citations
   (`fmtLogs` aiOrchestrator.ts:38–39, prompt roster at :145/:149,
   `aliveGood[i % aliveGood.length]` at :341, `buildFallback` at :372+,
   translation prompt translationService.ts:92, cache key :113, log id
   useGameState.ts:301) — all accurate (fmtLogs cited as 39–40 vs actual
   38–39, a one-line drift, immaterial). Strict AIWolf attribution rule applied
   (report lines 145–148). Call-chain confirmation present and consistent with
   the code. Ranked minimal fix-scope recommendation present (5 items).
7. **Determinism — PASS.** Verified by my own two consecutive runs plus the
   in-suite double-run test comparing per-sample final texts.
8. **Build — PASS.**

## Detector soundness (10 samples reproduced and judged)

True positives, no false positives found:

- sample-01: ミオ / シュンイチ in a Luna–Jasper roster — TP (library pick).
- sample-02: サクラ — TP.
- sample-04: メイ / ダイスケ — TP.
- sample-05: Servas ×2 / Midori — TP.
- sample-07: Minato / Servas / Yumi in wolf chat — TP.
- sample-08: Takumi — TP (note: "May" in the same text deliberately not
  flagged; documented conservative exclusion in aiwolf-entities.json —
  under-flagging one ambiguous token, the safe direction).
- sample-10: selector vote reason, zero violations — correct negative
  (seat-number-only text not flagged).
- sample-20: サクラ + Agent[02] — TP; in-roster "5号" correctly not flagged.
- sample-23: translation drift introduces seat 5 / Sakura / Agent[03] — TP;
  seat 3 correctly considered preserved because `Agent[03]` counts as a seat-3
  ref.
- Boundary handling verified by ungated unit tests (Ring≠Rin, Karina≠Rina,
  タクシー≠タク) and by inspection of the lookbehind/lookahead regexes; roster
  names are skipped before flagging (`rosterNames.has(name)` guards at
  nameDetector.ts:97, 121). No legitimate roster name, in-board seat number,
  or common Chinese word can be flagged. The detector does not overflag.

## Zero network

Every gated test installs a fetch stub via `vi.stubGlobal` before driving the
pipeline (blocked stub throws; success stub returns canned payloads);
`afterEach` restores. The blocked-path run completes in ~500 ms with 105 texts
— no live call possible. No API keys are read, printed, or present in any
artifact.

## Minor observations (non-blocking)

- `nameDetector.test.ts` is ungated (always runs). The card's Allowed list says
  "env-gated audit test files", but these 10 tests validate the detector itself,
  keep the audit trustworthy, and keep the default suite green — consistent
  with intent and with acceptance criterion 3.
- The samples directory is rewritten on each gated run (declared in the report;
  deterministic content, inert otherwise).
- Report's `fmtLogs` citation is off by one line (39–40 vs 38–39).

VERDICT: PASS
