# Debugger Review: browser-tts-mvp

**Date:** 2026-07-18
**Reviewer:** Claude debugger subagent (independent adversarial review)
**Baseline:** d14765d

## Scope audit

`git diff --name-only HEAD` → exactly 3 modified: card status, `src/App.tsx`,
`src/hooks/useGameState.ts`. New untracked: `src/services/speechAudio.ts`,
`src/services/speechAudio.test.ts` (gitignored by `**/*.test.ts`, needs
`git add -f`). Forbidden files untouched: `src/gameEngine.ts`, `netlify/**`,
`package.json`. No existing test files modified.

## Centralization audit (critical)

`grep -rn "speechSynthesis|SpeechSynthesis|utterance" src/ | grep -v speechAudio`
→ **EMPTY**. Zero direct TTS access outside the service.

## Verification gates (all reproduced)

| Gate | Result |
|---|---|
| `npx vitest run` | 363 passed / 5 skipped (30 files, zero failures) |
| `npx tsc --noEmit` | zero type errors |
| `npm run build` | success, 12 chunks |
| `npm run audit:speech-names` | PASS — 0 violations |
| `node scripts/speech-corpus-name-audit.mjs` | exit 0 |
| `npx vitest run src/voteCountdown.test.ts` | 19 passed — no regression |

## Service soundness (speechAudio.ts, 379 lines)

- Voice per playerId: charCode*31 hash mod voice count, cache `playerId:lang`,
  recompute on voiceschanged/voice-loss. 4 tests. PASS.
- Dedupe by logId: `spokenIds` set committed before `synth.speak()` —
  rerender/cancel-safe. 3 tests. PASS.
- Single queue: `cancelCurrent()` on every enqueue; cancel on mute/disable/
  reset/phase change. 5 tests. PASS.
- Never blocks: hard max duration (5s floor + per-char), onerror resolves,
  speak() in try/catch. Fake-timer timeout test. PASS.
- API-absent: null synth → all public methods no-op. 3 tests. PASS.
- Consent gate: `ttsEnabled` defaults false; user gesture (power button)
  required. PASS.
- Prefs: `werewolf_audio_prefs` localStorage (volume/rate/enabled), same
  try/catch idiom as language pill; isMuted intentionally session-only. PASS.

## Pipeline wiring

Event order verified: generateAIDialogue → addLog (returns id) →
`pickTranslationSource(response, gameLanguage)` — same function LogMessage
uses for display, so spoken text is byte-identical to displayed text. TTS
enqueue sits AFTER roster guard + translation. PASS.

Note (pre-existing, not this card): exported `visibleText` in useGameState
line ~925 is dead code — defined and returned, never consumed by any
component. Rendering goes through LogMessage → pickTranslationSource.

## UI controls (App.tsx 231–258)

Power toggle (aria-pressed, emerald on), volume slider (0–1 step .05), rate
slider (0.5–2 step .1), mute button extended with cancel. All have zh/en
tooltips + aria-labels, 36px targets matching existing icon-button convention.
PASS.

## Countdown tick

Fires only at voteTimer 3/2/1; 120ms 880Hz sine oscillator via lazy
AudioContext; obeys mute/zero-volume; no audio file. `playTick` is the only
speechAudio import in App.tsx. PASS.

## Residual notes

- `visibleText` dead code predates this card — candidate for a cleanup card.
- Real-browser (Chrome) TTS audio output cannot be verified in vitest; the
  coordinator runs browser verification at integration.

VERDICT: PASS
