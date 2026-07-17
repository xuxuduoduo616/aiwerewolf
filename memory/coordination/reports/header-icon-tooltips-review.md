# Review: header-icon-tooltips

## Verification

| Command | Result |
|---|---|
| `npm run test:run` | 25 files, 268 tests PASS, zero regressions |
| `npm run build` | tsc + vite success, 1575 modules, zero errors |

## Diff analysis

2 files changed (3 insertions, 3 deletions):

- `src/App.tsx` (+2/-2, lines 221-222): Added `title` and `aria-label` attributes to both in-game header buttons (mute toggle, return to lobby). Uses inline ternary expressions on the existing `displayLanguage` state.
- `memory/coordination/tasks/header-icon-tooltips.md`: Status updated to "Ready for review".

## Acceptance criteria map

1. **Both header buttons expose title and aria-label with exact strings**: PASS.
   - Mute button: zh "静音/取消静音", en "Mute / Unmute"
   - Return button: zh "返回大厅", en "Return to lobby"
   - Both `title` and `aria-label` set identically per button. Switches with `displayLanguage`.

2. **No behavioral or visual change otherwise**: PASS. No styling, icon, or click-handler changes. The diff is purely additive attribute insertion on the existing `<button>` elements.

3. **No in-game language toggle added**: PASS. The diff touches only the header SVG buttons. No language pill reintroduced. The comment "Language is fixed at startGame from the lobby pill — no in-game toggle." is preserved.

4. **Baseline tests pass**: PASS. 268/268, zero regressions.

5. **Build succeeds**: PASS.

6. **Scope confined to header buttons**: PASS. Lines 221-222 only. No other App.tsx regions touched (no SpeechInput, seat stage, center console, sidebar changes).

7. **Pattern matches lobby pill at line 146**: PASS. The lobby pill already uses `title` for the language toggle; this follows the same pattern.

## Residual notes

- This is a purely additive attribute change with zero logic/state/flow impact. No new imports, dependencies, or files.
- No conflict with the parallel `quick-speech-buttons` card (different App.tsx region: header vs. SpeechInput render block).

VERDICT: PASS
