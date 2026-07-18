# Task: cloud-tts-adapter-spike

## Status

Queued

## Objective

Research-and-design spike (NO production code): a verified provider TTS
capability matrix, a unified cloud-TTS adapter interface design with a
types-only mock file, a cache + cost report, and a draft follow-up
implementation card — everything needed for the owner to decide whether to
fund cloud TTS.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md` (Provider Infrastructure + Budget
  sections)
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/tasks/browser-tts-mvp.md` (the browser-native layer this
  design must default to and fall back to)
- `netlify/functions/provider-adapter.cjs` and `netlify/functions/genai-proxy.cjs`
  (READ-ONLY: existing protocol routing, cost guard, budget accumulator,
  dry-run mode — the adapter design must fit these patterns)
- `~/.claude/projects/-Users-frank/memory/aicodemirror-provider-endpoints.md`
  is NOT available in the worktree; provider endpoint facts already captured in
  `PROJECT_STATE.md` are the starting point

## Context

- **Spike rules (hard):** produces NO production code, NO network calls to
  paid endpoints, NO new paid service signups, NO billing changes, NO
  `netlify/**` or `src/**` wiring, NO `package.json` changes. Output is
  documents plus ONE types-only TypeScript mock interface file kept under the
  report directory (never imported by the app).
- **Provider facts must come from official docs / published model lists, with
  a SOURCE (URL + access date) for each claim. Never infer capability from a
  model name.** Where documentation cannot be found or verified, write
  "尚未确认" — an honest gap beats a guess (same honesty standard as the
  AIWolf `synthetic`/`heuristic` labeling rule in `PROJECT_STATE.md`).
- **Known providers in this project (verify each for TTS):**
  - gemini — `API_KEY` live in prod (only provider with a working key). Check
    Gemini native TTS (e.g. `gemini-2.5-flash-preview-tts`) AND Google Cloud
    Text-to-Speech as distinct options: model IDs, pricing, audio formats,
    streaming support, zh/en voice coverage.
  - aicodemirror — Anthropic Messages / Codex backend / Gemini protocols
    reachable, key NOT set. Do its documented protocols actually expose a TTS
    endpoint? If no documentation exists, record "尚未确认 — 无公开 TTS 文档",
    not a guess.
  - deepseek — Anthropic-Messages-compatible, key NOT set. Same check: does it
    document TTS at all?
- **Deliverable 1 — capability matrix:** per provider/product: protocol,
  endpoint shape, TTS model IDs, price (per char/token/second), audio formats,
  streaming (yes/no), zh + en voice support, auth model — each cell sourced or
  "尚未确认".
- **Deliverable 2 — unified interface design:** a single adapter interface with
  request fields `text`, `language`, `voiceId`, `rate`, `requestId`,
  `abortSignal`; response contract (audio payload/URL, format, duration,
  cache-hit flag, error taxonomy). Cloud calls go ONLY through a Netlify
  Function (API key never reaches the frontend — same isolation as
  `provider-adapter`). Routing design: browser-native TTS default →
  cloud-premium as explicit opt-in → on any failure fall back down the chain
  cloud → browser → text-only (silent). Must slot behind the
  `speechAudio.ts` service from `browser-tts-mvp` without changing its
  component-facing surface.
- **Deliverable 3 — cache design + cost report:** cache key =
  hash(text) + language + voiceId + rate + model version (speech-library reuse
  is the big win — identical library lines replay from cache). Report:
  first-generation cost per game, cached-replay cost, worst-case TTS calls per
  game (speeches per round × rounds, both boards), latency estimates
  (first-gen vs cached), and how the existing $1/day budget guard would gate
  cloud TTS.
- **Deliverable 4 — DRAFT follow-up implementation card:** written as a
  SECTION inside the report (objective, allowed paths, acceptance criteria,
  verification) — NOT a real file under `tasks/`. The coordinator/planner will
  promote it only if the owner approves the cost.
- Dependencies: none (design references `browser-tts-mvp` but reads only its
  card, which exists at dispatch).
- Parallel wave: wave A, alongside `vote-countdown-diagnosis-and-fix`; may also
  continue running alongside `browser-tts-mvp` (zero path overlap — this card
  touches only its own report directory).

## Allowed changes

- `memory/coordination/reports/cloud-tts-adapter-spike.md` (main report:
  matrix, cost report, follow-up card draft)
- `memory/coordination/reports/cloud-tts-adapter-spike/` (new directory:
  design doc + `tts-adapter.types.ts` mock interface file — types only, no
  network code, no imports from/into `src/**`)

## Do not change

- ANY file under `src/**`, `netlify/**`, `package.json`, `scripts/**` — this
  spike ships zero product code.
- No new task card files under `memory/coordination/tasks/`.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Capability matrix covers gemini (native TTS AND Google Cloud TTS),
   aicodemirror, and deepseek; every factual cell has a source (URL + access
   date) or is marked "尚未确认" — zero unsourced claims, zero
   name-based guesses.
2. Unified interface design specifies request fields (text, language, voiceId,
   rate, requestId, abortSignal), response contract, error taxonomy, and the
   Netlify-Function-only key isolation; routing chain browser-default →
   cloud-opt-in → fallback cloud→browser→text-only is explicit.
3. Types-only mock file compiles in isolation (`npx tsc --noEmit` on the file)
   and contains no network code, no runtime logic, and is not imported by the
   app.
4. Cache design keyed by hash(text)+language+voice+rate+model-version, with a
   cost report giving first-gen cost, cached cost, worst-case per-game calls
   (9p and 12p boards), and latency estimates, plus the $1/day budget-guard
   interaction.
5. Draft follow-up card exists as a report section (not a tasks/ file) with
   objective, allowed paths, acceptance criteria, and verification.
6. `git status` shows changes ONLY under the two allowed report paths;
   `npm run test:run` and `npm run build` still pass unchanged (proof the
   spike touched no product code).

## Verification

```bash
git status --short                       # only memory/coordination/reports/cloud-tts-adapter-spike* paths
npx tsc --noEmit memory/coordination/reports/cloud-tts-adapter-spike/tts-adapter.types.ts
npm run test:run                         # 309+ (or current baseline), unchanged
npm run build                            # unchanged
```

## Handoff

- Report path: `memory/coordination/reports/cloud-tts-adapter-spike.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include the deliverables above, sources for every claim,
  explicit "尚未确认" gaps, decisions, residual risks (pricing volatility,
  undocumented providers), and a recommendation to the coordinator
  (go / no-go / gather-keys-first).
