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
  |            +-- selected server-side expression model
  |
  |-- Supabase client --> Auth / Postgres / row-level security
  +-- Netlify Functions
         |-- provider adapter (Gemini default; optional OpenAI/Gateway expression routes)
         |-- legacy Gemini proxy
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
- `src/ai/modelCatalog.ts` owns the typed expression-model catalog. Gemini is
  always available; GPT-5.5 and GPT-5.6 Luna are exposed atomically only when
  the provider capability response proves both exact IDs.
- `src/services/speechLibrary.ts` provides offline role- and situation-aware fallback dialogue.
- The per-match language-model choice shapes daytime dialogue and wolf chat.
  It does not decide game rules, legal targets, or actions; those paths retain
  their existing deterministic/Gemini-assisted behavior.

### External services

- `netlify/functions/provider-adapter.cjs` keeps provider credentials on the
  server, validates requested routes, and reports a no-store capability catalog.
  `netlify/functions/genai-proxy.cjs` remains the legacy Gemini fallback.
- GPT product IDs remain `gpt-5.5` and `gpt-5.6-luna`. Their server-side
  Responses route may use direct OpenAI IDs or Vercel AI Gateway slugs
  `openai/gpt-5.5` and `openai/gpt-5.6-luna`; upstream identity is never part
  of the browser contract.
- Capability discovery validates each upstream independently using GET only.
  Gateway is preferred after it atomically proves both slugs. The verified
  selection is cached briefly per warm instance; without cached proof, a
  configured Gateway key takes priority over direct OpenAI.
- Each user request issues at most one GPT generation POST. Failure of the
  selected direct/Gateway upstream enters the existing Gemini/local chain; it
  never tries the other GPT upstream in the same request. A later capability
  refresh may change the selected upstream.
- GPT cost admission uses conservative rates covering the most expensive
  verified Gateway provider. Budget and circuit accounting therefore describe
  exactly one GPT attempt, not an internal cross-upstream retry sequence.
- Capability lookup fails closed to Gemini-only. Missing credentials, partial
  account access, malformed responses, timeouts, and offline clients do not
  prevent a local-fallback match from starting.
- A selected GPT expression request may fall through the existing Gemini
  provider chain and then the bundled speech library. GPT routes are never
  inserted into automatic action or default fallback routing.
- Supabase provides email OTP authentication and Postgres-backed profiles and records.
- Payment endpoints fail closed with `PAYMENTS_NOT_CONFIGURED`; no real payment service provider is connected.

## Security Invariants

1. `API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, and Supabase service-role credentials remain server-only.
2. The browser submits intent, not trusted final state, for any future multiplayer command.
3. Hidden roles and private actions must be projected per player before multiplayer data is delivered.
4. Database access requires ownership-aware row-level security and production verification.
5. Repeated or retried commands must be idempotent before real payments or multiplayer are enabled.
6. Local fallback behavior must remain available when the AI provider is unavailable.

## Deployment

Netlify builds the Vite application, serves hashed assets from its CDN, applies the SPA fallback, and packages Functions from `netlify/functions`. Netlify Git integration is the sole production publisher for `main`; GitHub Actions independently verifies that the same branch can produce a production build.

## Future Multiplayer Boundary

The planned multiplayer architecture retains Netlify for the frontend and short-lived Functions while using Supabase Auth, Postgres, row-level security, and Realtime for identity and shared data. A trusted server function validates room membership, phase, role permission, targets, timing, and state version. A dedicated long-running game server is deferred until measured load demonstrates a need.
