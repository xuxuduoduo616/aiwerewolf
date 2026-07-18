# Browser Verification: vote-countdown + browser-tts-mvp (Chrome, 2026-07-18)

**Environment:** Chrome via Playwright MCP, Vite dev server (localhost:5173),
baseline b9fdb49. Local dev = speech-library fallback path (banner confirmed:
"Local Vite preview does not run Netlify Functions").

## Vote countdown (vote-countdown-diagnosis-and-fix)

- **Full visual sequence captured from live DOM** (`.timer-pill`, 250ms sampler):
  `10s → 9s → 8s → 7s → 6s → 5s → 4s → 3s → 2s → 1s → 0s` — starts at exactly
  10, integer seconds, no resets, no skips. Screenshot:
  `browser-verification-tts-vote/vote-countdown-live.png`.
- **Timeout abstain verified 3× across 2 games:** human did not vote → log
  shows "You have no vote or abstained" + `Vote record: 1->skip` — never a
  random vote on the player's behalf. Game advanced normally each time.
- **Dead-player path:** after exile (game 1 day 2), no countdown for the dead
  human; AI votes proceeded; phase advanced.
- **VoteSummary panel** rendered structured results (票数/百分比/voter chips/
  放逐出局) after each vote.

## Browser TTS (browser-tts-mvp)

- Header controls present in-game: "AI voice on/off" toggle (aria-pressed
  reflected after click), Volume slider (0–1), Speech rate slider, Mute button.
- **Consent gate:** TTS off by default; after user click on the power toggle,
  `localStorage.werewolf_audio_prefs = {"volume":1,"rate":1,"enabled":true}`.
- **Real speech confirmed:** during AI discussion,
  `window.speechSynthesis.speaking === true` (Chrome, 180 voices loaded).
- Game never blocked: two full games ran to completion (狼人胜利 ×2) with TTS
  enabled, including AI speeches, wolf night kills, hunter shot, witch/seer
  reveals, and records saved to local stats (panel auto-showed on lobby
  return — prior cycle's fix still working).

## Residual findings (not blocking, for follow-up cards)

1. **"that player / the other player" placeholder residue in displayed
   speeches** — sanitized corpus entries render literally as "@that player",
   "Mr. That player", "Miss the other player" instead of resolving to a
   concrete roster reference (e.g. 3号). Root cause: roster-name-fix
   sanitization replaced AIWolf entities with English role-neutral
   placeholders, and the display path does not substitute them with actual
   roster seats. Frequent (most AI speeches in these 2 games). Suggested card:
   placeholder→seat-number resolution at speech-selection time, or zh-side
   placeholder vocabulary.
2. **EN-heavy speech in zh display mode** — most fallback speeches rendered in
   English while display language was zh (library language-preference filter
   may be diluted by the sanitized pool's language mix). Verify against
   lobby-language-authority expectations.

## Verdict

Both cards' owner-facing behaviors verified in a real Chrome session. Evidence
above; unit/integration coverage: 363 tests + audits green at b9fdb49.
