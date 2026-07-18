# Review: ai-speech-roster-name-fix

**Reviewer:** debugger
**Date:** 2026-07-17
**Baseline:** 7bc6557 (working-tree, uncommitted)
**Card:** `memory/coordination/tasks/ai-speech-roster-name-fix.md`
**Coder report:** `memory/coordination/reports/ai-speech-roster-name-fix.md`

## Verification commands (reproduced independently)

| Command | Result |
| --- | --- |
| `SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/` (run twice) | PASS both runs, 15/15; fallback-dominant `texts=105 violations=0`, remote-success `texts=39 violations=0` — deterministic |
| `node scripts/speech-corpus-name-audit.mjs` | Exit 0, TOTAL 0; pool counts 481/433/762/765/3142/2938 = 8,521 (matches report) |
| `npm run test:run` | 309 passed / 5 skipped (baseline 278 + 31 new; new = 17 rosterGuard + 8 aiOrchestrator + 5 translationService + 1 speechLibrary), zero regressions |
| `npm run build` | PASS (tsc + vite) |

## Boundary and detector integrity

- `git diff 7bc6557 -- src/diagnostics/` is **empty** — detector assertions,
  thresholds, entity list, fixtures all byte-identical to the accepted harness.
- All modified/created files are within Allowed changes. New
  `src/services/rosterGuard.test.ts` exists and runs (it is untracked-ignored
  by `.gitignore` `**/*.test.ts` — coordinator must `git add -f`, as the coder
  flagged).
- Refuted-hypothesis areas untouched, verified line-by-line in the diffs:
  H4 `aliveGood[i % aliveGood.length]` index math unchanged; H6 translation
  cache key still `` `${logId}:${language}` ``; H7 hardcoded fallback lines
  textually unchanged (only wrapped by the always-in-scope H8 guard). No
  refuted-hypothesis "fix" snuck in.
- The 3 extended test files: only import lines were rewritten (additively);
  no existing assertion deleted or modified.
- `src/services/speechLibrary.ts`, `gameEngine.ts`, `useGameState.ts`,
  `beliefTracker.ts`, `actionSelector.ts`, `netlify/**`, `package.json`
  untouched.

## Acceptance criteria 1–7

1. Gated audit PASSES with unmodified detector — verified, deterministic across two runs. **Met.**
2. Corpus script exit 0; `library_summary.json` matches actual per-pool entry counts exactly (probed); report states sanitized/dropped per pool. **Met.**
3. H1/H2/H3/H5 fixed, H4/H6/H7 skipped with refutation references; verified no code change exists for any refuted hypothesis. **Met.**
4. All 8 invariants each backed by ≥1 named unit test (mapping in coder report verified against the actual test files). **Met.**
5. `repairText` only substitutes seat-neutral placeholders or drops a contradicting name while keeping the seat; repair is accepted only if a detector re-run is clean, else `ok:false` and the caller falls through — detected-bad text cannot reach display. Nameless fallback lines tested detector-clean against any roster including empty. Never maps a foreign name to a playerId. **Met.**
6. Diagnostic metadata: `emitSpeechDiagnostic` is `console.debug` behind `speechDiagnosticsEnabled()` (vite dev only; false in tests/builds — tested); grep of `src/components/` + `src/hooks/` shows zero consumption; orchestrator return shape stays `{en, zh}`. **Met.**
7. 309 passed / 5 skipped, zero regressions; build green. **Met.**

## Corpus health (highest-risk area — 22.8% dropped)

Probed all 6 pools × rounds 0–6 (day range [round−1, round+1]) × zh/en with
the exact `pickSpeechFromEntries` pipeline (self-reveal filter included for
werewolf):

- **No pool/day/language combination is empty.** `pickSpeech` can only return
  '' on a fully empty/all-leaking pool; none exists.
- Worst combo overall: **bodyguard, round 6, zh — final pool = 4 entries**
  (baseline served 27 mixed-language entries here). This is the only <5 combo.
  Mitigating: `ROLE_FILE_MAP` maps only Werewolf/Villager/Seer/Witch/Hunter/
  Idiot → the bodyguard, medium, and possessed pools are **never loaded by
  product code** (dead data), so no gameplay impact.
- Worst combo among reachable pools (villager/werewolf/seer): seer round 6 zh
  = 7 zh entries; seer/medium round 6 en fall back to the mixed day pool
  (11–18 entries) exactly as pre-fix. No reachable combo degraded below the
  pipeline's own fallback thresholds.

## Sanitization quality and reproducibility

- Replayed `scripts/sanitize-speech-corpus.mjs` against `git show 7bc6557`
  originals in a /tmp replica: output **byte-identical** to all 6 working-tree
  JSONs + `library_summary.json`; per-pool stats table matches the coder
  report exactly (11,035 → 8,521; 6,490 sanitized; 2,514 dropped; residual
  bucket 0). Re-run on sanitized output is a **no-op** (idempotent).
- Sampled 18 original→sanitized pairs across all 6 pools: sentences remain
  coherent; placeholders are seat-neutral in the entry's language
  (那位玩家/另一位玩家, that player/the other player, あの人/もう一人), JA
  honorifics absorbed, EN sentence-start capitalization applied; **no
  concrete fake name and no playerId mapping anywhere**. A couple of EN
  vocative replacements read slightly stiff ("The other player any thoughts…")
  — cosmetic only.

## Output guard (`src/services/rosterGuard.ts`)

- Imports the accepted harness detector (guard and audit cannot disagree);
  entity/product name lists are plain alphanumeric/katakana (no regex-metachar
  construction risk); no throwing paths — all operations are precompiled-regex
  string transforms, `import.meta.env` accessed via optional chaining; guard
  cannot crash the pipeline.
- Wired into every display layer: LLM day speech (both language fields),
  library picks (+ suspect mention), wolf-chat LLM messages and library picks,
  vote reasons, hardcoded fallback → nameless line as last resort.
- Translation path: prompt enumerates protected seat referents;
  `translationViolatesReferents` is introduction-only (a dropped referent
  cannot point at a wrong player, preserving the existing summarizing-proxy
  contract); on violation `requestTranslation` returns '' and
  `translateLogText`'s `translated || text` + `.catch(() => text)` fall back
  to the original — never throws, never blocks rendering.

## Samples directory

9 regenerated post-fix samples: violations = 0 in every file, all required
fields present (roster/speaker/phase/prompt/rawResponse/translatedResponse/
finalText/source/violations), secret scan (api key / authorization / bearer /
sk-) clean. 14 stale files from the failing run correctly removed; `index.md`
consistent.

## Residual risks (flagged for coordinator, not blocking)

1. **Entity-list coverage gap (inherited from the accepted harness):**
   foreign names absent from the 69-name `aiwolf-entities.json` survive
   sanitization and are invisible to detector, guard, and audit alike.
   Measured in the reachable pools (standalone, boundary-accurate):
   villager 136 refs in 110/3142 entries, werewolf 146 refs in 121/2938,
   seer 40 refs in 31/765 — e.g. リサ, カイ, ケン, ミナ, リナ, アベル, トシ.
   These can still reach display via library picks. This card could not touch
   `src/diagnostics/` and correctly reused the accepted list, so it is out of
   scope here — but I recommend a small follow-up card: extend
   `aiwolf-entities.json`, then re-run the (deterministic, idempotent)
   sanitizer and the audit.
2. `src/services/rosterGuard.test.ts` needs `git add -f` when committing
   (`.gitignore` `**/*.test.ts`) — already flagged by the coder.
3. `nameDetector.ts` header comment ("nothing here is imported by product
   code") is now stale — one-line follow-up, already flagged by the coder.
4. H8 live-model hallucination coverage rests on the output guard, not
   offline proof (explicitly accepted by the card).

All /tmp probes created during this review were deleted.

VERDICT: PASS
