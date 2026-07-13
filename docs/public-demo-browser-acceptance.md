# Public Demo Browser Acceptance Checklist

Use this checklist before a public demo. Record pass/fail evidence for every
section. Local preview checks prove the built app works in a browser; owner-only
checks prove the deployed Supabase and Netlify environment is configured
correctly.

## Local Production Preview

Run from the repository root:

```bash
npm install
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` in a browser. Open DevTools Console and Network
before starting the game. Keep screenshots or notes for failures.

| Item | Expected result | Evidence | Pass/Fail |
| --- | --- | --- | --- |
| Build assets load | The app opens without a blank page, missing chunks, or asset 404s. | | |
| Console baseline | No uncaught runtime errors appear during load, board selection, play, or record viewing. | | |
| Network baseline | Static JS/CSS/font/image requests return successful responses; no repeated failed requests loop. | | |
| CSP visibility | If a Content-Security-Policy header is configured in the tested environment, DevTools shows no CSP violations while loading, playing, viewing records, or calling the AI proxy. | | |
| Responsive smoke test | Desktop and mobile-sized viewports keep controls readable and usable. | | |

## Local 9-Player Playthrough

Start a new 9-player standard game. Run a complete game to a win/loss result.
Because roles are assigned randomly, repeat games as needed until the listed
special-role paths have been observed locally or in production.

| Item | Expected result | Evidence | Pass/Fail |
| --- | --- | --- | --- |
| Board setup | The 9-player board starts with 3 villagers, 3 werewolves, seer, witch, and hunter. | | |
| Night/day loop | Night actions, daytime speeches, voting, death resolution, and next-round transitions progress without stalls. | | |
| Seer check | When the human is seer, check action works, the result is visible only where appropriate, and the game continues after confirmation. | | |
| Witch save | When the human is witch and save medicine is available, the night victim is visible and the save choice resolves correctly. | | |
| Witch poison | When the human is witch and poison is available, selecting a target resolves the death at the correct time. | | |
| Hunter shot | When the human is hunter and dies in a shootable state, the shot UI appears and selected target resolution is applied. | | |
| Werewolf night action | When the human is werewolf, the night kill action and wolf team information are visible and usable. | | |
| AI speeches | AI players produce sensible speech through the local fallback path when no production Gemini proxy is available. | | |
| Win/loss ending | The game reaches a final result screen with winner, player role, and round summary. | | |
| Guest record | As a guest, the completed game appears in local records after the result. | | |

## Local 12-Player Playthrough

Start a new 12-player board and run a complete game to a win/loss result.

| Item | Expected result | Evidence | Pass/Fail |
| --- | --- | --- | --- |
| Board setup | The 12-player board starts with 4 villagers, 4 werewolves, seer, witch, hunter, and idiot. | | |
| Full loop | The game completes through repeated night/day/vote cycles without deadlocks. | | |
| Idiot reveal | When the human or AI idiot is voted out, the idiot behavior is visible and voting rights change according to the rules. | | |
| Special roles | Seer, witch, hunter, werewolf, and idiot paths have each been observed across repeated 12-player runs or combined local/production evidence. | | |
| Hidden identity behavior | Dead player identity display follows the configured visible/hidden identity behavior. | | |
| Win/loss ending | The game reaches a final result screen with winner, player role, and round summary. | | |
| Guest record | As a guest, the completed 12-player game appears in local records after the result. | | |

## Local Offline And Gemini Fallback

These checks intentionally avoid relying on a real Gemini key.

| Item | Expected result | Evidence | Pass/Fail |
| --- | --- | --- | --- |
| No API key leak | Browser source, Network requests, and global variables do not expose `API_KEY` or a Gemini server key. | | |
| Local fallback speech | With local preview and no production proxy, AI speech still appears from the bundled speech library. | | |
| Offline resilience | After loading the app, switch DevTools Network to Offline and continue one interaction; the UI does not crash and any failed network call is handled without exposing secrets. | | |
| Recovery | Return Network to Online and continue or restart a game without reloading into a broken state. | | |

## Owner-Only Production, Supabase, And Netlify Checks

Run these only after the project owner approves the deployed environment and
confirms the intended production URL. Do not change production configuration as
part of this checklist; record findings and escalate failures.

| Item | Expected result | Evidence | Pass/Fail |
| --- | --- | --- | --- |
| Production URL | The production URL loads over HTTPS and serves the current build without mixed-content warnings. | | |
| Netlify SPA fallback | Refreshing a routed app URL returns the app instead of a 404. | | |
| Netlify function | Gemini proxy requests go to the deployed Netlify function, use the allowed origin, and do not expose the server API key. | | |
| Gemini success path | With valid production `API_KEY`, at least one AI speech path succeeds through Gemini or cleanly falls back if Gemini is unavailable. | | |
| CORS | Requests from the production origin are allowed; requests from an unrelated origin are not accepted. | | |
| CSP/network console | DevTools Console has no CSP violations, blocked required resources, mixed content, or uncaught runtime errors during login and gameplay. | | |
| Supabase tables | `profiles` and `game_records` exist with the documented indexes. | | |
| Supabase RLS | RLS is enabled and users can read/write only their own profile and records. | | |
| OTP template | Supabase email template uses `{{ .Token }}` so the user receives a code, not only a magic link. | | |
| Login OTP | A real email receives an OTP, the code verifies, and the app shows the logged-in account state. | | |
| Session restore | Closing and reopening the browser restores the logged-in session according to the 30-day local session behavior. | | |
| Authenticated record save | A completed logged-in game writes a `game_records` row for that user. | | |
| Authenticated record read | The records panel shows the user's saved game, win/loss, role, rounds, and summary after reload. | | |
| Cross-user isolation | A second account cannot view or modify the first account's records through the app or direct Supabase queries using anon credentials. | | |

## Production Playthrough Evidence

Complete at least one production game on each board after login, then repeat as
needed until special-role coverage is recorded.

| Item | Expected result | Evidence | Pass/Fail |
| --- | --- | --- | --- |
| 9-player production game | A logged-in 9-player game completes and saves a record. | | |
| 12-player production game | A logged-in 12-player game completes and saves a record. | | |
| Seer production path | Seer check works in production. | | |
| Witch production path | Witch save and poison choices work in production. | | |
| Hunter production path | Hunter shot works in production. | | |
| Idiot production path | Idiot voted-out behavior works in production on the 12-player board. | | |
| Werewolf production path | Human werewolf night action and wolf team information work in production. | | |

## Final Demo Decision

| Field | Value |
| --- | --- |
| Tester |
| Browser and version |
| Local preview commit/build |
| Production URL |
| Supabase project checked |
| Netlify deploy checked |
| Overall result: Pass/Fail |
| Blocking issues |
| Non-blocking follow-ups |
| Demo approved by owner |
