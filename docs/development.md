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

Only variables prefixed with `VITE_` are exposed to browser code. `API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any future payment secret must remain server-only.

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

Before proposing a release:

1. Run `npm run test:run`.
2. Run `npm run build` with the required public build variables.
3. Review the staged diff and scan it for credentials and browser artifacts.
4. Confirm that documentation does not claim planned features are available.
