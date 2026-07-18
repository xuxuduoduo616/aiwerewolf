# Project Coordination State

**Last verified:** 2026-07-18
**Project phase:** Cycles 1–7 complete (26 cards Accepted) + memory governance (ADR-001) + sync-project-memory skill (Phase B). DEPLOYED 2026-07-18: production = a027296 (asset index-BOYeqKxJ.js, functions 204, live Gemini OK, zero key patterns in bundle).

## Verified Baseline

- Local tests: `npm run test:run` — **363 passed / 5 skipped** (30 files), zero regressions. `npm run build` succeeds. Both speech audits green (`npm run audit:speech-names` 0 violations; corpus scan exit 0).
- Local HEAD = origin/main = production = `a027296` (asset `index-BOYeqKxJ.js` verified live 2026-07-18).
- Round 7 Chrome verification: vote pill full `10s→0s` sequence captured; timeout → abstain (never random vote) verified 3×; TTS `speaking=true`, consent-gated prefs persisted; 2 full games completed. Evidence: `reports/browser-verification-tts-vote/`.
- Round 7 residuals (queued in ROADMAP): sanitization placeholder residue ("that player") displayed literally; EN-heavy fallback speech in zh mode; 5 katakana names uncovered by entity list.

## Completed (cycles 1–6: 2026-07-16; round 7: 2026-07-17~18)

| Cycle | Cards | What |
|-------|-------|------|
| 1 | 4 | provider-adapter-refactor (unified protocol-aware adapter), language-switch-and-ai-translation (zh/en pill + display-layer translation), role-behavior-distillation (behaviorSchema with honest source labeling), ai-role-evaluation (offline replay harness + 4 metrics) |
| 2 | 3 | runtime-model-routing (frontend → provider-adapter fallback chain), model-routing-cost-guard (daily budget $1/day, UTC rollover, 402+fallback on exhaustion), provider-adapter-dry-run (zero-network in-process dry-run script) |
| 3 | 3 | dead-player-vote-autoresolve (P0 fix: dead human DAY_VOTING no longer stalls), speech-quality-filter (wolf/possessed self-reveal exclusion + language preference), en-display-translation-improvement (Seer stub detection, EN → zh fallback) |
| 4 | 1 | night-pipeline-exception-safety (owner-reported P0: permanent "AI思考" stall — try/finally around all isProcessingAI blocks, guarded dynamic imports, 12s fetch timeouts) |
| 5 | 1 | lobby-language-authority (P1 fix: in-game pill removed, lobby sole language authority, EN games produce full native English AI speech from all 3 layers + wolf chat, zh unchanged, 231 tests) |
| 6 | 9 | UI optimization: P0 speech-timer-autoskip-fix (human stall fix), action-bar-i18n (KILL→刀人 etc.), lobby-difficulty-i18n (Beginner/Intermediate/Expert), dead-player-card-readability, speech-input-placeholder-i18n, header-icon-tooltips (aria-labels), quick-speech-buttons (7 presets, X号 tap-to-fill), phase-labels-i18n (12 phase keys EN), player-card-speaking-status (已发言checkmark badges) |
| 7 | 5 | netlify-functions-cjs-fix (prod 502 fix, DEPLOYED), ai-speech-name-detection-harness + ai-speech-roster-name-fix (corpus 17,848→0 entity refs, output guard, DEPLOYED c670193), vote-countdown-diagnosis-and-fix (10s deadline timer, abstain timeout), browser-tts-mvp (Web Speech API read-aloud), cloud-tts-adapter-spike (research only) |

## Provider Infrastructure

| Provider | Protocol | Status |
|---|---|---|
| aicodemirror API | Anthropic Messages + Codex backend + Google Gemini | Endpoints confirmed reachable. All require auth keys (x-api-key or Bearer). No live calls made. Model IDs NOT enumerated (require authenticated access). |
| deepseek API | Anthropic Messages compatible | Reachable. `POST /anthropic/v1/messages` parses Anthropic-style auth. No live calls. |
| vibecoder.store | Unknown | TLS handshake reset from this network. Unreachable. |

**Unified provider-adapter.js** (Netlify function) supports gemini / anthropic-messages / openai-chat protocols with circuit breaker, cost guard, per-call ceiling, daily budget accumulator, ADAPTER_DRY_RUN mode, redacted logging. Frontend routes through it first, falling back to genai-proxy, then speech library.

## AIWolf Data

No AIWolf data downloaded — license unclear, organizer contact recommended for commercial use. Role mismatch confirmed: AIWolf has NO Witch, NO Hunter, NO Idiot. All behavioral parameters labeled 'synthetic' or 'heuristic' (never 'aiwolf-distilled'). Schema honesty enforced by test.

## Budget

- Runtime AI uses gemini-2.5-flash (~$0.00015/1k tokens). Budget guard caps at $1/day/instance.
- Rough estimate: ~$0.01–0.03 per game. $25 supports ~800–2500 games.
- No paid API calls made this session (all dry-run or local-fallback).

## Key Browser Findings (Cycle 2–3 QA)

- Guest flow ✅, language toggle ✅ (zh/en pill, localStorage), VoteSummary structured component ✅ (verified rendering — previous "flat text" report refuted).
- P0 bug FIXED: dead human stall in DAY_VOTING — auto-resolves now.
- Speech quality improved: wolf self-reveals excluded; language preference applied.
- EN display mode: Seer report canned stub routed to zh original.

## Not Completed / Out of Scope

- AIWolf raw data download & distillation (license gate — owner/legal decision).
- vibecoder.store integration (network unreachable — retry later).
- Wolf teammate badge browser coverage (random role assignment — not exercised in QA; unit tests pass).
- No live provider calls made (all keys missing, dry-run only). Provider discovery gated on key availability.
- Speech library: 8,521 entries post-sanitization (was 11,035; 6,490 sanitized / 2,514 dropped); Witch/Hunter/Idiot reuse Seer/Villager pools.
- Full browser E2E playthrough of all roles/boards not completed (QA exercised 9p and 12p as guest, 2 games).

## Deployment Status

- Gemini path working in production (API_KEY configured); $1/day budget guard active.
- Production = `a027296` (verified 2026-07-18): vote countdown, browser TTS, memory governance (ADR-001), sync-project-memory skill, key-privacy sweep all live.
- Historical deploy narratives: git log + `reports/netlify-functions-cjs-fix.md`.
- Still owner-gated: AICODEMIRROR/DEEPSEEK keys in Netlify env; ADAPTER_DAILY_BUDGET_USD tuning; any Supabase Dashboard change.

## Coordinator Rules

- Same as before. No deployment, push, or external service mutation without owner approval.
