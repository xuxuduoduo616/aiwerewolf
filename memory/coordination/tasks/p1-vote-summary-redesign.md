# Task: p1-vote-summary-redesign

## Status

Superseded — covered by later accepted implementation; do not dispatch directly

## Objective

Replace the flat "1号→5号" vote log text with a structured, grouped vote result component that clearly shows who voted for whom, vote counts, abstentions, tie outcomes, and the final exile result.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`

## Context

- Current implementation: After voting, `finishVote()` in `useGameState.ts` appends a single log line like `票型：1号→5号，2号→5号，3号→1号，4号→弃票` — pure text, hard to parse at a glance.
- Target: A structured summary styled like mature werewolf-game UIs — grouped by target, showing voter badges, counts, percentages, and a distinct final exile result section.
- The vote data is real: `VoteRecord[]` from `voteRecords` state (`voterId`, `targetId | null`, `round`). Do NOT fabricate data.
- The vote summary shows in the sidebar log area when tone === 'vote', OR can be a dedicated phase banner.
- Scope boundary: Do NOT touch vote logic in `useGameState.ts`. Only change how the vote result is rendered in `App.tsx` and optionally a new component.
- Dependencies: none.
- Parallel wave: May run with `p2-model-adapter` (non-overlapping paths).

## Design requirements

1. Group votes by target player — show target player's avatar/number, voter count, % of total votes.
2. Show absentee/abstain voters (targetId === null) clearly in a separate section.
3. Highlight the exile result with a distinct visual focal point (larger card, red/condemned styling).
4. Handle tie (no exile) with a "平票 · 无人出局" state.
5. Show a compact "voter → target" detail table below as secondary info.
6. Adapt gracefully to 9-player (9 voters) and 12-player (12 voters) boards.
7. Fit the existing black/gray/ink aesthetic — no neon colors, no full redesign.
8. No new external assets or dependencies.

## Allowed changes

- `src/App.tsx` — new vote summary rendering section (or import of new component)
- `src/components/VoteSummary.tsx` — new component (if extracted)
- Test files for vote summary logic

## Do not change

- `src/hooks/useGameState.ts` — vote logic and state
- `src/gameEngine.ts`
- Other components
- Git branches, commits, worktree configuration.

## Acceptance criteria

1. After voting, the sidebar shows a structured summary grouped by target with vote counts.
2. Abstentions show in a separate row.
3. Tie scenario shows "平票 · 无人出局" with no exile focal point.
4. Exile result has a visually distinct focal point.
5. Works for 9-player and 12-player data.
6. No layout breakage on the existing log sidebar.
7. Unit tests for tie, normal exile, abstain-only, and no-votes scenarios.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/p1-vote-summary-redesign.md`
- Verdict: PASS or FAIL.
