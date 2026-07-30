# Development Guide

## Prerequisites

- Node.js 20
- npm
- Optional: a Netlify account for local Function emulation
- Optional: a Supabase project for authenticated-user flows

## Setup

```bash
git clone https://github.com/xuxuduoduo616/aiwerewolf.git
cd aiwerewolf
npm install
cp .env.example .env.local
npm run dev
```

The regular Vite server does not execute Netlify Functions. Matches still work through the local speech fallback. Use `npx netlify dev` when testing the Function boundary.

## Environment Variables

Only variables prefixed with `VITE_` are exposed to browser code. `API_KEY`,
`OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any
future payment secret must remain server-only. Never create
`VITE_OPENAI_API_KEY` or `VITE_AI_GATEWAY_API_KEY`.

`OPENAI_API_KEY` is optional for local/fallback play. When configured for the
Netlify Function, the provider capability endpoint performs read-only access
checks for the exact `gpt-5.5` and `gpt-5.6-luna` IDs. The setup screen exposes
both choices together only after both checks pass; every failure mode remains
Gemini-only and playable. Selection affects expression, not rules or actions.

`AI_GATEWAY_API_KEY` is an optional alternative upstream for the same product
models. Its capability check performs one bounded `GET /v1/models` and requires
both exact slugs, `openai/gpt-5.5` and `openai/gpt-5.6-luna`. When Gateway is
proven it becomes the warm instance's only GPT generation upstream. A user
request makes at most one GPT POST: the selected upstream's failure proceeds to
the existing Gemini/local chain and never retries through the other GPT
upstream. After the short capability cache expires, a later read-only refresh
may choose a different upstream. Without cached proof, a configured Gateway key
takes priority; otherwise direct OpenAI is used. Check the current Vercel
account plan and credit balance before relying on free credits.

OpenAI routes can incur usage charges. Keep Gemini as the default, select a GPT
route explicitly per match, retain hard server request/output budgets, and
remove the server-side key to disable both routes in an emergency. Cost guards
use conservative per-1,000-token rates that cover the most expensive verified
Gateway provider: GPT-5.5 input `$0.0055` / output `$0.033`; GPT-5.6 Luna input
`$0.0011` / output `$0.0066`. GPT-5.5's 8,000-character input bound plus 128
output tokens estimates to `$0.015224`, below its `$0.016` per-call ceiling.

The production build deliberately fails if `VITE_TURNSTILE_SITE_KEY` is missing or looks like a placeholder. Use a legitimate site key for production-like builds; do not commit it.

## Commands

```bash
npm run dev                  # Vite development server
npm run test:run             # Full Vitest suite
npm run build                # Guarded production build
npm run audit:speech-names   # Speech-name diagnostics
npm run audit:speech-corpus  # Corpus consistency audit
```

## Project Layout

```text
src/
  ai/             belief tracking, action selection, and AI orchestration
  components/     application and game UI
  data/           role-specific fallback speech data
  diagnostics/    speech-quality diagnostics
  hooks/          authentication, records, wallet, and match orchestration
  services/       provider, storage, and Supabase adapters
  gameEngine.ts   deterministic game rules
netlify/functions/ server-side provider and data boundaries
docs/              public architecture, roadmap, and setup documentation
scripts/           build guards and focused data audits
```

## Change Guidelines

- Keep deterministic rules separate from language generation.
- Add tests for rule, state-transition, authentication, or security-boundary changes.
- Do not enable multiplayer controls without server-authoritative state and secret-data projection.
- Do not enable purchase controls until the commerce requirements in the roadmap are complete.
- Preserve responsive behavior at 390x844, 768x1024, and 1440x900.
- Never commit credentials, browser captures, local environment files, or generated diagnostics.

## Supabase

Database setup and row-level security declarations are documented in [supabase-setup.md](supabase-setup.md). Applying the SQL locally does not prove that production policies are active; verify them in the target project before handling real user data.

## Deployment

`main` is the production branch. GitHub Actions runs a clean guarded build. Netlify Git integration is the only production publisher and reads build settings from `netlify.toml`.

Netlify deploy credits are paid and must be conserved. Push intermediate work
to a feature branch and update its pull request as needed, but batch related
changes into one tested release. Do not use dashboard deploys, build hooks, or
`netlify deploy --prod` for routine work. A production claim requires direct
evidence that the GitHub workflow and the single consolidated Netlify deploy
succeeded at the same commit.

Before proposing a release:

1. Run `npm run test:run`.
2. Run `npm run build` with the required public build variables.
3. Review the staged diff and scan it for credentials and browser artifacts.
4. Confirm that documentation does not claim planned features are available.
5. Verify both GPT product models through at least one upstream with the
   read-only preflight before authorizing the one consolidated release; without
   that evidence, do not deploy.
