# Report: ai-speech-name-detection-harness

**Status:** Ready for review
**Date:** 2026-07-17
**Card:** `memory/coordination/tasks/ai-speech-name-detection-harness.md` (DIAGNOSIS ONLY — no product code changed)

## Summary

The owner-reported symptom (AI speeches referencing player names not on the current
roster) is reproduced offline, deterministically, with zero network and zero paid
calls. Root cause is **template pollution**: the AIWolf-scraped corpus in
`src/data/*_speeches.json` contains 17,848 out-of-roster entity references
(`Agent[XX]`, JA/EN personal names), and no layer between corpus pick and display
performs any roster/name sanitization. On the production-dominant pre-2026-07-17
path (LLM 502 → speech-library fallback), a fixed 105-speech audit run yields
**126 violations**, all sourced from the library layer, across day speech,
last words, and wolf night chat. The remote-LLM path and the translation path also
have **no roster guard** (mocked-response audits: 94 and 3 violations respectively).

The single audit command below FAILS on the current codebase and is the exact
command the fix card must turn green:

```bash
npm run audit:speech-names        # = SPEECH_NAME_AUDIT=1 vitest run src/diagnostics/
```

## Changed / created files

- `src/diagnostics/aiwolf-entities.json` — shared known-entity list (34 Latin + 35 katakana names) built from a full corpus scan
- `src/diagnostics/nameDetector.ts` — detector: Agent refs, AIWolf names, out-of-roster seats/names, name↔seat pair check, translation referent drift
- `src/diagnostics/fixtures.ts` — fixed 9p roster fixture (seat→role→name identical to `startGame` assignment) + mulberry32 PRNG + fixed seed
- `src/diagnostics/speechAuditHarness.ts` — drives the REAL `generateAIDialogue` / `generateWolfChat` / `generateAIAction`(VOTE) / last-words paths; 105 texts per run
- `src/diagnostics/nameDetector.test.ts` — ungated detector unit tests (10 tests, always run, keep the audit trustworthy)
- `src/diagnostics/speechNameAudit.test.ts` — env-gated audit (`describe.skipIf(!process.env.SPEECH_NAME_AUDIT)`), fetch stubbed (blocked / mocked success / mocked translation), Math.random seeded via `vi.spyOn`
- `scripts/speech-corpus-name-audit.mjs` — plain-Node static corpus scan (H1), exits non-zero on violations
- `package.json` — added `audit:speech-names`, `audit:speech-corpus` script entries only
- `memory/coordination/reports/ai-speech-name-detection-harness-samples/` — 23 sanitized samples + `index.md`
- This report. Card status updated to Ready for review.

No file under `src/` outside `src/diagnostics/` was touched; no corpus JSON, service, orchestrator, netlify, or existing test file was modified.

## Verification commands and results

| Command | Result |
| --- | --- |
| `npm run test:run` (gate off) | PASS — 278 passed, 5 skipped (baseline 268 + 10 new detector tests; audit suite skipped; zero regressions) |
| `SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/` | **FAILS as designed** — 4 failed / 11 passed. Fallback-dominant: `texts=105 violations=126 byKind={"aiwolf-name":126} byContext={"day-speech":88,"last-words":14,"wolf-chat":24} bySource={"library":126}`. Remote-success: `texts=39 violations=94 byKind={"agent-ref":34,"aiwolf-name":34,"out-of-roster-seat":26}`. Translation drift: 3. Prompt-contamination assertions also fail (see H2). |
| Rerun of the audit (determinism) | Identical counts on consecutive runs (126 / 94 / 3); in-suite double-run determinism test PASSES (identical per-sample final texts) |
| `node scripts/speech-corpus-name-audit.mjs` | Exit 1 — per-pool counts below; TOTAL 17,848 |
| `npm run build` | PASS (tsc + vite) |

**This exact command must PASS after the fix card:** `npm run audit:speech-names`
(equivalently `SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/`).

### Static corpus scan (per pool)

| pool | entries | Agent entries/refs | name entries/refs | out-of-range seats | total refs |
| --- | --- | --- | --- | --- | --- |
| bodyguard | 608 | 0 / 0 | 516 / 971 | 0 | 971 |
| medium | 601 | 0 / 0 | 467 / 983 | 0 | 983 |
| possessed | 911 | 47 / 84 | 703 / 1,235 | 0 | 1,319 |
| seer | 1,001 | 83 / 196 | 749 / 1,507 | 0 | 1,703 |
| villager | 4,089 | 138 / 280 | 3,261 / 6,404 | 0 | 6,684 |
| werewolf | 3,825 | 100 / 296 | 2,958 / 5,892 | 0 | 6,188 |
| **TOTAL** | 11,035 | **368 / 856** | **8,654 / 16,992** | **0** | **17,848** |

Agent-bearing entry counts match the coordinator-verified numbers exactly
(werewolf 100, villager 138, seer 83, possessed 47). 78–80% of the two biggest
pools carry at least one foreign personal name. Top names: Benjamin, Asuka,
Servas, Ryuji, George, Daisuke, Minato + katakana サクラ/ミオ/ジョナサン etc.

## H1–H8 verdicts

**H1 — corpus leftovers reach displayed text: CONFIRMED.**
Counts above (script output). Runtime proof: fallback-dominant audit produced 126
violations in 105 speeches, all `source: library` — e.g. sample-01 (zh day speech,
final text `シュンイチの、早い断定への警戒＝ミオ庇い扱いは雑に見える。（关注2号）`)
and sample-07 (wolf chat naming Minato/Servas/Yumi in a Luna/Marcus/... roster).
`speechLibrary.ts` filters only wolf self-reveals (lines 33–47) and display
language (lines 11–22, 123–124); there is **no name filter anywhere** in the pick
pipeline (`pickSpeechFromEntries`, lines 98–135). Library text reaches display via
`aiOrchestrator.ts:188–206` (day/last-words) and `:335–367` (wolf chat, rendered
raw by `WolfChannel.tsx` with no translation pass).

**H2 — un-sanitized AIWolf samples injected into LLM prompts: CONFIRMED (via log
context, not few-shot).**
Every prompt-building site was traced: `aiOrchestrator.ts` builds all runtime
prompts (`generateAIDialogue` 142–172, `generateAIAction` 247–252,
`generateWolfChat` 290–305); none embeds corpus entries as few-shot examples.
However `fmtLogs` (aiOrchestrator.ts:39–40) injects the last 16 log messages
verbatim, and prior library picks live in those logs — the failing audit test
"LLM prompts contain no AIWolf entities" proves `Agent[04]` and `サクラ` from a
prior speech reach the outgoing LLM prompt (speechNameAudit.test.ts, captured
request body). `translationService.ts:92` likewise sends raw corpus text to the
model. So pollution recycles into every subsequent LLM call.

**H3 — roster not fully passed / mapping wrong: CONFIRMED (partial).**
No wrong mapping found: `${player.id}号 ${player.name}` (aiOrchestrator.ts:145,149)
is the speaker's own correct pair, and `fmtPlayers` (45–52) lists correct live seat
ids. But the roster is **not fully passed**: other players' names never appear in
any speech prompt, and the translation prompt (`translationService.ts:92`) carries
**no roster at all** — so no downstream layer can validate names. Mitigated only by
the prompt instruction to use numeric references (aiOrchestrator.ts:163,171).

**H4 — array-index vs playerId misalignment: REFUTED.**
The only index-style pick, `aliveGood[i % aliveGood.length]`
(aiOrchestrator.ts:341), indexes a freshly-filtered alive list and then uses
`target.id` — always a valid current seat. `lines[player.id % lines.length]`
(408, 424) selects templates, not targets. Audit evidence: zero
`out-of-roster-seat` or `wrong-name-seat-pair` violations on the fallback path
(byKind = aiwolf-name only), across 105 texts including post-death last-words.

**H5 — translation layer rewrites referents: CONFIRMED as an unguarded channel;
live rewrite frequency UNTESTABLE-OFFLINE.**
`translationService.ts` has no referent protection: the prompt (line 92) says only
"keep player references natural" with no roster list, and the response is returned
verbatim (`requestTranslation` → `translateLogText`, lines 85–132). The failing
audit test proves a referent-rewriting mocked response (3号 → Player 5 + Sakura +
Agent[03]) reaches display unchecked — sample-23. Whether the real Gemini model
actually rewrites referents in production cannot be measured without paid calls.

**H6 — cache reuse across games/speakers: REFUTED.**
`translationCache` key is `` `${logId}:${language}` `` (translationService.ts:113)
and the module-level cache is never cleared between games in product code
(`clearTranslationCache` line 80 is a test hook with no product call site). But
log ids are `` `${Date.now()}-${Math.random()}` `` (useGameState.ts:301) —
effectively unique per entry, so cross-game/speaker key collisions do not occur in
practice. The `pools` cache (speechLibrary.ts:57) caches only static corpus data,
never game-specific text. Not a cause of the symptom.

**H7 — fallback templates contain fixed names: REFUTED.**
`buildFallback` (aiOrchestrator.ts:372–427) and the wolf-chat hardcoded lines
(345–357) reference only `${suspect.id}号` / `Player ${id}` derived from the live
roster; the vote-reason templates (actionSelector.ts:36–140) are seat-id based.
Audit evidence: sample-10 (vote-reason, selector-reason) has zero violations, and
no `hardcoded-fallback`-sourced violation appeared in any run.

**H8 — model hallucinates out-of-roster names: UNTESTABLE-OFFLINE.**
No live calls were made (none permitted). What IS confirmed offline (mocked
success): if the model emits an out-of-roster reference — hallucinated or echoed
from polluted context (H2) — nothing catches it: `geminiAdapter.ts` validates only
JSON shape (`extractJson`, 75–82) and `aiOrchestrator` only language/length
(177–185), never roster membership (samples 11–22, 94 violations).

**Strict attribution rule (applied throughout):** every name observed in output
traces to the static library or to prompt/context propagation of that library —
"data un-sanitized / template pollution", NOT "model memory". This project does no
fine-tuning, so training-memory explanations are categorically excluded.

## Call-chain confirmation (offline, zero paid calls)

UI (`useGameState.ts:594` day/last-words, `:429` wolf chat, `:635` vote →
`LogMessage.tsx:35` display translation) → `aiOrchestrator.ts` (dynamic import,
58–80) → `geminiAdapter.ts` → POST `/.netlify/functions/provider-adapter`
(geminiAdapter.ts:15,58) then fallback POST `/.netlify/functions/genai-proxy`
(16, 67) → on failure `''` → library (`pickSpeech`) → hardcoded fallback.
Confirmed by the harness's captured fetch requests: each blocked LLM attempt hits
provider-adapter then genai-proxy in order before the library layer produces the
final text (samples record the exact outgoing prompts). Consistent with the
existing zero-network pattern in `scripts/provider-dry-run.mjs` (ADAPTER_DRY_RUN);
no keys or auth headers are ever printed — client-side prompts contain none, and
`sanitizePrompt` redacts defensively.

## Decisions

- Detector name list built from a full-corpus frequency scan (not just the card's
  examples); ambiguous "May" excluded from the Latin list (katakana メイ retained)
  to avoid false positives — documented in `aiwolf-entities.json`.
- Layer classification (`library` vs `hardcoded-fallback`) uses the closed set of
  distinctive hardcoded template fragments rather than mocking the library —
  keeping the pipeline 100% real.
- Static scan treats seats 1–12 as in-range (no supported board exceeds 12);
  per-board 10–12-in-9p violations are runtime facts covered by the vitest audit.
  The corpus contains zero out-of-range static seat refs — pollution is names, not
  numbers.
- Determinism: single fixed seed `0x5eed2026` (mulberry32 via `vi.spyOn`),
  fresh `globalBeliefTracker.init` per run, fixed roster.

## Residual risks

- Katakana/Latin boundary heuristics could miss novel corpus names outside the
  69-name list; the list covers all names with ≥4 corpus occurrences found by the
  scan. The fix card should reuse `aiwolf-entities.json` as its sanitization list.
- The audit samples directory is rewritten on each gated run (deterministic
  content); it is inert otherwise.
- H5/H8 live-model behavior remains unmeasured (requires owner-approved paid
  probes); the pipeline-level absence of guards is proven regardless.

## Recommended minimal fix scope for `ai-speech-roster-name-fix` (ranked)

1. **Library sanitization (fixes ~all 126 fallback-path violations):** in
   `speechLibrary.ts` pick pipeline, sanitize picked text against
   `aiwolf-entities.json` + `Agent[XX]` — replace entity tokens with roster-valid
   seat refs or neutral wording, or reject the entry and re-pick. Do NOT drop
   polluted entries wholesale (would remove ~78% of the two largest pools).
2. **Remote-response roster guard:** in `aiOrchestrator.ts`, run the accepted LLM
   text through the detector before returning; on violation fall through to the
   (post-fix) library layer.
3. **Context hygiene (H2):** apply the same sanitizer to `fmtLogs` output so
   pre-fix logs / any residual pollution cannot recycle into prompts.
4. **Translation guard (H5):** add the roster to the translation prompt and
   post-check with `detectTranslationReferentDrift`; return the original text on
   drift.
5. No changes needed for H4/H6/H7 paths.

Acceptance for the fix card: `npm run audit:speech-names` passes;
`node scripts/speech-corpus-name-audit.mjs` may remain red if fixing at pick-time
(runtime sanitization) rather than rewriting the corpus — the coordinator should
decide which layer owns the invariant and adjust that script's role accordingly.
