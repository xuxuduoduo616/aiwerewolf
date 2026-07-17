# player-card-speaking-status — Implementation Report

## Status: Ready for review

## Changed files

| File | Change |
|---|---|
| `src/hooks/useGameState.ts` | Added `spokenPlayerIds` Set state; reset in `handleDayAnnounce`; mark-spoken at 5 speech-finish points (dead-human skip, AI success, AI error, human auto-skip, human submit); exposed in return object. Added pure helper `computeSpeakingStatus`. |
| `src/components/PlayerCard.tsx` | Added `hasSpoken?: boolean` prop; green checkmark badge (emerald-600, `aria-label="已发言"`, bottom-right of avatar, mutually exclusive with mic); `opacity-90` dimming for spoken-alive-non-speaking cards. |
| `src/App.tsx` | Passed `hasSpoken` prop on seat-stage PlayerCard render, gated to `DAY_DISCUSSION` phase. |
| `src/speakingStatus.test.ts` | New test file — 12 tests for `computeSpeakingStatus`: non-discussion phases, dead players, speaking/spoken/pending, multiple players, reset semantics, and hunter re-entry safety. |

## Decisions

- **Internal representation**: `Set<number>` with immutable copies (`new Set(prev).add(id)`) on each mutation. Simple, O(1) lookup, trivially resetable to `new Set()`.
- **Exposure**: Set exposed directly from the hook. In App.tsx, the prop expression uses `.has()` (native Set method) rather than array `.includes()`. This is semantically cleaner than converting to array on every render.
- **Checkmark position**: bottom-right of avatar, same absolute position as the mic badge. They never coexist (`hasSpoken && player.isAlive && !isSpeaking` guards it), so there is zero collision risk.
- **Dead players**: The spoken set records dead-human skips for correctness (hunter re-entry safety), but `computeSpeakingStatus` returns `'none'` for dead players, so they never show the green checkmark. They already have their own `opacity-75 brightness-[0.65]` + skull styling from the pre-existing dead state.
- **Hunter last-words re-entry**: The spoken set is reset only in `handleDayAnnounce`, never in `enterDiscussion`. If a hunter dies mid-discussion and enterDiscussion is re-entered after the shot, the spoken set from earlier in the same day is preserved. Already-spoken players remain marked spoken.

## Verification

```bash
npm run test:run   # 280 passed (268 baseline + 12 new), zero regressions, 26 test files
npm run build      # tsc + vite build: successful, 1.02s
```

## Residual risks

- **No browser E2E**: The checkmark badge rendering and dimming are not exercised in a real browser. The logic is covered by unit tests for the pure helper, but visual styling and aria-label require a QA pass.
- **Set serialization**: `spokenPlayerIds` is a `Set` — if any future code tries to JSON.stringify the hook's return object (e.g. for debugging or state persistence), Sets don't serialize natively. Not currently done anywhere in the codebase.
- **Phase change race**: React state updates are batched. If `setSpokenPlayerIds` fires in the same frame as `setCurrentSpeaker(null)` and the phase driver re-enters `handleDiscussion` before the spoken Set is committed, the same speaker might be re-selected. In practice, the phase driver runs on a 700ms setTimeout, so this is very unlikely.

## Recommendation to coordinator

Accept. The change is minimal, zero regressions, test coverage is solid for the pure logic. A browser QA pass to verify the green checkmark and dimming visual states during a live game is the appropriate next step after integration.
