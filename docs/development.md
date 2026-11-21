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
`GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `ARK_API_KEY`, `QWEN_API_KEY`,
`DASHSCOPE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and any future payment secret
must remain server-only. Never create a browser-exposed provider key variable.
Production must set `ALLOWED_ORIGIN` to the exact browser origin(s) allowed to
call the Netlify AI functions. Missing or mismatched origins fail closed with a
generic response before capability lookup, generation, or cost accounting.

`GEMINI_API_KEY` (or compatible `API_KEY`), `DEEPSEEK_API_KEY`, and `ARK_API_KEY` remain server-only. Read-only discovery independently verifies exact supported IDs (via direct Gemini lookup or the Netlify AI Gateway provider catalog when `GOOGLE_GEMINI_BASE_URL` is injected, plus DeepSeek and Volcano Ark `/models`); `verified_models` prevents an unavailable Gemini 2.5 backup from masquerading as verified. Partial pools are supported, and metadata access does not prove generation or balance.

**Multi-AI Models** sits on the left in match setup as the recommended top-level mode when at least one participating route is verified. Its seven-entry catalog pool (`gemini-3.6-flash`, `gemini-3.8-flash`, `deepseek-flash`, `deepseek-v4-pro`, `doubao-seed-1.6-flash`, `doubao-seed-character`, `doubao-seed-2.1-lite`) assigns discovered AI seats round-robin once per game; late discovery cannot change that snapshot or an explicit setup selection. Personas and legacy style IDs are separate from routing. **Single-Model Options** sits on the right as a disclosure entry housing `Gemini 2.5 Flash`, Automatic · DeepSeek by difficulty, and each discovered single model. Each speaker's day/night request uses its seat route; night requests group identical routes only, run sequentially and never impersonate the human. Both DeepSeek models use low/high/max for easy/normal/hard. Automatic DeepSeek remains selectable under Single-Model Options (Flash for easy/normal, Pro for hard).

Gemini 3.6 Flash (`minimal` thinking) and Gemini 3.8 Flash (`low` thinking) can fall back to Gemini 2.5 Flash on direct-key runtimes; DeepSeek and Doubao each make one bounded upstream attempt (with Doubao's single HTTP 400 minimal-body compatibility retry). Mixed-model turns try verified alternatives and skip the turn if no reply passes validation; single-model turns fall back to local dialogue. Accepted source metadata is validated and committed through match/phase cancellation guards; output rejected by schema/language/roster guards becomes local dialogue. Full model names and assigned/actual/fallback distinctions are available in seat accessibility text.

Cost admission assumes paid rates even when a free tier is available: Gemini 3.6
uses `$0.0015` input / `$0.0075` output per 1K tokens; Gemini 3.8 uses
`$0.00075` input / `$0.00375` output per 1K tokens; Gemini 2.5 uses
`$0.0003` input / `$0.0025` output per 1K text tokens (see
[DeepSeek integration](deepseek-integration.md) and
[Doubao integration](doubao-integration.md) for DeepSeek and Ark rates).
Per-call and daily budgets, rate limiting, timeout, and a circuit breaker remain
enabled.

The production build deliberately fails if `VITE_TURNSTILE_SITE_KEY` is missing or looks like a placeholder. Use a legitimate site key for production-like builds; do not commit it.

## Commands

```bash
npm run dev                  # Vite development server
npm run test:run             # Full Vitest suite
npm run build                # Guarded production build
npm run audit:speech-names   # Speech-name diagnostics
npm run audit:speech-corpus  # Corpus consistency audit
```

## Browser Tests (Playwright)

The browser layer lives in `e2e/` and is configured by `playwright.config.ts`.
It is split into two Playwright projects so a long match can never hide a
short-flow regression:

- `smoke`: guest match start, the six-step new-player guide and replay,
  first-day human speech plus exile vote, Settings language/audio toggles,
  and click-to-toggle voice input;
- `deep`: two specs that play a full 9-player match — the post-game replay
  review and the share-card export. Their match is made reproducible by a
  test-only seeded `Math.random` (`e2e/helpers/seededRandom.ts`), so the
  project runs with `retries: 0`; a retry would double an already minutes-long
  job instead of masking a failure.

```bash
npx playwright install chromium   # one-time browser download
npm run test:e2e                  # both projects: every spec runs once
npx playwright test --project=smoke
npx playwright test --project=deep
npx playwright test --repeat-each=3
```

The config starts the regular Vite server on port 5173. On that port the app
uses its local AI speech fallback, so the browser tests need no `API_KEY`,
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

`.github/workflows/e2e.yml` runs the suite on pushes and pull requests
targeting `main` in two independent jobs, `Playwright smoke` (10 minute limit)
and `Playwright deep` (35 minute limit); it is independent from the guarded
deploy workflow.

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
docs/              architecture, replay-format, and setup documentation
scripts/           build guards and focused data audits
```

## Change Guidelines

### Logic-First Product Design

Every visible interface element should follow a coherent, explainable interaction model.

Treat this as an executable review rule for every user-visible element:

- A control must correspond to a real, currently available capability; planned or unavailable actions remain clearly labeled and effect-free.
- A displayed state and each allowed next state must have a clear cause, transition, and observable outcome.
- Identity and data surfaces must make the acting principal, data owner, and storage namespace unambiguous.
- A failure state must provide an honest retry, fallback, cancellation, or recovery path without implying success.

- Keep deterministic rules separate from language generation.
- Add tests for rule, state-transition, authentication, or security-boundary changes.
- Do not enable multiplayer controls without server-authoritative state and secret-data projection.
- Do not enable purchase controls until the server-verified commerce infrastructure is complete.
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
5. Verify the configured participating pool with server-only read-only capability checks and bounded generation checks before release. Distinguish an honestly unavailable subset from provider success; metadata access alone does not establish generation.

### Multi-model browser verification

`npx playwright test e2e/multi-model.spec.ts --project=smoke --workers=1` starts an isolated Vite harness on port 5176, outside the normal local-fallback ports. It intercepts the provider HTTP boundary with explicit capability and provenance fixtures, checks actual POST routes and accessible badges, and exercises desktop/mobile dialog focus/geometry. These mocks do not establish real vendor availability; bounded production checks are a separate release gate. No new dependencies are required.
