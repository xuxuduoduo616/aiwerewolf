# Worker Report: speech-input-placeholder-i18n

**Date:** 2026-07-16
**Status:** Ready for review

## Summary

Localized the SpeechInput placeholder. It now renders "轮到你发言..." in zh
display mode and "Your turn to speak..." in en mode, driven by the existing
`useDisplayLanguage()` hook per the card's language-source decision.

## Changed files

- `src/components/SpeechInput.tsx` — added `speechPlaceholder(language)` pure
  exported helper; component reads language via `useDisplayLanguage()` and
  passes `speechPlaceholder(language)` to the input's `placeholder`. Props
  contract, Enter-to-submit, styling, and send button untouched.
- `src/components/SpeechInput.test.ts` — new; 2 unit tests covering the helper
  for both languages (matches the repo's no-jsdom pure-helper test convention,
  same style as `VoteSummary.test.ts`).

## Decisions

- Language read inside the component via `useDisplayLanguage()` (as the card
  specifies) rather than a prop from `App.tsx` — safe because the lobby is the
  sole language authority and display language cannot change mid-game.
- Hook is called before the `if (!visible) return null` early return to keep
  the Rules of Hooks satisfied.
- Combined value+type import (`{ useDisplayLanguage, type DisplayLanguage }`)
  matching the mixed-import style in `LogMessage.tsx` / `useGameState.ts`.
- Note: the task card was missing from the worktree's
  `memory/coordination/tasks/` at session start (dispatcher copy gap); I copied
  it in unmodified from the canonical card before implementing. No main-repo
  files were modified.

## Verification

```bash
npm run test:run   # 22 files, 233/233 passed (baseline 231 + 2 new), zero regressions
npm run build      # TypeScript + Vite production build succeeded
```

## Residual risks

- None significant. `useDisplayLanguage()` instantiates its own state from
  localStorage; if a future change allows mid-game language toggling from
  `App.tsx`, this component's local copy would not re-render on toggle. Under
  the current lobby-only language authority this cannot occur.

## Recommendation

Accept. Minimal diff, isolated to the two allowed files; integrate before the
wave-2 `quick-speech-buttons` card as sequenced.
