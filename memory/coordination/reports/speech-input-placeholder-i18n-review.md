# Debugger Review: speech-input-placeholder-i18n

**Role:** $aiwerewolf-debugger
**Date:** 2026-07-16
**Worktree:** /Users/frank/aiwerewolf-worktrees/speech-input-placeholder-i18n

## Scope check

- `git diff` touches only `src/components/SpeechInput.tsx` (+6/−1). Untracked:
  `src/components/SpeechInput.test.ts` (hidden by `.gitignore` `**/*.test.ts`
  — coordinator must `git add -f` at integration) plus card/report copies.
- No out-of-scope files; no quick-speech-buttons scope creep (component body
  otherwise unchanged — input, Enter-to-submit, send button, styling, props
  contract all identical).

## Findings per criterion

1. **Correct strings per language** — PASS. `speechPlaceholder('zh')` =
   `轮到你发言...`, `speechPlaceholder('en')` = `Your turn to speak...` —
   exactly the card's strings; zh string byte-identical to the previous
   hardcoded placeholder.
2. **Language source** — PASS. Existing `useDisplayLanguage()` hook from
   `src/i18n`, destructured `[language]`, called BEFORE the
   `if (!visible) return null` early return — Rules of Hooks satisfied. No new
   state; safe under the lobby-only language authority invariant.
3. **No other behavior/visual change** — PASS. Only the `placeholder` prop
   changed from a literal to `speechPlaceholder(language)`.
4. **Unit tests** — PASS. 2 node-env tests covering both languages against the
   real exported helper.
5. **Reproduced verification** — PASS.
   `npm run test:run`: 22 files, **233/233 passed** (baseline 231 + 2),
   matches coder claim. `npm run build`: succeeded (~1.0s).

## Notes

- Integration order reminder (from the card): integrate this before the wave-2
  `quick-speech-buttons` card, which rewrites `SpeechInput.tsx`.
- Integration reminder: `git add -f src/components/SpeechInput.test.ts`.

VERDICT: PASS
