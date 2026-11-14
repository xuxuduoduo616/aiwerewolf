# Observability Operations (Local Events + Netlify Function Logs)

> **Status: implemented (plan A, H1-D + H1-F + OBS-DENOM).** This runbook covers
> the observability that exists in the repository: single-line structured logs
> from the two paid serverless functions and a per-match aggregate kept only in
> the player's browser, including a local completion-rate / abandonment-phase
> summary and page-lifecycle abandonment capture (refresh, tab close, or a tab
> left hidden past a grace window). It adds no third-party service, no database
> table, no CSP change and no client credential. The decision context is
> [observability-decision.md](observability-decision.md); this file is the
> operating procedure, not a promise of platform behaviour.

## 1. What is collected

| Surface | Where it lives | What it answers |
| --- | --- | --- |
| Provider failures/fallbacks | Netlify Function logs for `provider-adapter` | Which model failed, why (`timeout`, `rate-limit`, `authentication`, `upstream`, `unavailable`), and whether a fallback was used |
| TTS failures | Netlify Function logs for `bailian-tts` | Whether a failed synthesis was a 429, a timeout, or another upstream failure |
| Per-match cost and fallback counts | Browser `localStorage` key `werewolf.matchTelemetry.v1` | Provider cost estimate per match, synthesis count × fixed estimate, request/failure/fallback counts, completion and winner |
| Completion rate and abandonment phases | Same key (`matches` + `events`) and `summarizeMatches()` in `src/services/matchTelemetry.ts` | How many locally observed matches finished vs were left, in which phase the player was left, and why the match ended without a winner (`reason`) |
| Page-lifecycle abandonment | Same key; `pagehide` / `visibilitychange` listeners installed by `useGameState` through `installPageLifecycleCapture()` | Whether a match was lost to a refresh/tab close/navigation (recorded immediately) or to a tab that stayed hidden past the 20 s grace window |

No prompt, model output, speech text, player name, transcript, email, token, IP
or origin is written by either layer. Enum values, counters and USD estimates
only. The per-match id is a random local id, not an account id.

## 2. Server event schema

Both functions print exactly one JSON object per line with `console.warn`.

### `provider-adapter`

Fields: `event`, `model` (a `MODEL_REGISTRY` id), `cause` (`classifyError`
output), `fallback` (boolean; true when this failure triggers a fallback).

| `event` | When it is emitted |
| --- | --- |
| `provider_timeout` | The 12 s per-model deadline (`cause: timeout`) fires |
| `provider_rate_limited` | Gemini answers 429 (`cause: rate-limit`) |
| `provider_auth_error` | Gemini answers 401/403 (`cause: authentication`) |
| `provider_upstream_error` | Gemini answers 5xx (`cause: upstream`) |
| `provider_fallback` | Any other failure (`cause: unavailable`), including an empty response, and the final local fallback where `model` is `local-fallback` |

A request that exhausts its model chain emits one line per failed attempt plus a
final `{"event":"provider_fallback","model":"local-fallback",...}` line. A
primary failure followed by a secondary success emits only the primary line.
Request-gate rejections that happen before any model work (403 origin, 405
method, 400 body/model, 429 per-IP limit) are intentionally not logged by this
card, so they cannot be mistaken for provider failures.

### `bailian-tts`

Fields: `event`, `lang` (`en-US` or `zh-CN`), `seat` (number).

| `event` | When it is emitted |
| --- | --- |
| `tts_rate_limited` | The upstream synthesis endpoint answers HTTP 429 |
| `tts_timeout` | The shared `AbortSignal.timeout(...)` deadline aborts a request |
| `tts_unavailable` | Any other failed synthesis: other upstream non-2xx, invalid audio URL, unreadable/invalid WAV, auth/network error |

The HTTP response contract is unchanged: every one of these still returns
`502` with `{"code":"TTS_UNAVAILABLE"}`. The line is written while the response
is produced, so a single failed request yields exactly one TTS line.

## 3. Reading Netlify Function logs

Minimal manual path:

1. Open the Netlify UI for this site, go to **Logs → Functions**.
2. Pick the function (`provider-adapter` or `bailian-tts`) and the narrowest
   useful time range around the match or incident.
3. Search the log text for a JSON fragment, for example
   `"event":"provider_rate_limited"`, `"event":"tts_timeout"`, or
   `"model":"local-fallback"`.

Logs are per function instance and are controlled by the Netlify plan. This
repository does not set a retention period, does not ship them anywhere else,
and does not aggregate them across instances. Exact retention, quota, and
export behaviour must be checked in the Netlify account before relying on it;
they were not verified in this change.

The platform itself records request metadata (IP, user agent, path, status)
independently of this code. The structured lines above contain none of it, but
the surrounding platform log entries are not anonymized by this card.

## 4. Reading the local per-match aggregate

Key: `werewolf.matchTelemetry.v1` in the origin's `localStorage`. Value shape:

```json
{
  "version": 1,
  "matches": [
    {
      "version": 1,
      "id": "a random per-match id",
      "startedAt": "ISO-8601",
      "endedAt": "ISO-8601",
      "boardId": "9-standard",
      "difficulty": "normal",
      "language": "en",
      "isGuest": true,
      "completed": true,
      "winner": "VILLAGERS",
      "phaseAtEnd": "GAME_OVER",
      "rounds": 3,
      "durationMs": 185000,
      "providerRequests": 3,
      "providerSuccesses": 2,
      "providerFailures": 1,
      "providerFallbacks": 1,
      "providerCostUSD": 0.0063,
      "ttsRequests": 4,
      "ttsSuccesses": 3,
      "ttsFailures": 1,
      "ttsCostUSD": 0.003,
      "costEstimateUSD": 0.0093,
      "events": {
        "provider_success": 2,
        "provider_failed": 0,
        "provider_timeout": 1,
        "provider_unparsable": 0,
        "tts_success": 3,
        "tts_rate_limited": 0,
        "tts_timeout": 1,
        "tts_unavailable": 0,
        "tts_invalid_media": 0
      }
    }
  ],
  "events": [
    {
      "type": "match_started",
      "matchId": "a random per-match id",
      "at": "ISO-8601",
      "boardId": "9-standard",
      "difficulty": "normal",
      "language": "en",
      "isGuest": true,
      "startedAt": "ISO-8601"
    },
    {
      "type": "match_finished",
      "matchId": "a random per-match id",
      "at": "ISO-8601",
      "winner": "VILLAGERS",
      "rounds": 3,
      "durationMs": 185000,
      "completed": true
    },
    {
      "type": "match_abandoned",
      "matchId": "a random per-match id",
      "at": "ISO-8601",
      "phase": "DAY_VOTING",
      "round": 2,
      "durationMs": 95000,
      "completed": false,
      "reason": "page-hidden"
    }
  ]
}
```

`matches` is newest-first and keeps at most 20 finished matches. The top-level
`events` ledger is chronological and keeps at most 40 lifecycle events (the last
20 matches × start + end). The active match is module memory until it finishes
or is finalized by the page-lifecycle capture: `pagehide` (refresh, tab close,
navigation) and a hidden tab past the grace window finalize it synchronously, so
the `match_started` and its `match_abandoned` are written before the page
unloads. A crash, an OS-level kill or a page frozen/discarded without `pagehide`
still discards the active aggregate.

### Field notes

| Field | Meaning |
| --- | --- |
| `providerRequests` | Client-side expression requests attempted |
| `providerSuccesses` / `providerFailures` | Outcome split; `providerFallbacks` counts outcomes that forced the local speech-library fallback |
| `providerCostUSD` | Sum of the server's `cost_estimate` values for successful calls |
| `ttsRequests` / `ttsSuccesses` / `ttsFailures` | Per-clip synthesis attempts and outcomes (`ttsRequests = successes + failures`) |
| `ttsCostUSD` | `ttsSuccesses × TTS_COST_PER_SYNTH_USD` (`0.001` USD in `src/services/matchTelemetry.ts`) |
| `costEstimateUSD` | `providerCostUSD + ttsCostUSD` |
| `events` | Counters for `provider_success`, `provider_failed`, `provider_timeout`, `provider_unparsable`, `tts_success`, `tts_rate_limited`, `tts_timeout`, `tts_unavailable`, `tts_invalid_media` |
| `completed` / `winner` / `phaseAtEnd` | Whether the match reached `GAME_OVER`; abandoned matches carry the phase in which the player left, or `SUPERSEDED` if a new match replaced an unfinished one |
| `rounds` / `durationMs` | Final round count and wall-clock duration of the match; `0` on records written before H1-F |
| top-level `events` | Chronological lifecycle ledger: `match_started`, `match_finished`, `match_abandoned`; capped with the retained matches (40 events) |
| `reason` (on `match_abandoned`) | Why the match ended without a winner: `leave-game` (in-game back/leave), `page-hidden` (refresh/tab close/navigation or a long-hidden tab), `superseded` (a new match replaced an unfinished one). Optional: older ledgers have no `reason` and are counted as `unknown` |

### Cost interpretation

Only `providerCostUSD` comes from a server-supplied estimate (`cost_estimate`),
and that number is itself an estimate based on token assumptions, not an invoice.
`ttsCostUSD` is a **fixed planning constant**, not a billed amount; the voice
provider returns no per-request price. Treat the aggregate as a trend and
order-of-magnitude signal, not as accounting.

### Browser DevTools

1. Open the app, then **DevTools → Application → Local Storage → the site
   origin**.
2. Select `werewolf.matchTelemetry.v1` and copy the value, or run
   `copy(localStorage.getItem('werewolf.matchTelemetry.v1'))` in the Console.
3. To delete it, run `localStorage.removeItem('werewolf.matchTelemetry.v1')` or
   call `reset()` from `src/services/matchTelemetry.ts`.

### Offline read-only script

Node cannot read the browser store directly. Export the value from DevTools to
a local JSON file (for example `match-telemetry.json`) and read that copy:

```bash
node -e "const s=require('./match-telemetry.json'); for (const m of s.matches) console.log(m.startedAt, m.boardId, m.completed, m.winner, 'provider', m.providerRequests, m.providerFailures, 'tts', m.ttsRequests, m.ttsFailures, 'usd', m.costEstimateUSD)"
```

Retention is the browser ring buffer (20 matches). Clearing site data, using
private mode, changing browser profile or device all remove the history. Private
mode falls back to module memory for the current session and never throws.

## 5. Reading completion rate, abandonment phases and reasons

### Lifecycle events

`startGame()` records `match_started`, the `GAME_OVER` transition records
`match_finished`, `leaveGame()` on an unfinished match records
`match_abandoned`, and the page-lifecycle capture records `match_abandoned` when
the page is refreshed/closed or stays hidden past the grace window. Start and
end events are buffered with the active aggregate and flushed together when the
match finalizes, so the stored ledger never contains a `match_started` without a
matching end event.

| `type` | When | Fields (besides `type`, `matchId`, `at`) |
| --- | --- | --- |
| `match_started` | `startGame()` accepted the setup | `boardId`, `difficulty`, `language`, `isGuest`, `startedAt` |
| `match_finished` | `winner` became non-null and the phase reached `GAME_OVER` (recorded once) | `winner`, `rounds`, `durationMs`, `completed: true` |
| `match_abandoned` | `leaveGame()` while the match had no winner (`reason: leave-game`); `pagehide` / a hidden tab past the grace window (`reason: page-hidden`); a new match replacing an unfinished one (`reason: superseded`) | `phase`, `round`, `durationMs`, `completed: false`, optional `reason` |

`matchId` is the random local per-match id, not an account id. Events contain
enums, counters and timestamps only; no player name, speech text, email, token
or user id.

### Page-lifecycle abandonment (`pagehide` / `visibilitychange`)

`useGameState` installs the capture once per mount through
`installPageLifecycleCapture()` in `src/services/matchTelemetry.ts` and removes
it on unmount. It is telemetry only: the phase machine, timers, votes and AI
call order are untouched.

- **`pagehide`** (refresh, tab close, navigation, entering the bfcache) is a real
  unload: the active match is finalized immediately with `reason: page-hidden`
  and the write is synchronous, so the buffered `match_started` is persisted
  together with the `match_abandoned` before the page goes away.
- **`visibilitychange` → hidden** (alt-tab, app switch, screen lock) starts a
  grace timer of `PAGE_HIDDEN_GRACE_MS = 20_000` (20 s). If the page becomes
  visible again before the timer fires, nothing is written — a transient tab
  switch is not a lost player. Only a page still hidden when the timer fires is
  finalized as `page-hidden`. 20 s was chosen because a quick peek at another tab
  usually lasts seconds while tab-switch churn is real drop-off; the constant is
  defined once (with the rationale) in `src/services/matchTelemetry.ts`.
- **One end event per match.** `endMatch()` is idempotent, so `leaveGame()` then
  `pagehide`, `GAME_OVER` then `pagehide`, repeated hidden/pagehide events, or a
  bfcache restore (`pageshow`) never add a second `match_abandoned` /
  `match_finished` for the same `matchId`. A match already finished normally is
  never counted as abandoned. With no active match (lobby, finished match) the
  capture writes nothing.
- **bfcache caveat.** Entering the bfcache fires `pagehide`, so a match restored
  with the back button has already been counted as one `page-hidden`
  abandonment. The ledger keeps exactly one end event per match, so it stays one
  abandonment; a later `match_finished` is not added for that restored match.
- **Failure isolation.** Listener registration, timer and storage failures are
  caught; telemetry never blocks or alters unload. If `localStorage` is denied
  (private mode, full quota) the abandonment only lives in module memory and is
  lost when the page unloads.

### `summarizeMatches()`

`src/services/matchTelemetry.ts` exports a pure summary function:

```ts
import { summarizeMatches } from './src/services/matchTelemetry';

summarizeMatches();              // read the persisted ledger
summarizeMatches(parsedStorage); // or inject a copied snapshot in tests
```

It ignores malformed entries, never throws, and returns:

```json
{
  "started": 4,
  "finished": 2,
  "abandoned": 2,
  "completionRate": 0.5,
  "abandonedByPhase": { "DAY_VOTING": 1, "NIGHT_WEREWOLVES": 1 },
  "abandonedByReason": { "page-hidden": 1, "unknown": 1 },
  "averageRounds": 4
}
```

> The sample above is built from unit-test fixtures in
> `src/services/matchTelemetry.test.ts`; it is not a real match.

- `started` / `finished` / `abandoned` count lifecycle events.
- `completionRate = finished / started`; when `started === 0` it is `0`, never `NaN`.
  The denominator now includes matches lost to `pagehide` / long-hidden tabs, so
  an ordinary refresh or tab close lowers the local completion rate instead of
  disappearing from it.
- `abandonedByPhase` is a histogram of `phase` for abandoned matches.
  `SUPERSEDED` means a new match replaced an unfinished one.
- `abandonedByReason` is a histogram of the `reason` field:
  `leave-game` (in-game back/leave), `page-hidden` (refresh/tab close/navigation
  or a tab hidden past the grace window), `superseded` (new match replaced an
  unfinished one). Events and records written before OBS-DENOM carry no reason
  and are counted as `unknown`, so `sum(abandonedByReason) === abandoned`.
- `averageRounds` averages the final `rounds` of finished matches (`0` if none).
- Only finalized matches are counted: the active match and its buffered
  `match_started` event appear in the summary after it finishes, is left
  in-game, or is finalized by `pagehide` / the hidden grace window.

### Manual read from an exported ledger

```bash
node -e "const s=require('./match-telemetry.json');const e=s.events??[];const n=t=>e.filter(x=>x.type===t).length;const p={};const r={};for(const x of e)if(x.type==='match_abandoned'){p[x.phase]=(p[x.phase]??0)+1;r[x.reason??'unknown']=(r[x.reason??'unknown']??0)+1}console.log({started:n('match_started'),finished:n('match_finished'),abandoned:n('match_abandoned'),completionRate:n('match_started')?n('match_finished')/n('match_started'):0,abandonedByPhase:p,abandonedByReason:r})"
```

For ledgers written before H1-F (no `events` array), `summarizeMatches()` falls
back to the `matches` records (`completed` / `phaseAtEnd` / `rounds`); those
abandonments are reported as `abandonedByReason.unknown`.

### What these numbers do and do not cover

**Local capture is ready; this is not production user data.** The numbers exist
only in the browser profile that played the matches. They cannot be aggregated
across players or devices and must not be quoted as a product-wide completion
rate.

Residual risk: the active match record and its buffered `match_started` event
still start in module memory until the match finalizes. `pagehide` (refresh, tab
close, navigation) and the hidden-grace path now finalize the active match
synchronously before unload, so an ordinary refresh or tab close is counted as a
`page-hidden` abandonment and enters the `completionRate` denominator; the
stored ledger keeps a strict one-to-one
`match_started` ↔ (`match_finished` | `match_abandoned`) relation. Still invisible
or approximate:

- A crash, an OS-level kill, a browser discard without `pagehide`, or a page
  frozen before the grace timer runs writes no event, so that drop-off stays out
  of the denominator and `completionRate` remains biased upward for it.
- Blocked `localStorage` (private mode, full quota) keeps the aggregate in module
  memory only; a page unload then discards it, so the abandonment is invisible.
- A transient tab switch shorter than `PAGE_HIDDEN_GRACE_MS` (20 s) is
  deliberately not counted; the hidden time is attributed to no counter.
- A match recorded as `page-hidden`, restored from the bfcache and then won
  still counts as abandoned: the ledger keeps exactly one end event per match and
  does not add a later `match_finished` for it.
- Timer throttling in a hidden tab can delay the grace timer, so the recorded
  `at` may be later than the nominal 20 s.
- `abandonedByReason` can only label writes made since OBS-DENOM; older events
  and the `matches` fallback count as `unknown`.
- Browser behaviour for `pagehide`/bfcache was verified by unit tests with fake
  event targets, not on real devices; a browser that never fires `pagehide` on
  close falls back to the invisible cases above.

Retention: 20 matches / 40 lifecycle events; oldest entries are dropped first.

## 6. Is this enough?

**Enough for:** single-match cost and fallback inspection, provider/TTS failure
counting, local completion vs abandonment with phase and reason inspection
(including refresh / tab-close / long-hidden-tab drop-off), and point debugging
by function name and time window.

**Not enough for:** cross-user or cross-instance aggregation, 7/30-day trend
dashboards, threshold alerting, frontend crash/CSP reporting, crash/hard-kill
drop-off, upstream error distribution beyond the three TTS classes, correlation
of a client match with the platform log entries for the same request (no shared
request id), and server-side retention or deletion policy. Local history also
disappears with browser data and cannot represent real-user completion rates.

## 7. If a third-party service or a new table is chosen later

That is explicitly out of scope here. It needs a new card and owner approval:

- Plan B (own events function and/or Supabase table): new function, whitelist
  transport, table + migration + RLS + retention job, and owner sign-off on the
  schema/privacy questions in
  [observability-decision.md](observability-decision.md). None of it is
  implemented by this card.
- Plan C (third-party SaaS): vendor/DPA/privacy review, an exact CSP
  `connect-src` (and possibly `script-src`) change through a separate header
  card, and SDK failure isolation. Not implemented by this card.

Until then, use the local key and the Netlify function logs described above.
