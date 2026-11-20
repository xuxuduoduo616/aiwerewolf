# Doubao (Volcano Ark) dialogue integration

Doubao refines player-visible daytime dialogue and private wolf chat. Rules,
votes, abilities, belief tracking, and action selection remain authoritative.
This is an expression-only route: it never decides a target and never receives
hidden information beyond the acting seat's own prompt.

| Route | Upstream model ID | Thinking | CNY input / output per 1M tokens (0–32K) | USD input / output per 1K tokens |
| --- | --- | --- | --- | --- |
| `doubao-seed-1.6-flash` | `doubao-seed-1-6-flash-250615` | Disabled on first attempt | 0.15 / 1.50 | 0.000021127 / 0.000211268 |
| `doubao-seed-character` | `doubao-seed-character-260628` | Parameter omitted | 0.80 / 2.00 | 0.000112676 / 0.000281690 |
| `doubao-seed-2.1-lite` | `doubao-seed-2-1-lite-260915` | Explicitly disabled on both attempts | 0.80 / 2.70 | 0.000112676 / 0.000380282 |

The adapter uses these configured rates at 7.10 CNY/USD. Confirm actual model
version IDs and billed rates against the Ark console. Each request has a
512-token output cap, a 20-second server timeout per attempt and a 26-second
browser timeout.

Multi AI Model assigns stable seats from the verified subset of Gemini 3.6
Flash, DeepSeek Flash, DeepSeek V4 Pro and the three Doubao routes. Each
discovered Doubao route is also available individually. Difficulty does not
change a Doubao request.

## Configuration

1. Netlify **aiwerewolf** project → Project configuration → Environment
   variables → add `ARK_API_KEY`, enable **Contains secret values**, and enter
   the key yourself. Never paste it into a chat, a repository file, or a
   `VITE_` variable.
2. Optional `ARK_DOUBAO_MODEL` overrides only the 1.6 Flash upstream version ID when the
   console exposes a different one. The client-facing route name never changes.
   Use the **model version id** (`doubao-seed-1-6-flash-250615` style), not a
   custom inference endpoint id: the Models API lists versions, so an `ep-…`
   value can never pass discovery.
3. `ALLOWED_ORIGIN` must contain the exact browser origin. Local Netlify Dev
   also needs it plus the key in the local environment; plain Vite never calls a
   provider.
4. Raise `ADAPTER_DAILY_BUDGET_USD` deliberately: the shared default is
   **$0.05 per UTC day per warm function instance** across Gemini, DeepSeek, and
   Doubao. For an owner-approved local smoke test, set the local budget to $1.

Discovery calls `GET https://ark.cn-beijing.volces.com/api/v3/models` with a
five-second timeout and a 60-second per-instance cache. Each route is matched
independently against its configured upstream ID or its exact catalog ID.
An unrelated version does not match. A partial list leaves the verified subset
available for seat assignment. Single-model failures return local dialogue.

## Request shape and failure handling

- `POST https://ark.cn-beijing.volces.com/api/v3/chat/completions` with
  `Authorization: Bearer $ARK_API_KEY`, one system instruction and one user
  prompt, `max_tokens: 512`, and `response_format: { type: 'json_object' }`
  for JSON requests. Character omits `thinking` on every attempt.
- If Ark rejects an optional parameter with HTTP 400, the adapter retries once
  with the minimal body. Seed 2.1 Lite retains its explicit thinking disable
  setting. Other statuses are never retried.
- Only final `message.content` is returned. `reasoning_content`, credentials,
  upstream errors, prompts, and raw responses are never logged or forwarded.
  A fenced JSON reply is accepted; truncated, empty, non-object, or invalid JSON
  falls back to local dialogue.
- Two consecutive failures open the existing 60-second per-model circuit
  breaker. The 30 requests/minute/IP limit is shared with every other route.

## Costs and admission

- Before dispatch the adapter reserves peak input (UTF-8 bytes plus instruction
  overhead) and the entire 512-token output limit. Valid returned usage settles
  the reservation downward; missing or invalid usage and failures keep it.
- The shared $0.005 per-call ceiling applies to Doubao. The estimate varies
  by route and by the UTF-8 byte length of the submitted prompt.
- Cache-hit, batch, and promotional discounts are not assumed.
- These in-memory guards are not an account-wide spending cap across Netlify
  instances or restarts. Set a provider-side spending limit in the Volcano
  console as well.

## Verification

Local evidence covers: whitelisting, request body, version override, the 400
retry, missing key, Ark failure, truncation/invalid JSON rejection, fenced JSON
acceptance, exact-version discovery, non-listed version rejection, CORS,
20-second timeout, and the offline dry-run contract. These prove routing and
failure handling only.

Actual generation, latency, quota, balance, and spending are **not verified**
until a configured deployment performs a real call. A real call is a separate
owner-approved step. Check Character's English dialogue quality and JSON
compatibility, including JSON validation after a compatibility retry. Confirm
Seed 2.1 Lite's billed rate in the console. A retry can make the total server
time exceed the browser deadline or the deployed Netlify function limit.

Sources: [Compatible with OpenAI SDK](https://ark.volcengine.com/region:cn-beijing/docs/compatible-with-openai-sdk),
[Models API](https://docs.volcengine.com/docs/ark/models-api?lang=zh),
[Model pricing](https://ark.volcengine.com/region:cn-beijing/docs/model-pricing).
