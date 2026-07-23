# Task: p0-wolf-teammate-visual

## Status

Superseded — covered by later accepted implementation; do not dispatch directly

## Objective

When the human player is a Werewolf, visually mark other wolf teammates on all seat views (night, day, voting). The mark must be distinguishable from self-marking, accessible, and never leak wolf identities to non-wolf players.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- The game already stores wolf teammate info in `privateKnowledge` and logs it in the lobby. But there is NO visual distinction on the seat stage — a human wolf player has no way to see who their teammates are except by reading the initial lobby log message.
- `src/components/PlayerCard.tsx` renders each seat. `src/App.tsx` passes `customBadge` to PlayerCard.
- `src/App.tsx` seat stage is at line 196-219.
- **Scope boundary**: Visual-only change in PlayerCard/App.tsx. Do not modify game engine, belief tracker, or AI logic.
- **Dependencies**: none.
- **Parallel wave**: May run concurrently with `p0-fix-guest-lobby-deadlock` (non-overlapping paths).

## Requirements

1. **Visual mark**: Use a wolf-themed icon/badge (moon/claw/paw) with text/ARIA hint. Do NOT rely on color alone.
2. **Only for human werewolves**: The badge must only render when `me.role === Role.WEREWOLF && me.isAlive`. Never show to villagers, gods, public logs, or non-authorized views.
3. **Self vs teammate distinction**: The human player's own card and teammate cards need clearly different markings.
4. **State consistency**: Badge persists correctly across day/night phases, seat state changes, and death states.
5. **Accessibility**: Include `aria-label` on the badge element.
6. **Tests**: Add tests for permission leakage (non-wolf players must NOT see the badge) and wolf-vision correctness.

## Allowed changes

- `src/components/PlayerCard.tsx` — add wolf teammate badge support
- `src/App.tsx` — pass wolf teammate info as `customBadge` in seat stage
- Test files for wolf vision and permission leakage

## Do not change

- Game rules, engine, belief tracker, or AI logic
- CSS/styling beyond the new badge
- Unrelated components
- Git branches, commits, merges, rebases, worktree configuration.

## Acceptance criteria

1. Human wolf sees a distinctive moon/claw icon on all wolf teammates' cards.
2. Human wolf's own card shows a different self-indicator (e.g., "YOU" is already there, add a subtle wolf self-badge).
3. Non-wolf players (villager, seer, witch, hunter) see NO wolf teammate badges.
4. After death, the badge still shows correctly (dead teammates are still identifiable as former teammates).
5. Teammate badges are visible during night, day discussion, and voting phases.
6. Badge has `aria-label="狼队友"` or similar.
7. Permission leakage test passes: simulate a villager view and assert no wolf badges render.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/p0-wolf-teammate-visual.md`
- Verdict: PASS/FAIL with test results.
