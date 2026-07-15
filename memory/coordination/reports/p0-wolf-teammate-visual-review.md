# Review: p0-wolf-teammate-visual

**Reviewer:** Debugger (independent verification)
**Date:** 2026-07-15
**Baseline:** commit `e160ef7` (recovery baseline; product code committed)

## Scope confirmation

Committed diff for this task touches only:
- `src/components/PlayerCard.tsx` (+17 lines) — `isWolfTeammate` prop + PawPrint badge + Moon self-icon
- `src/App.tsx` (seat stage) — computes and passes `isWolfTeammate`
- `src/components/PlayerCard.wolfvision.test.ts` (new, 10 tests)

No changes to `gameEngine.ts`, `beliefTracker`, `actionSelector`, or any AI logic.
(An unrelated uncommitted `VoteSummary` change exists in the working tree from a
parallel task — outside this task's scope; not evaluated here.)

## Acceptance criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Human wolf sees distinctive badge on teammates | PASS | PlayerCard renders `<PawPrint>` when `isWolfTeammate` (PlayerCard.tsx:81-88); App gates it on live human wolf (App.tsx:220-221,230) |
| 2 | Own card shows DIFFERENT self-indicator | PASS | Moon icon rendered inline in name row only when `isMe && player.role === WEREWOLF` (PlayerCard.tsx:104-106). PawPrint is teammate-only via `player.id !== MY_PLAYER_ID` |
| 3 | Non-wolf players see NO teammate badges (leak check) | PASS | Gate requires `me.role === WEREWOLF`. Tests for villager/seer/witch/hunter all assert false (wolfvision.test.ts:76-107) |
| 4 | Dead wolf teammate still shows badge | PASS | Gate uses teammate `camp`, not teammate `isAlive`; test asserts true for dead teammate (wolfvision.test.ts:47-52) |
| 5 | Dead human wolf does NOT leak (gate uses me.isAlive) | PASS | `isHumanWolf = me.role===WEREWOLF && me.isAlive===true`; test asserts false when me is dead (wolfvision.test.ts:109-115) |
| 6 | Badge has `aria-label="狼队友"` | PASS | PlayerCard.tsx:84 |
| 7 | isWolfTeammate logic matches spec | PASS | App.tsx:220-221 = `me.role===WEREWOLF && me.isAlive && player.id !== 1 && player.camp === 'WEREWOLF'` (MY_PLAYER_ID=1); test mirrors identically incl. `undefined me` → false |
| 8 | No engine / belief / AI changes | PASS | Diff scope confirmed above |

Note on criterion #5 (day/night/voting phases): `isWolfTeammate` is computed in
the single shared seat stage that renders in every phase and depends only on
role/alive/camp, not phase, so the badge is phase-independent by construction.

## Isolated test output (exact)

```
$ npx vitest run src/components/PlayerCard.wolfvision.test.ts
 RUN  v2.1.8 /Users/frank/aiwerewolf
 ✓ src/components/PlayerCard.wolfvision.test.ts (10 tests) 2ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Full suite (exact)

```
$ npm run test:run
 ✓ netlify/__tests__/genai-proxy.test.js (6 tests)
 ✓ src/guestLobbyTransition.test.ts (4 tests)
 ✓ netlify/__tests__/model-adapter.test.js (5 tests)
 ✓ src/services/roleProfiles.test.ts (4 tests)
 ✓ src/components/PlayerCard.wolfvision.test.ts (10 tests)
 ✓ src/gameEngine.test.ts (11 tests)
 ✓ src/services/supabaseClient.test.ts (2 tests)
 ✓ src/integration.test.ts (3 tests)
 ✓ src/components/VoteSummary.test.ts (5 tests)
 ✓ src/ai/benchmark.test.ts (5 tests)
 Test Files  10 passed (10)
      Tests  55 passed (55)
```

## Build output (exact)

```
$ npm run build
> tsc && vite build
vite v5.4.21 building for production...
✓ 1572 modules transformed.
dist/index.html  1.91 kB │ gzip: 0.78 kB
... (chunks omitted) ...
✓ built in 956ms
```

TypeScript passed; production build clean.

## Permission leakage assessment

No leakage found. The wolf badge gate has three independent conditions that must
all hold: viewer is a WEREWOLF, viewer is alive, and the target is in the WEREWOLF
camp (and not self). Non-wolf viewers fail the first condition; dead wolves fail
the second. `PlayerCard` renders the PawPrint only from the `isWolfTeammate` prop,
which is set exclusively at App.tsx:230 — no other call site exists (grep-verified).
The self Moon icon is separately gated on `isMe`, so it cannot appear on others.

## Cross-task note

The task instructions warned that `src/services/roleProfiles.test.ts` might have a
syntax error failing collection. At this baseline it does NOT — the file collects
and passes 4/4 tests. No action needed; does not affect this verdict.

VERDICT: PASS
