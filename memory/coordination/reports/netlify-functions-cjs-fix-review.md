# Review: netlify-functions-cjs-fix

- Reviewer: independent debugger/reviewer agent
- Date: 2026-07-17
- Scope reviewed: uncommitted working-tree change vs `memory/coordination/tasks/netlify-functions-cjs-fix.md`

## 1. Diff integrity

`git diff -M --stat HEAD`:

| File | Change |
|---|---|
| `netlify/functions/genai-proxy.js` → `genai-proxy.cjs` | pure rename (0 content changes) |
| `netlify/functions/provider-adapter.js` → `provider-adapter.cjs` | pure rename (0 content changes) |
| `netlify/functions/model-adapter.js` → `model-adapter.cjs` | pure rename (0 content changes) |
| `scripts/provider-dry-run.mjs` | 2 lines: `ADAPTER_PATH` constant + header comment, `.js` → `.cjs` |
| `netlify/__tests__/genai-proxy.test.js` | 1 line: source-path constant `.js` → `.cjs` |
| `netlify/__tests__/model-adapter.test.js` | 1 line: source-path constant `.js` → `.cjs` |
| `netlify/__tests__/provider-adapter.test.js` | 1 line: source-path constant `.js` → `.cjs` |
| `memory/coordination/reports/provider-adapter-dry-run-results.md` | 1 line: date timestamp — self-written artifact of running the dry-run script, not a code change |

No logic changes anywhere. All three renames are 100%-similarity renames (git shows `R`, 0-line diffs). Test-file edits are covered by the coordinator-amended "Allowed changes" section of the card. The dry-run results report date bump is a benign run artifact.

## 2. Acceptance criteria

1. **Renames only, `.cjs` exists, `.js` gone** — PASS. `git status` shows `R` for all three; no `.js` function files remain on disk.
2. **Each `.cjs` loads as CommonJS from repo root** — PASS (re-run independently):
   - `genai-proxy CJS OK`, `provider-adapter CJS OK`, `model-adapter CJS OK` — all export `handler` as a function, `require()`d from the root that carries `"type": "module"`. This is exactly the production failure mode, now fixed at the module-system level.
3. **OPTIONS preflight** — PASS: `genai-proxy` handler returned `OPTIONS status 204` in-process, no network.
4. **Dry-run script** — PASS: `node scripts/provider-dry-run.mjs` exits 0, all 5 providers PASS in zero-network dry-run mode, report written.
5. **Tests & build** — PASS: `npm run test:run` → 25 files, 268/268 passed; `npm run build` → succeeded.

## 3. Stale-reference hunt (full repo, excluding node_modules/dist/.git/"Werewolf copy"/.codex-worker-worktrees)

Grep for `functions/(genai-proxy|provider-adapter|model-adapter)\.js` across ts/js/mjs/cjs/md/toml/yml/json:

**Breaking references: NONE.** Every hit is non-load-bearing:

- `vite.config.ts:20` — comment only (doc mention; not a path lookup).
- `src/ai/evaluation.ts:48` — JSDoc comment only.
- `netlify/functions/provider-adapter.cjs:1,551` and `model-adapter.cjs:1,196` — `// --- START/END OF FILE ...js ---` banner comments inside the renamed files themselves. Cosmetic; card forbids body edits, so correctly left alone.
- `memory/**` — historical task cards and reports (docs; non-breaking).

**Config files verified clean:** `package.json` scripts, `.github/workflows/deploy.yml`, `netlify.toml`, `vite.config.ts` contain no functional `.js` function-path references.

## 4. Netlify-specific checks

- `netlify.toml` `[build] functions = "netlify/functions"` — unchanged, correct dir.
- No `included_files`, `node_bundler`, `[functions]` block, or any per-function config pinning `.js` filenames — nothing in netlify.toml to update.
- Netlify's zip-it-and-ship-it treats `.cjs` as a first-class function extension (alongside `.js`, `.mjs`, `.ts`); `.cjs` forces CommonJS parsing regardless of the nearest `package.json` `type` field, which is precisely the fix.
- Endpoint URLs unchanged: function names derive from filename minus extension, so `/.netlify/functions/genai-proxy`, `/.netlify/functions/provider-adapter`, `/.netlify/functions/model-adapter` are identical. Frontend endpoint constants need no edits (verified none reference file extensions).

## 5. Scope / do-not-change check

- No edits to function bodies, `netlify.toml`, root `package.json`, frontend code, `PROJECT_STATE.md`, or git branch state. PASS.

## Residual risks

- None identified for this change. The banner comments inside the `.cjs` files still say `.js` — cosmetic only; could be cleaned in a future card if desired.
- Fix is only effective in production after deploy; the known Netlify deploy blockage (repo mismatch) is out of scope for this card.

VERDICT: PASS
