# DeepSeek dialogue integration

DeepSeek refines player-visible daytime dialogue and private wolf chat. Existing
rules, votes, abilities, belief tracking, and action selection remain authoritative.
More reasoning effort is a configuration choice, not a measured guarantee of
stronger Werewolf play.

| Difficulty | Automatic model | reasoning_effort | Maximum output tokens |
| --- | --- | --- | --- |
| Beginner (`easy`) | DeepSeek V4.1 Flash | `low` | 2,048 |
| Intermediate (`normal`) | DeepSeek V4.1 Flash | `high` | 4,096 |
| Expert (`hard`) | DeepSeek V4 Pro | `max` | 8,192 |

Manual model choices keep the selected model and use the same difficulty-to-effort
mapping. In match setup, **Multi-AI Models** sits on the left as the recommended top-level mode when a participating route is verified, and **Single-Model Options** sits on the right as the disclosure entry for individual routes. **Multi-AI Models** assigns the available subset of Gemini 3.6 Flash, Gemini 3.8 Flash, both DeepSeek models, and the Doubao routes across stable seats. Difficulty changes DeepSeek effort, never a mixed-pool seat assignment. Automatic DeepSeek, both individual DeepSeek routes, and Gemini 2.5 Flash are selectable under **Single-Model Options**. Explicit Gemini choices keep their existing behavior.

## Configuration

1. Open the Netlify **aiwerewolf** project → Project configuration → Environment
   variables. Add `DEEPSEEK_API_KEY`, enable **Contains secret values**, and enter
   the key yourself in the intended context, such as Production. Never paste it
   into a chat, repository, or any `VITE_` variable.
2. Functions must receive the variable. `ALLOWED_ORIGIN` must include the exact
   browser origin. Local Netlify Dev also needs its exact origin and a key in
   the local environment; plain Vite uses local fallback without remote calls.
3. A separately authorized deployment must package the candidate Function and
   frontend with this configuration. Saving a key alone does not publish code.
4. The model picker discovers availability via the same-origin provider adapter.
   DeepSeek discovery uses `/models` with a five-second timeout and caches a
   successful exact-ID subset for 60 seconds per function instance. Partial access enables only verified routes; failed lookup leaves the safe backup/local flow playable. `verified_models` distinguishes safe backup selection from verified remote access.

Official model IDs are **`deepseek-flash`** (currently V4.1 Flash) and
**`deepseek-v4-pro`**. `deepseek-auto` is an internal application route, never
sent to DeepSeek. No custom host supplied by the browser is accepted.

## Runtime and costs

- DeepSeek requests enable thinking, use `reasoning_effort`, and request JSON
  output. The output limits above include internal reasoning and final content.
  No temperature or sampling overrides are sent.
- The server allows 45 seconds for the complete upstream response, aborting
  the HTTP request on timeout; the browser allows 48 seconds and supports match
  cancellation. Each DeepSeek request gets one upstream attempt. Failure,
  truncation, invalid JSON, or empty final content uses local dialogue, without
  silently upgrading a manual selection or starting another paid model call.
- Only final `message.content` is returned. `reasoning_content`, credentials,
  upstream errors, prompts, and raw responses are never logged or forwarded.
- Gemini keeps its existing $0.005 per-call ceiling. DeepSeek uses a $0.05
  ceiling so the reasoning allowance fits. Before dispatch, the adapter reserves
  peak cache-miss input cost plus the entire output limit. UTF-8 input bytes plus
  instruction overhead conservatively bound input tokens. Excessive prompts can
  therefore fall back before a paid call.
- The existing shared `ADAPTER_DAILY_BUDGET_USD` defaults to **$0.05 per UTC day
  per warm function instance**. It covers both providers. Valid returned token
  usage settles a successful DeepSeek reservation downward; missing/invalid usage
  and failed calls keep the reservation. Concurrent calls cannot reuse a reserved
  allowance in the same instance. A late successful response never refunds a new
  day's allowance. The default is intentionally restrictive: an Expert request
  needs roughly $0.033 plus input cost available for admission even when actual
  usage is smaller. Increase the configured budget deliberately for extended play.
- These in-memory guards are **not an account-wide spending cap** across Netlify
  instances or restarts. The existing 30 requests/minute/IP and two-failure
  per-model circuit breaker remain active.
- Conservative peak USD rates per million tokens, checked 2026-11-18:
  Flash $0.30 input / $1.20 output; Pro $1.32 input / $3.96 output. Cached input
  and off-peak discounts are not assumed in admission or reporting.

## Verification

Automated coverage should exercise capability failure, each difficulty and manual
choice, day/night propagation, JSON/truncation rejection, cancellation and timeout,
concurrent budget admission, settlement, circuit breaking, CORS, and secret/reasoning
exclusion. Mocked tests prove routing and failure handling; actual provider success,
latency, reasoning sufficiency, and difficulty calibration require a configured
deployment and real matches. These are separate acceptance steps.

Sources: [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing/),
[Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/),
[Chat completions](https://api-docs.deepseek.com/api/create-chat-completion/),
[Model discovery](https://api-docs.deepseek.com/api/list-models/).

## Seat routing and attribution

Mixed-pool seats keep their assigned route for the entire match, independent of role and persona. Daytime speech and private night-chat groups call the assigned model; same-route night speakers may share a request, while different routes run sequentially. Human speakers are always excluded. The browser validates `model_used` and `fallback_used` and commits provenance only with accepted text. Missing/inconsistent metadata shows an unverified source; rejected remote content shows local dialogue. Model-detail and seat accessibility text expose full names.

Current local verification uses HTTP-mocked providers for browser and expression-pipeline tests, plus handler tests for each actual DeepSeek request body. It does not prove production generation, balance or provider reliability. The release coordinator verifies bounded real calls separately.
