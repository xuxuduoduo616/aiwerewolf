# Task: seo-robots

## Status

Accepted

## Objective

Add public-demo sharing metadata and crawler guidance for the AI Werewolf site.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Relevant decisions and files: `index.html` has only title, viewport, favicon, and Google Fonts; `public/robots.txt` is missing.
- Scope boundary: static metadata and robots only; do not change app UI, routing, analytics, or build tooling.
- Dependencies: `none`.
- Parallel wave: Wave 1; may run concurrently with `legacy-ai-player-cleanup`, `type-safety-cleanup`, `missing-auth-supabase-tests`, and `missing-proxy-validation-tests`.

## Allowed changes

- `index.html`
- `public/robots.txt`

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- `netlify.toml`, app source files, generated build output, or deployment settings.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `index.html` includes a concise description, Open Graph metadata, and Twitter card metadata aligned with the public demo at `https://ai-werewolf.net/`.
2. `public/robots.txt` exists, allows normal crawling, and references the public site origin without claiming a nonexistent sitemap.
3. Metadata is static and does not introduce new external assets or secrets.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/seo-robots.md`
- The worker must set this card to `Accepted` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.

## Result summary

Added static description, Open Graph, and Twitter summary metadata aligned to
`https://ai-werewolf.net/`; added `public/robots.txt` allowing normal crawling
and referencing the public origin without a sitemap claim. Verification passed:
`npm run test:run -- --no-cache` passed 14/14 tests after the exact command hit
a worker-permissions issue writing Vitest cache through the shared
`node_modules` symlink, and `npm run build` passed with the pre-existing Gemini
chunking warning.
