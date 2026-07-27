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
  |            +-- optional server-side Gemini refinement
  |
  |-- Supabase client --> Auth / Postgres / row-level security
  +-- Netlify Functions
         |-- Gemini proxy
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
- `src/services/speechLibrary.ts` provides offline role- and situation-aware fallback dialogue.
- The language model may shape wording, but it does not decide game rules or authorize actions.

### External services

- `netlify/functions/genai-proxy.cjs` keeps the Gemini credential on the server and enforces origin, model, and input constraints.
- Supabase provides email OTP authentication and Postgres-backed profiles and records.
- Payment endpoints fail closed with `PAYMENTS_NOT_CONFIGURED`; no real payment service provider is connected.

## Security Invariants

1. Model keys and Supabase service-role credentials remain server-only.
2. The browser submits intent, not trusted final state, for any future multiplayer command.
3. Hidden roles and private actions must be projected per player before multiplayer data is delivered.
4. Database access requires ownership-aware row-level security and production verification.
5. Repeated or retried commands must be idempotent before real payments or multiplayer are enabled.
6. Local fallback behavior must remain available when the AI provider is unavailable.

## Deployment

Netlify builds the Vite application, serves hashed assets from its CDN, applies the SPA fallback, and packages Functions from `netlify/functions`. Netlify Git integration is the sole production publisher for `main`; GitHub Actions independently verifies that the same branch can produce a production build.

## Future Multiplayer Boundary

The planned multiplayer architecture retains Netlify for the frontend and short-lived Functions while using Supabase Auth, Postgres, row-level security, and Realtime for identity and shared data. A trusted server function validates room membership, phase, role permission, targets, timing, and state version. A dedicated long-running game server is deferred until measured load demonstrates a need.
