# Review: p1-vote-summary-redesign

**Reviewer:** Debugger (independent verification)
**Date:** 2026-07-15

## Verification findings

### Requirement checks — all PASS

- **Groups by target correctly**: `computeVoteSummary` builds a `Map<targetId, voterIds[]>`,
  maps to groups with `count`/`percent`, and sorts by descending count with a stable
  `targetId` tiebreaker. Confirmed in `VoteSummary.tsx:38-58`.
- **Abstentions shown separately**: `targetId === null` votes are collected into
  `abstainVoterIds` and rendered in a distinct `弃票` section (`VoteSummary.tsx:41-43, 137-151`).
- **Tie renders "平票 · 无人出局" with no exile focal point**: when `eliminatedPlayerId === null`
  the component renders the neutral zinc card `平票 · 无人出局` (`VoteSummary.tsx:163-167`).
  Confirmed no red focal-point card renders in that branch.
- **Normal exile renders distinct focal point**: when `eliminatedPlayerId !== null`, a
  `border-2 border-red-700 bg-red-950/80` card with Gavel + Skull icons renders
  (`VoteSummary.tsx:154-162`), plus the matching target group is highlighted red
  (`isExiled` branch, lines 103-123). Distinct from normal styling.
- **`resolveVoteResult` reused, not duplicated**: `App.tsx:13` imports it from
  `./gameEngine`; `App.tsx:55-64` builds a `Record<targetId, count>` tally and calls
  `resolveVoteResult(tally)`. No tie/exile logic reimplemented in the component — the
  component receives `eliminatedPlayerId` as a prop.
- **No changes to `useGameState.ts` or `gameEngine.ts`**: `git status` shows neither file
  modified. Only `src/App.tsx` (M) and `src/components/VoteSummary.tsx` (new).
- **Real `VoteRecord[]` data**: component receives `game.voteRecords`, `game.players`, and
  the derived latest `voteRound` (`App.tsx:337-343`). No fabricated data.
- **No API keys, no external deps**: only imports `lucide-react` (already a project
  dependency for icons) and existing types. No new dependency added.
- **9/12-player adaptability**: grouping is fully data-driven with no fixed sizes; percent
  bars scale by `totalVotes`. PASS.
- **Empty state**: `totalVotes === 0` renders a graceful "本轮没有投票记录" card
  (`VoteSummary.tsx:79-88`).

### Integration check

- `showVoteSummary` gates rendering to after voting ends (phase not `DAY_VOTING`/
  `DAY_DISCUSSION`), which matches the acceptance criterion of showing the summary once
  voting completes (`App.tsx:51-54`).
- `voteRound` uses `Math.max` over records — latest round selected correctly.

## Test output

Full suite (`npm run test:run`):

```
 ✓ src/components/VoteSummary.test.ts  (5 tests)
 ...
 Test Files  1 failed | 7 passed (8)
      Tests  41 passed (41)
```

The one failing test file is `src/services/roleProfiles.test.ts` — a **collection/parse
error** (esbuild syntax error: unescaped apostrophe in a test title at line 57). That file
belongs to the parallel `p2-model-adapter` task, NOT to this task's allowed paths. It is
unrelated to `p1-vote-summary-redesign` and does not touch VoteSummary.

This task's tests in isolation (`npx vitest run src/components/VoteSummary.test.ts`):

```
 ✓ src/components/VoteSummary.test.ts (5 tests) 2ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

All 5 required scenarios covered: normal exile, tie (descending sort), abstain separation,
empty records, round filtering.

## Build output

```
vite v5.4.21 building for production...
✓ 1572 modules transformed.
dist/index.html                               1.91 kB │ gzip:   0.78 kB
...
dist/assets/werewolf_speeches-BjeLUyzT.js   509.62 kB │ gzip: 171.84 kB
✓ built in 961ms
```

Build succeeds. Vite does not process test files, so the unrelated `roleProfiles.test.ts`
syntax error does not affect the production build. TypeScript compilation of `App.tsx` and
`VoteSummary.tsx` passes.

## Issues

- None attributable to this task. The `p1-vote-summary-redesign` deliverable is correct,
  scoped, reuses `resolveVoteResult`, and passes its own tests and the build.
- **Cross-task note (not this task's fault):** the full `test:run` is red because of a
  syntax error in `src/services/roleProfiles.test.ts` (parallel `p2-model-adapter` task).
  The coordinator must ensure that file is fixed before integrating p2, but it should not
  block acceptance of this card.

VERDICT: PASS
