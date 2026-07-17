# Project Coordination State

**Last verified:** 2026-07-17
**Project phase:** Session cycles 1–6 complete (22 cards Accepted, 268 tests). Netlify pipeline restored; functions-502 fix (netlify-functions-cjs-fix) integrated locally, awaiting owner approval for DEPLOY.

## Verified Baseline

- Local tests: `npm run test:run` passed 268/268 tests (25 test files), zero regressions.
- Local production build: `npm run build` succeeded.
- origin/main head: `1d26425`. Netlify Published: `ccdb788` (verified serving identical assets to HEAD build — diff is screenshots only). The 4 previously-skipped commits (975b5a0, a29e1ec, 78533e4, cab46f3) are ancestors of ccdb788 and LIVE; historic Skipped labels need no action.
- **2026-07-17 finding:** both Netlify Functions returned 502 in production (`module is not defined in ES module scope` — root `"type": "module"` vs CJS `.js` functions; broken since first deploy from this repo, masked by frontend fallback chain). Fixed by card `netlify-functions-cjs-fix`: `git mv` all three functions to `.cjs` + path updates in `scripts/provider-dry-run.mjs` and `netlify/__tests__/*`. Debugger VERDICT: PASS. Committed locally, NOT pushed (push auto-deploys — owner briefing pending).

## Completed This Session (2026-07-16 Autonomous Office)

| Cycle | Cards | What |
|-------|-------|------|
| 1 | 4 | provider-adapter-refactor (unified protocol-aware adapter), language-switch-and-ai-translation (zh/en pill + display-layer translation), role-behavior-distillation (behaviorSchema with honest source labeling), ai-role-evaluation (offline replay harness + 4 metrics) |
| 2 | 3 | runtime-model-routing (frontend → provider-adapter fallback chain), model-routing-cost-guard (daily budget $1/day, UTC rollover, 402+fallback on exhaustion), provider-adapter-dry-run (zero-network in-process dry-run script) |
| 3 | 3 | dead-player-vote-autoresolve (P0 fix: dead human DAY_VOTING no longer stalls), speech-quality-filter (wolf/possessed self-reveal exclusion + language preference), en-display-translation-improvement (Seer stub detection, EN → zh fallback) |
| 4 | 1 | night-pipeline-exception-safety (owner-reported P0: permanent "AI思考" stall — try/finally around all isProcessingAI blocks, guarded dynamic imports, 12s fetch timeouts) |
| 5 | 1 | lobby-language-authority (P1 fix: in-game pill removed, lobby sole language authority, EN games produce full native English AI speech from all 3 layers + wolf chat, zh unchanged, 231 tests) |
| 6 | 9 | UI optimization: P0 speech-timer-autoskip-fix (human stall fix), action-bar-i18n (KILL→刀人 etc.), lobby-difficulty-i18n (Beginner/Intermediate/Expert), dead-player-card-readability, speech-input-placeholder-i18n, header-icon-tooltips (aria-labels), quick-speech-buttons (7 presets, X号 tap-to-fill), phase-labels-i18n (12 phase keys EN), player-card-speaking-status (已发言checkmark badges) |

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
- Speech library: 11,449 entries, mixed JA/EN/CN from AIWolf corpus; Witch/Hunter/Idiot reuse Seer/Villager pools.
- Full browser E2E playthrough of all roles/boards not completed (QA exercised 9p and 12p as guest, 2 games).

## Deployment Status

**DEPLOYED 2026-07-16 with owner approval.** Two pushes: `73e2934` (cycles 1–3) and `b94cdbe` (stall fix). Netlify auto-deploy from GitHub verified live.

Still requiring owner action before the provider adapter can make live calls:

1. Adding API keys to Netlify env vars (AICODEMIRROR_API_KEY, DEEPSEEK_API_KEY) — until then provider-adapter falls back to genai-proxy/speech library, which is safe.
2. Optional: set ADAPTER_DAILY_BUDGET_USD (default $1/day/instance).
3. Any Supabase Dashboard changes.

## Coordinator Rules

- Same as before. No deployment, push, or external service mutation without owner approval.
