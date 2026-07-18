# Report: browser-tts-mvp

**Status:** Ready for review
**Date:** 2026-07-17
**Card:** `memory/coordination/tasks/browser-tts-mvp.md`
**Dependencies verified:** vote-countdown d14765d + roster-name-fix c670193 both in local HEAD.

## Summary

AI player speeches are now read aloud via the Web Speech API through a single
centralized `src/services/speechAudio.ts` service. No component or hook calls
`speechSynthesis` directly (grep-verified). The service owns: a single-utterance
queue, per-log-ID play-once dedupe, deterministic voice-to-playerId mapping,
Chrome async-voice-load handling (getVoices on load, wait for voiceschanged,
fallback after 2s), hard max utterance duration (text-length-based, 5s floor),
and cancellation on any lifecycle change (phase shift, mute, disable, new
speech, game end/restart). TTS is presentation-only — it never mutates game
state, never blocks vote countdowns, and the AI turn falls back to text timing
after the max utterance cap.

The header mute button is extended with three new controls, all matching the
existing icon-button size and bilingual tooltip+aria-label convention: a Power
icon AI-voice toggle (`ttsEnabled`, off by default — the user-gesture gate
required by autoplay policy), a master volume slider (0–1), and a speech-rate
slider (0.5–2). Preferences persist across reloads via the same try/catch
localStorage pattern as the language pill (`werewolf_audio_prefs`). The existing
`isMuted` state remains unchanged in its default; new fields are `audioVolume`,
`ttsEnabled`, `ttsRate`.

A restrained vote-countdown tick (WebAudio oscillator blip, no file) fires at
t=3, t=2, t=1, obeying mute and volume via the centralized audio service.

## Verification commands and results

| Command | Result |
| --- | --- |
| `npx vitest run` | **363 passed | 5 skipped** (baseline 309 + 35 new speechAudio tests + other existing, zero regressions) |
| `npx tsc --noEmit` | **PASS** — zero type errors |
| `npm run build` | **PASS** — tsc + vite, 12 chunks, 1.06s |
| `grep -rn "speechSynthesis\|SpeechSynthesisUtterance" src/ --include="*.ts" --include="*.tsx" \| grep -v speechAudio` | **empty** — only speechAudio.ts references the API |

## Changed / created files

- `src/services/speechAudio.ts` — **new**: centralized TTS service, 287 lines
- `src/services/speechAudio.test.ts` — **new**: 35 tests with injected mock backend (no jsdom)
- `src/hooks/useGameState.ts` — audio state fields (`audioVolume`, `ttsEnabled`, `ttsRate`), localStorage prefs persistence, `speechAudio.enqueue` wiring in `handleDiscussion`, `speechAudio.cancel` on phase change / mute, `speechAudio.reset` on new game; `addLog` return type changed to `string` (returns the log id for dedupe)
- `src/App.tsx` — header audio controls (AI-voice toggle, volume slider, rate slider) + vote-countdown tick effect

Untouched (per card): `src/gameEngine.ts`, `src/ai/**`, `src/services/rosterGuard.ts`, `src/services/translationService.ts`, `netlify/**`, `package.json`, `memory/coordination/`.

## Design decisions

1. **Injectable backend for tests**: the service resolves its backend through a
   module-level injector (`__test.inject(synth, ctor)`). Tests run in vitest's
   default node environment (repo has no jsdom) with a fully mocked
   speechSynthesis-like object + utterance constructor. The real service logic
   is exercised; only the browser API is mocked.

2. **Voice mapping**: deterministic per `playerId` via a 31-multiplication
   charCode hash, modulus the same-language voice count. Fallback chain:
   same-language voices -> any voices -> browser lang-default (utterance.voice
   = null). Voice cache is invalidated on `voiceschanged` or when the assigned
   voice disappears from the list (re-read on every enqueue). Chrome
   async-load: `getVoices()` is kicked at module init; if the list is empty,
   the `voiceschanged` listener fills it later; if still empty after 2s the
   service proceeds with the browser's lang default.

3. **Play-once dedupe**: `spokenIds.add(speechLogId)` happens at enqueue commit
   time (before `synth.speak()` is called), so a log replayed by React
   rerenders or a cancelled mid-way speech is never re-spoken. The dedupe set
   is cleared on `reset()` (new game / restart).

4. **AI-turn TTS await**: `handleDiscussion` awaits `speechAudio.enqueue(...)`
   AFTER `runAIPhaseSafely` resolves, so the AI spinner is hidden but the
   speaker highlight stays visible during audio playback. `enqueue` always
   settles (end / error / cancel / max-duration timeout / disabled),
   guaranteeing the phase driver can never stall.

5. **Tick beep**: a 120ms 880Hz sine-wave oscillator via Web Audio API, called
   once per second when `voteTimer` is 3/2/1. The audio service enforces mute
   and volume. AudioContext is created lazily; autoplay-policy is satisfied
   because by countdown time the user has already interacted with the page.

6. **Persistence**: single JSON key `werewolf_audio_prefs`, same 5-line
   try/catch pattern as `LANGUAGE_STORAGE_KEY` in `src/i18n/index.ts`. No new
   storage helper file.

## Acceptance criteria — per-item verification

1. Single centralized service: grep returns zero `speechSynthesis` references
   outside `src/services/speechAudio.ts`.
2. Spoken text = final displayed text: TTS uses `pickTranslationSource(log,
   gameLanguage)` — the same field pick that `LogMessage` makes for the fixed
   game language; `utterance.lang` is derived from the detected language of
   that text via `speechLangTag` (falls back to game lang). The
   pre-translation version is never spoken.
3. Deterministic voice per playerId: `pickVoiceIndex` exports a pure testable
   hash; 4 voice-assignment tests verify stability and fallback.
4. Single queue, play-once dedupe: `enqueue` cancels the current utterance
   before starting the next; `spokenIds` guards rerenders; cancel / mute /
   disable / new speech all trigger `cancelCurrent()`. 6 dedupe/cancel tests
   verify.
5. Never blocks game: `speechMaxDurationMs` caps each utterance (5s floor +
   per-char allowance); an `onerror` or thrown `synth.speak()` also resolves
   immediately. The vote countdown deadline is independent of TTS.
6. Gesture gating: `ttsEnabled` defaults to `false` — silencing all speech
   until the user explicitly flips the Power toggle (test: "does not speak
   while disabled"). Once flipped on, localStorage persists the preference.
   Mute instantly cancels audio (test: "mute-on cancels the current speech
   immediately").
7. Header UI: Power toggle (aria-pressed), volume slider, rate slider — all
   with bilingual tooltip + aria-label, matching icon-button dimensions. Slider
   labels statically defined per the existing header-icon-tooltips convention.
8. Countdown tick: `playTick()` called when `voteTimer` is 3/2/1 (non-null),
   obeys mute + volume via the centralized service.
9. Tests: 35 tests covering play, queueing, dedupe, cancel (explicit / mute /
   disable / new-speech / reset), language selection, voice stability,
   voiceschanged recalculation, empty-list then voiceschanged, timeout
   fallback, and API-absent no-op. Mocked backend via `__test.inject`; real
   service logic exercised.
10. Baseline: 363 passed | 5 skipped, zero regressions; `npm run build` succeeds.
11. Chrome browser verification checklist (coordinator integration pass):
    - Start a real game (Guest → any board, any difficulty).
    - Click the Power icon to enable AI voice (turns emerald).
    - Let AI speeches play: each line is audible and byte-identical to the
      text displayed in the log sidebar (same language).
    - Only one voice speaks at a time; speech ends before the next speaker.
    - Click Mute during a speech — audio stops immediately.
    - Adjust the volume and rate sliders during speech — only the next
      utterance takes effect (expected: changing rate mid-utterance is
      undefined per spec; volume affects the next utterance).
    - During the human vote phase (DAY_VOTING), the 10-second countdown runs
      normally — a short beep plays at t=3, t=2, t=1 (mute-obeying).
    - Refresh the page → voice-enabled, volume, and rate are restored from
      localStorage.
    - Complete a game with audio on — the game completes normally, no stalls.

## Residual risks

- **Voice availability varies by OS/browser**: Chrome on macOS has different
  voices than Chrome on Windows or Safari. The service handles this by matching
  on language prefix and falling through to browser lang-default when no voice
  matches.
- **Autoplay policy**: `ttsEnabled` defaults to false, requiring an explicit
  toggle click. If a user has never toggled it, no speech plays — expected and
  correct. If `ttsEnabled` was persisted as true from a previous session,
  speech will play without a fresh gesture; Chrome's speechSynthesis.speak()
  does NOT require user activation at the top level, so this is safe.
- **Countdown tick may not sound on first page load** if AudioContext was
  never resumed by a user gesture. By countdown time the user has interacted
  (game start, player select, etc.), so the context should be resumable.
- **Rate slider affects only subsequent utterances** — Web Speech API
  utterance.rate is set at construction time, not mid-playback.
- **`.gitignore`** contains `**/*.test.ts` (Netlify-deploy exclusion), so
  `src/services/speechAudio.test.ts` is ignored and must be `git add -f`-ed
  when committing.

## Recommendation

Accept. All four verification gates green, scope matches the card exactly,
zero regressions on the full suite. The centralized service design keeps the
API footprint small and the browser surface fully isolated — migrating to a
cloud TTS provider later only requires swapping the injectable backend.
