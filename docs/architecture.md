# Architecture

AI Werewolf is a client-first React application with explicit boundaries between game rules, AI decisions, generated expression, and external services. A complete match remains playable when the external language model is unavailable.

## System Overview

```text
Browser
  |-- React views and responsive game room
  |-- useGameState orchestration
  |     |-- deterministic game engine
  |     |-- belief tracker
  |     |-- action selector
  |     +-- AI expression pipeline
  |            |-- local role-specific speech library
  |            +-- stable per-seat expression model
  |
  |-- Supabase client --> Auth / Postgres / row-level security
  +-- Netlify Functions
         |-- Gemini / DeepSeek / Doubao expression adapter (bounded fallback)
         |-- legacy Gemini-compatible proxy
         |-- payment fail-closed endpoint
         +-- protected Supabase administration endpoints
```

## Module Boundaries

### Interface and orchestration

- `src/App.tsx` coordinates application views and top-level navigation.
- `src/components/` contains the game room, lobby, profile, shop, dialogs, and reusable controls.
- `src/hooks/useGameState.ts` coordinates match progression without replacing the pure rule functions.

### Rules and state

- `src/gameEngine.ts` owns deterministic phase transitions, night resolution, voting, deaths, role mechanics, and win conditions.
- Rule decisions are testable without React or an external model.
- Single-player state is client-owned. Future multiplayer state must move behind a server-authoritative command boundary.

### AI decisions and expression

- `src/ai/beliefTracker.ts` maintains explainable suspicions and observations.
- `src/ai/actionSelector.ts` chooses legal actions from the current state.
- `src/ai/aiOrchestrator.ts` is the public AI-expression entry point.
- `src/ai/modelCatalog.ts` owns the typed catalog and participating pool (`gemini-3.6-flash`, `gemini-3.8-flash`, `deepseek-flash`, `deepseek-v4-pro`, `doubao-seed-1.6-flash`, `doubao-seed-character`, `doubao-seed-2.1-lite`). `modelRouting.ts` snapshots verified availability into stable per-seat round-robin assignments. Match setup presents **Multi-AI Models** on the left and the **Single-Model Options** disclosure entry on the right, housing `Gemini 2.5 Flash` (the safe single-model default and Gemini fallback) alongside every discovered single model. A separate `aiStyleId` and speech persona control delivery; offline capability data never claims remote availability.
- `src/services/speechLibrary.ts` provides offline role- and situation-aware fallback dialogue.
- Each daytime speaker uses its assigned route. Night chat groups only speakers assigned to the same route, excluding the human. When a mixed-model turn has no usable reply after trying verified alternatives, that turn is skipped; single-model turns can fall back to local dialogue. The per-match pool cannot change when delayed discovery completes.
  It does not decide game rules, legal targets, or actions; those paths remain
  deterministic.

### External services

- `netlify/functions/provider-adapter.cjs` keeps provider keys on the server,
  validates requested model IDs, and reports a no-store capability catalog.
  `netlify/functions/genai-proxy.cjs` and `netlify/functions/model-adapter.cjs` remain compatibility aliases.
- Capability discovery independently checks exact Gemini (via direct model lookup or the Netlify AI Gateway provider catalog when `GOOGLE_GEMINI_BASE_URL` is injected), DeepSeek (`/models`), and Doubao (`/models`) IDs, briefly caching successful results. `verified_models` distinguishes remotely verified access from the conservative selectable Gemini 2.5 backup. Supported partial pools remain usable; malformed envelopes unlock no remote routes.
- Every request retains input/output bounds, per-call/daily cost guards, rate limits, timeouts, and circuit breakers. Gemini 3.6 Flash and Gemini 3.8 Flash use minimal thinking and may fall back to Gemini 2.5 Flash; each DeepSeek or Doubao route makes one bounded upstream call (with Doubao's single HTTP 400 minimal-body compatibility retry) then signals local fallback.
- The browser validates `model_used` / `fallback_used` against the assigned route and documented fallback. Accepted-output provenance is committed with the speech through existing lifecycle guards, stored on its log/private message and shown on the seat badge. Missing metadata remains unverified; language/roster/schema rejection uses local provenance. Cancelled or previous-match responses cannot update current labels.
- Supabase provides email OTP authentication and Postgres-backed profiles and records. Account public identity uses a normalized unique `@username` plus Nickname (`display_name`); the internal auth UUID remains the ownership key and is not presented as a public handle.
- Guest identity is a browser-profile-local `guest:<UUIDv4>` principal. Guest records, economy, and lobby presentation state are namespaced by that principal and are never merged into authenticated data automatically.
- Payment endpoints fail closed with `PAYMENTS_NOT_CONFIGURED`; no real payment service provider is connected.

## Security Invariants

1. `API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `ARK_API_KEY`, and Supabase service-role credentials remain server-only.
2. The browser submits intent, not trusted final state, for any future multiplayer command.
3. Hidden roles and private actions must be projected per player before multiplayer data is delivered.
4. Database access requires ownership-aware row-level security and production verification.
5. Repeated or retried commands must be idempotent before real payments or multiplayer are enabled.
6. Local fallback behavior must remain available when the AI provider is unavailable.

## Deployment

Netlify builds the Vite application, serves hashed assets from its CDN, applies the SPA fallback, and packages Functions from `netlify/functions`. Netlify Git integration is the sole production publisher for `main`; GitHub Actions independently verifies that the same branch can produce a production build.

## Future Multiplayer Boundary

The planned multiplayer architecture retains Netlify for the frontend and short-lived Functions while using Supabase Auth, Postgres, row-level security, and Realtime for identity and shared data. A trusted server function validates room membership, phase, role permission, targets, timing, and state version. A dedicated long-running game server is deferred until measured load demonstrates a need.
