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
`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any future payment secret
must remain server-only. Never create a browser-exposed Gemini key variable.
Production must set `ALLOWED_ORIGIN` to the exact browser origin(s) allowed to
call the Netlify AI functions. Missing or mismatched origins fail closed with a
generic response before capability lookup, generation, or cost accounting.

`GEMINI_API_KEY` (or the compatible `API_KEY`) is optional for local/fallback
play. The provider capability endpoint performs bounded read-only SDK model
checks for exact Gemini 3.6 and 2.5 IDs. Gemini 3.6 appears only after both
checks pass; every failure mode remains Gemini 2.5-only and playable.
Selection affects expression, not rules or actions.

Live requests use a bounded Gemini 3.6 → Gemini 2.5 → local fallback chain.
Cost admission assumes paid rates even when a free tier is available: Gemini 3.6
uses `$0.0015` input / `$0.0075` output per 1K tokens; Gemini 2.5 uses
`$0.0003` input / `$0.0025` output per 1K text tokens. Per-call and daily
budgets, rate limiting, timeout, and a circuit breaker remain enabled.

The production build deliberately fails if `VITE_TURNSTILE_SITE_KEY` is missing or looks like a placeholder. Use a legitimate site key for production-like builds; do not commit it.

## Commands

```bash
npm run dev                  # Vite development server
npm run test:run             # Full Vitest suite
npm run build                # Guarded production build
npm run audit:speech-names   # Speech-name diagnostics
npm run audit:speech-corpus  # Corpus consistency audit
```

## Browser Smoke Tests (Playwright)

The browser smoke layer lives in `e2e/` and is configured by
`playwright.config.ts`. It covers three short guest flows only — guest match
start, the first-day human speech plus exile vote, and the Settings
language/audio toggles — and it never plays a full match.

```bash
npx playwright install chromium   # one-time browser download
npm run test:e2e                  # same as: npx playwright test
npx playwright test --repeat-each=3
```

The config starts the regular Vite server on port 5173. On that port the app
uses its local AI speech fallback, so the smoke tests need no `API_KEY`,
Supabase variables, Turnstile key, or other secrets, and they never call the
Netlify AI/TTS Functions. The existing `npm run test:run` gate stays
unaffected: Vitest excludes `**/e2e/**` in `vite.config.ts`, and
`tsconfig.json` only includes `src`, so the Playwright files never enter the
guarded build either.

If `npx playwright install chromium` cannot write the user-level browser cache
(for example in a sandboxed local run), install the browsers inside
`node_modules` instead; the Playwright config detects that local install
automatically:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
```

`.github/workflows/e2e.yml` runs the same suite on pushes and pull requests
targeting `main`; it is independent from the guarded deploy workflow.

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

### Logic-First Product Design

> 一切设计的根基都是逻辑学，可视化的每一个事物都必须合逻辑。

Treat this as an executable review rule for every user-visible element:

- A control must correspond to a real, currently available capability; planned or unavailable actions remain clearly labeled and effect-free.
- A displayed state and each allowed next state must have a clear cause, transition, and observable outcome.
- Identity and data surfaces must make the acting principal, data owner, and storage namespace unambiguous.
- A failure state must provide an honest retry, fallback, cancellation, or recovery path without implying success.

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
5. Verify both exact Gemini expression models with the server-only, read-only
   capability preflight before authorizing the one consolidated release; without
   that evidence, do not deploy.
