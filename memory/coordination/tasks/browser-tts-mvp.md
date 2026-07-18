# Task: browser-tts-mvp

## Status

Queued

## Objective

AI players' speeches are read aloud via the browser Web Speech API
(`speechSynthesis`), synced with the displayed text, through a single
centralized audio service — presentation-only, never blocking or mutating the
game, activated only after an explicit user gesture.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/tasks/ai-speech-roster-name-fix.md` +
  `memory/coordination/reports/ai-speech-roster-name-fix.md` (roster guard —
  the FINAL displayed text this card must read)
- `memory/coordination/tasks/header-icon-tooltips.md` (header icon-button
  conventions: tooltips, aria-labels, sizes)
- `src/App.tsx` (mute button ~line 221: `isMuted` state + `Volume2`/`VolumeX`
  icons EXIST; log rendering via `visibleText`; header icon-button row)
- `src/hooks/useGameState.ts` (`isMuted` state line 153, `addLog` ~line 291,
  `handleDiscussion` AI speech path ~lines 592–612, `visibleText` ~line 778)
- `src/services/` (service module conventions), `src/services/rosterGuard.ts`
- `src/i18n/index.ts` (`LANGUAGE_STORAGE_KEY` localStorage pattern — mirror it
  for audio preferences)
- `src/types.ts` (`GameLog`: `id`, `speakerId`, `message`, `translation`,
  `tone`)

## Context

- **Mute state exists; audio system does NOT.** `isMuted` is a bare boolean
  toggling the header icon — nothing consumes it. This card builds the first
  audio path and wires `isMuted` into it.
- **Centralized service:** create `src/services/speechAudio.ts` (follow the
  existing service-module style, e.g. `translationService.ts`). Components and
  hooks NEVER call `speechSynthesis` directly — only this service. It owns:
  - a single queue, max one active utterance; enqueue(next) cancels or waits
    per the ordering rules below;
  - dedupe by speech/log ID (`GameLog.id`): a given log is spoken at most once
    across rerenders (rerender-safe, play-once);
  - cancel-all on: new game, restart, leaving/skip of the current speech,
    mute-on, and game over;
  - stable voice per `playerId`: deterministic mapping from playerId into the
    same-language voice list (e.g. index by playerId hash), falling back to the
    same-language default voice, then any voice; handle the async
    `voiceschanged` event (voice list is often empty on first call);
  - graceful no-op when `window.speechSynthesis` is absent — every public
    method safe to call unconditionally.
- **What text is spoken:** the FINAL displayed text — post roster-guard, post
  translation — exactly what `visibleText(log)` renders in the current display
  language; `utterance.lang` matches that language (`zh-CN`/`en-US`). NEVER the
  pre-translation or pre-guard version. Event order (must hold):
  speech generated → roster/name + language check → final text displayed
  (addLog) → enqueue → play (or timeout) → next speaker.
- **Never blocks the game:** TTS failure/absence leaves the text flow
  unaffected. The AI turn MAY await speech end so audio and pacing sync, but
  with a hard maximum duration (utterance-length-derived cap, e.g.
  `min(maxMs, base + perCharMs * text.length)`), after which it falls back to
  the existing text timing. Vote deadlines and phase timers are independent of
  TTS — audio never pauses or extends them.
- **Presentation-only invariant:** the service must not mutate game state,
  names, votes, logs, or timing rules. Text remains authoritative.
- **Autoplay policy:** speech starts only after an explicit user gesture. The
  EXISTING mute-button flip counts as that gesture ("开启声音") — record the
  gesture when the user unmutes; do not attempt to bypass autoplay policies or
  auto-start on load.
- **UI (extend the existing header, follow header-icon-tooltips conventions —
  tooltips + aria-labels + mobile-friendly hit sizes):**
  - keep the speaker/mute icon (extend behavior: mute cancels current audio);
  - master volume slider (0–1, applied to `utterance.volume`);
  - "AI 语音" on/off toggle (independent of master mute);
  - optional rate slider, default 1.0 (`utterance.rate`);
  - persist audio preferences via the existing localStorage pattern (mirror
    `LANGUAGE_STORAGE_KEY` in `src/i18n/index.ts`: try/catch, private-mode
    safe), e.g. `werewolf_audio_prefs`.
- **Optional countdown tick:** a restrained tick sound ONLY during the last 3
  seconds of the vote countdown (from `vote-countdown-diagnosis-and-fix`),
  obeying mute + the gesture requirement. Keep it minimal (short
  WebAudio/oscillator blip is fine); skip entirely when muted or gesture not
  yet given. This is optional polish — do not let it grow scope.
- **Repo test convention:** no jsdom/@testing-library. Design the service so
  its core is testable with an injected/mocked `speechSynthesis`-like object
  (constructor/init parameter), keeping pure decision helpers exported.
- Scope boundary: browser-native TTS only. NO cloud TTS, NO network calls, NO
  Netlify function changes, NO new dependencies.
- Dependencies: `vote-countdown-diagnosis-and-fix` (App.tsx/useGameState.ts
  overlap + tick-sound hook point) and `ai-speech-roster-name-fix` (in review —
  final text passes through `rosterGuard`; this card must start from a HEAD
  that includes it, or coordinator adjusts at dispatch).
- Parallel wave: runs ALONE after wave A (see planning report). May overlap in
  time only with `cloud-tts-adapter-spike` (docs-only) if that spike is still
  running.

## Allowed changes

- `src/services/speechAudio.ts` (new) + `src/services/speechAudio.test.ts` (new)
- `src/hooks/useGameState.ts` (wire enqueue on final displayed AI speech; AI
  turn await-with-timeout; cancel hooks on game lifecycle — no rule changes)
- `src/App.tsx` (header audio controls: extend mute button, volume slider,
  AI-voice toggle, rate slider; countdown tick hookup)
- `src/i18n/index.ts` ONLY if a shared storage helper is extracted — prefer
  duplicating the 10-line try/catch pattern locally instead

## Do not change

- `src/gameEngine.ts`, `src/ai/**` decision logic, `src/services/rosterGuard.ts`,
  `src/services/translationService.ts` (consume their output only).
- `netlify/**`, `package.json` dependencies, deployment configuration.
- Vote countdown semantics from `vote-countdown-diagnosis-and-fix` (tick sound
  observes it; never alters it).
- Unrelated code, credentials, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. AI speeches are spoken via a single centralized service; no component or
   hook calls `speechSynthesis` APIs directly (grep-verifiable: the only
   `speechSynthesis` references live in `src/services/speechAudio.ts`).
2. Spoken text is byte-identical to the final displayed text
   (post roster-guard, post translation) in the current display language, and
   `utterance.lang` matches; the pre-translation version is never spoken.
3. Voice selection is deterministic per playerId, falls back to a
   same-language default, and handles async `voiceschanged`.
4. Single queue, max one speaker at a time; per-log-ID dedupe survives
   rerenders (play-once); new speech/skip/restart/leave/mute cancels current
   audio.
5. TTS failure or API absence never blocks or alters the game: text flow,
   phase advancement, and vote deadlines are unaffected; the AI-turn await has
   a hard max duration then falls back to existing text timing.
6. Audio starts only after an explicit user gesture (unmute counts); no
   autoplay-policy bypass. Muting stops audio immediately.
7. Header UI: extended speaker/mute icon, master volume slider, "AI 语音"
   toggle, rate slider (default 1.0); preferences persist across reloads via
   localStorage; all controls have tooltips + ARIA labels + mobile-friendly
   sizes per header-icon-tooltips conventions.
8. Optional last-3s vote-countdown tick obeys mute and gesture gating (or is
   explicitly reported as skipped with reason).
9. Tests with a mocked speechSynthesis cover: play, queueing order, dedupe,
   cancel (mute/skip/new game), lang selection, voice fallback (incl. empty
   voice list then `voiceschanged`), await-timeout fallback, and API-absent
   graceful no-op.
10. Baseline tests still pass (309+ or current baseline), zero regressions;
    `npm run build` succeeds.
11. Chrome browser verification checklist provided for the coordinator's
    integration pass (this card lists WHAT to verify; the coordinator runs it):
    start a real game → unmute → AI speech is audible and matches displayed
    text/language → only one voice at a time → mute silences immediately →
    volume/rate sliders take effect → human vote phase countdown unaffected by
    audio → refresh keeps preferences → game completes normally with audio on.

## Verification

```bash
npm run test:run   # 309+ (or current baseline) + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/browser-tts-mvp.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  the Chrome verification checklist, decisions (queue/timeout/voice-mapping
  design), residual risks (voice availability varies by OS/browser), and a
  recommendation to the coordinator.
