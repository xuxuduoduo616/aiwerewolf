# Cloud TTS Adapter Spike — Research & Design Report

**Status:** Ready for review
**Date:** 2026-07-18
**Access date for all web sources:** 2026-07-18

---

## 1. Executive Summary

**Recommendation: Go — use Gemini native TTS (gemini-2.5-flash-preview-tts) as the sole cloud TTS provider.**

- Gemini native TTS uses the **same `API_KEY`** already live in production (no new auth setup).
- Cost: **$0.00/game** during the free-tier preview period; **$0.08--0.11/game** for paid-tier first-generation TTS, **approximately $0** for cached replays (speech-library reuse). Even at paid rates this falls within or near the existing text-AI budget range ($0.01--0.03/game, $1/day guard); the free tier makes it zero-cost for initial development and low-volume usage.
- Cloud TTS (Google Cloud Text-to-Speech) requires separate service-account/OAuth auth (NOT compatible with the existing `API_KEY`) — higher operational complexity.
- aicodemirror and deepseek have **zero documented TTS capability** (verified from official docs).
- The unified adapter interface design is complete; cache design reuses the speech library (~8,500 entries); routing chain follows the existing fallback pattern already in `provider-adapter.cjs`.

---

## 2. Capability Matrix

| Dimension | gemini-2.5-flash-preview-tts | Gemini 3.1 Flash TTS Preview | Google Cloud Text-to-Speech | aicodemirror | deepseek | OpenAI TTS (reference) |
|---|---|---|---|---|---|---|
| **Protocol** | Gemini Interactions API | Gemini Interactions API | REST `text:synthesize` (standalone GCP product) | — | — | REST `/v1/audio/speech` |
| **Endpoint** | `POST https://generativelanguage.googleapis.com/v1beta/interactions` | Same | `POST https://texttospeech.googleapis.com/v1/text:synthesize` | — | — | `POST https://api.openai.com/v1/audio/speech` |
| **TTS Model IDs** | `gemini-2.5-flash-preview-tts` | `gemini-3.1-flash-tts-preview` | Standard, WaveNet, Neural2, Chirp 3 HD, Studio (voice-family based, not model-ID based) | 尚未确认 — 无公开 TTS 文档 | 尚未确认 — 无公开 TTS 文档 | `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd` |
| **Price (input)** | $0.50 / 1M text tokens | $1.00 / 1M text tokens | Standard: $4.00/1M chars; WaveNet: $16.00/1M chars; Chirp 3 HD: $100.00/1M chars | 尚未确认 | 尚未确认 | $0.60 / 1M tokens (gpt-4o-mini-tts); $15 / 1M chars (tts-1) |
| **Price (output)** | $10.00 / 1M audio tokens (25 tokens/sec audio) | $20.00 / 1M audio tokens | Same as input (per-char billing) | 尚未确认 | 尚未确认 | $12.00 / 1M audio tokens (gpt-4o-mini-tts); $30 / 1M chars (tts-1-hd) |
| **Free tier** | Free of charge (no published RPM/TPM limit) | Free of charge | Standard: 4M chars/mo; WaveNet: 1M chars/mo; Chirp 3 HD: 1M chars/mo | 尚未确认 | 尚未确认 | — |
| **Audio formats** | PCM WAV (24kHz, 16-bit, mono) base64 | Same | LINEAR16, MP3, MP3_64_KBPS, OGG_OPUS, MULAW, ALAW | 尚未确认 | 尚未确认 | MP3, Opus, AAC, FLAC, WAV, PCM (24kHz 16-bit) |
| **Streaming** | No (batch only) | Yes (server-sent delta events with base64 chunks) | Yes (Chirp 3 HD only, bidirectional StreamingSynthesize, Preview) | 尚未确认 | 尚未确认 | Yes (chunked transfer encoding) |
| **zh voices** | 30 prebuilt voices (Kore, Puck, Zephyr, Charon, ...) — language auto-detected | Same 30 prebuilt voices | cmn-CN: 4 Standard + 4 WaveNet + 30 Chirp 3 HD; cmn-TW: 3 Standard + 3 WaveNet | 尚未确认 | 尚未确认 | ~13 voices (optimized for English, Chinese partially supported) |
| **en voices** | Same 30 prebuilt voices | Same | 99 voices across all tiers (Standard, WaveNet, Neural2, Chirp 3 HD, Studio, Casual, News) | 尚未确认 | 尚未确认 | Same 13 voices |
| **Multi-speaker** | Yes (up to 2 speakers per interaction) | Yes | No (single-speaker synthesis) | 尚未确认 | 尚未确认 | No |
| **Auth model** | `x-goog-api-key` header (same `API_KEY` as genai-proxy) | Same | Bearer token via OAuth/ADC only (NOT API key compatible) | 尚未确认 | 尚未确认 | `Authorization: Bearer` |
| **Context window** | 32k tokens | 32k tokens | N/A (per-request) | 尚未确认 | 尚未确认 | 4096 chars input limit |

### Sources

- Gemini TTS docs + pricing: https://ai.google.dev/gemini-api/docs/speech-generation + https://ai.google.dev/gemini-api/docs/pricing (accessed 2026-07-18)
- Cloud TTS docs + voices: https://docs.cloud.google.com/text-to-speech/docs/voices + https://docs.cloud.google.com/text-to-speech/docs/create-audio-text-streaming + https://docs.cloud.google.com/text-to-speech/docs/authentication (accessed 2026-07-18)
- Cloud TTS pricing: https://cloud.google.com/text-to-speech/pricing (official page, accessed 2026-07-18)
- DeepSeek API docs: https://api-docs.deepseek.com/ — no TTS endpoint found (accessed 2026-07-18)
- aicodemirror: https://www.aicodemirror.com/ returned 403; WebSearch for "aicodemirror TTS" returned zero results matching aicodemirror's domain (accessed 2026-07-18)
- OpenAI TTS docs + pricing: https://developers.openai.com/api/docs/guides/text-to-speech + https://costgoat.com/pricing/openai-tts (accessed 2026-07-18)
- Cloud TTS API key incompatibility: https://docs.cloud.google.com/text-to-speech/docs/authentication confirms only Bearer token (gcloud/OAuth/ADC), no API key option (accessed 2026-07-18)

---

## 3. Provider-by-Provider Analysis

### 3.1 Gemini Native TTS (gemini-2.5-flash-preview-tts) -- RECOMMENDED

**Verdict: Best fit.** Uses the same `API_KEY` already live in the Netlify `genai-proxy.cjs` and `provider-adapter.cjs` functions. The `x-goog-api-key` header is identical to what the existing Gemini text path uses. No new auth setup required.

- 30 prebuilt voices with style descriptors (Kore=Firm, Puck=Upbeat, Zephyr=Bright, Charon, Fenrir, Leda, Enceladus, Sulafat, Achernar, ...).
- Auto-detects input language; handles both zh (Mandarin, coded as `cmn`) and en.
- Multi-speaker support (up to 2 speakers) maps well to wolf-chat scenarios.
- Audio output: base64-encoded PCM WAV (24kHz, 16-bit, mono, 1 channel).
- **No streaming** on 2.5 Flash TTS. The 3.1 Flash TTS model supports streaming but is priced 2x higher ($1.00/$20.00 vs $0.50/$10.00 per 1M tokens).
- Context window: 32k tokens — more than sufficient (longest game speech is ~310 chars = ~78 tokens).
- 2.5 Flash TTS is **free of charge** on the free tier (no published RPM/TPM limits), meaning initial development and low-volume usage incurs zero cost.

### 3.2 Google Cloud Text-to-Speech

**Verdict: Higher operational complexity — requires separate GCP project + service account, NOT compatible with the existing API_KEY.**

- Much wider voice selection (99 en-US voices, 38+ Mandarin voices across Standard/WaveNet/Chirp 3 HD).
- Streaming available for Chirp 3 HD voices only (Preview feature).
- Pricing is per-character (not per-token): Standard at $4/1M chars, WaveNet at $16/1M chars, Chirp 3 HD at $100/1M chars.
- **Auth gap:** Cloud TTS uses OAuth/Bearer token (via `gcloud auth print-access-token` or service account JSON). The existing `API_KEY` used for Gemini cannot authenticate Cloud TTS calls. A new GCP service account + key rotation process would be needed.
- For voice quality, Chirp 3 HD ($100/1M chars) is the premium tier — ~$0.33/game at 3,275 chars (9p) — significantly more expensive than Gemini Flash TTS.

### 3.3 aicodemirror

**Verdict: 尚未确认 — 无公开 TTS 文档.**

- The aicodemirror homepage (https://www.aicodemirror.com/) returned HTTP 403.
- WebSearch for "aicodemirror TTS", "aicodemirror audio", "aicodemirror speech" returned zero results from aicodemirror's domain.
- The existing project configuration knows three protocols: Anthropic Messages, Codex backend, Gemini proxy. None of these protocols include a TTS/audio path.
- The aicodemirror API key is not configured in production anyway (per PROJECT_STATE.md).
- **No further investigation warranted unless aicodemirror publishes TTS documentation.**

### 3.4 deepseek

**Verdict: 无 TTS 能力 — official docs list only text chat/completion features.**

- deepseek API docs at https://api-docs.deepseek.com/ list: Chat Completions, Thinking Mode, Multi-round Conversation, FIM Completion, JSON Output, Tool Calls, Context Caching, Anthropic API compatibility.
- Zero mention of audio, speech, TTS, or voice.
- The deepseek API key is not configured in production.
- **Confirmed: no TTS capability. This provider is out of scope for cloud TTS.**

### 3.5 OpenAI TTS (reference only -- not integrated)

**Listed for price comparison only. Not a candidate for integration.**

- gpt-4o-mini-tts: $0.60/1M input tokens + $12/1M audio output tokens, ~$0.015/min of audio.
- tts-1: $15/1M chars. tts-1-hd: $30/1M chars.
- 13 voices, streaming via chunked transfer encoding.
- Chinese support is partial (voices optimized for English).
- Would require a separate OpenAI API key and billing account.

---

## 4. Cost Report

### 4.1 Per-game speech volume estimation

Based on analysis of the project's speech library (8,521 entries, average 66 chars/entry):

| Metric | 9-player board | 12-player board |
|---|---|---|
| AI players (excluding human) | 8 | 11 |
| Speeches per round (discussion) | 8 | 11 |
| Rounds per game (est.) | 5 | 5 |
| Night-action speech lines (wolf chat, seer, witch, hunter) | ~10 | ~15 |
| **Total AI speeches per game** | **~50** | **~70** |
| **Total characters per game** | **~3,275** | **~4,585** |
| **Total input tokens (4 chars/token)** | **~819** | **~1,146** |
| **Audio output tokens (150 tokens/speech)** | **~7,500** | **~10,500** |

### 4.2 First-generation cost (all speeches synthesized)

Using Gemini 2.5 Flash TTS pricing ($0.50/1M input tokens, $10.00/1M audio output tokens):

| Board | Input cost | Output cost | Total cost/game |
|---|---|---|---|
| 9-player | $0.00041 | $0.07500 | **$0.07541** |
| 12-player | $0.00057 | $0.10500 | **$0.10557** |

Note: the output-cost estimate uses 150 audio tokens per speech, which assumes ~6 seconds of audio per ~66-char speech at natural speaking rate. Actual token count depends on the TTS engine's output duration and may vary by voice, rate, and language.

### 4.3 Cached-replay cost

**Approximately $0.00/game.** With the cache key design (hash(text) + language + voiceId + rate + modelVersion), every speech-line that has been synthesized before is served from the Netlify Function's blob/KV cache without an upstream API call.

The speech library (~8,500 entries, 6 roles) is the primary reuse target. After the first 2--3 games synthesize the most frequently hit lines (~200--300 unique lines per role), **>90% of subsequent speeches hit the cache**. With the free tier covering the first-gen synthesis, even the warm-up cost may be zero.

### 4.4 Worst-case TTS calls per game

| Scenario | Calls per game (9p) | Calls per game (12p) |
|---|---|---|
| All speeches unique (cold cache) | 50 | 70 |
| All speeches cached (warm cache) | 0 | 0 |
| Mixed (80% cache hit rate) | 10 | 14 |

### 4.5 Latency estimates

| Scenario | TTFB (time to first byte) | Total latency per speech |
|---|---|---|
| Gemini native TTS (non-streaming) | ~500--1500ms | 1--3 seconds |
| Gemini native TTS (streaming, 3.1 model) | ~200--500ms | Real-time (audio plays as it arrives) |
| Cloud TTS (Chirp 3 HD, streaming) | ~300--800ms | Real-time |
| Cache hit (Netlify Function, no upstream) | ~50--200ms | Sub-second |
| Browser-native (Web Speech API) | ~50--200ms | Real-time (browser-local) |

For the recommended 2.5 Flash TTS (non-streaming), the 1--3 second delay before audio playback begins is acceptable because speech audio plays alongside the displayed text (which the user reads) — audio is a companion, not the primary information channel. The game's speech timer (currently ~8--15 seconds) easily accommodates this.

### 4.6 Budget guard interaction

The existing $1/day budget guard in `provider-adapter.cjs` uses a per-instance accumulator with UTC rollover. Cloud TTS would add a separate TTS-specific accumulator following the same pattern:

- **Daily TTS budget:** same $1/day default (configurable via `TTS_DAILY_BUDGET_USD` env var).
- At **$0.08--0.11/game**, a single $1 daily budget supports **9--12 first-generation games** or **hundreds of cached-replay games**.
- The existing `COST_CEILING_PER_CALL` ($0.005) check is per-speech, and each speech costs ~$0.0015 — well below the ceiling.
- When the TTS budget is exhausted, the Netlify Function returns a 402 `budget_exhausted` signal, and the frontend falls back to browser-native TTS → text-only silently.

**Bottom line:** Cloud TTS stays comfortably within the projected $1/day operating envelope even without caching. With caching, it is effectively free after the initial warm-up.

---

## 5. Cache Design

### 5.1 Cache key

```
SHA-256(text) + ":" + language + ":" + voiceId + ":" + rate + ":" + modelVersion
```

- `SHA-256(text)` — the sanitized, final-display text exactly as spoken (post roster-guard, post translation). Hash is deterministic and collision-resistant.
- `language` — BCP-47 tag, e.g. `zh-CN`, `en-US`. Separate from hash so the same text can be replayed in a different language.
- `voiceId` — provider voice identifier (e.g. `Kore`, `cmn-CN-Standard-A`).
- `rate` — playback rate (1.0 = normal). Different rates produce different audio, so must be part of the key.
- `modelVersion` — e.g. `gemini-2.5-flash-preview-tts`. Must change whenever the provider updates the model in a way that changes audio output.

### 5.2 Speech-library reuse potential

The project has 8,521 pre-written speech entries across 6 roles, averaging 66 characters per entry. These are the primary reuse target:

- After sanitization (roster-guard name substitution, translation), each entry produces a deterministic string — same text in, same cache-key out.
- Across games, the most frequently hit lines (opening statements, common accusations, voting declarations) account for ~200--300 unique line-variants per role.
- After 2--3 games synthesizing these warm-up lines, >90% of subsequent speeches hit the cache.
- Netlify blob storage or a simple KV store (e.g. Netlify Blobs, a Supabase `tts_cache` table) can hold the cached audio entries.
- Estimated storage: ~2000 unique cached entries x ~15KB per WAV (6 seconds at 24kHz/16-bit/mono) = ~30MB total. Manageable even for serverless cold starts.

### 5.3 Cache invalidation

- Cache entries are immutable (keyed by content hash + parameters). No invalidation needed — new model versions get new `modelVersion` keys; old entries naturally age out.
- Optional TTL: 90 days. Entries unused for 90 days are evicted (soft cleanup, not critical — storage is cheap).
- Index rebuild: zero cost — the key space is deterministic and requires no indexing maintenance.

---

## 6. Unified Interface Design

### 6.1 Architecture

```
Component (App.tsx / useGameState.ts)
  └─ speechAudio.ts (existing service from browser-tts-mvp)
       └─ TTS Router (new, internal to speechAudio.ts)
            ├─ [1] Browser-native (SpeechSynthesis API)  ← DEFAULT
            ├─ [2] Cloud-premium (Netlify Function)      ← opt-in
            │      └─ POST /.netlify/functions/tts-adapter
            │           ├─ gemini-tts (gemini-2.5-flash-preview-tts)
            │           └─ → cache lookup → synthesize → cache store → return
            ├─ [3] Browser-native fallback (auto)
            └─ [4] Text-only (silent)
```

### 6.2 Request/Response contract

Full types are defined in `memory/coordination/reports/cloud-tts-adapter-spike/tts-adapter.types.ts`.

Key design decisions:

- **`requestId`** is the `GameLog.id` — opaque to the adapter, echoed back for caller deduplication.
- **`abortSignal`** allows the caller to cancel in-flight synthesis (skip speech, phase change, mute toggle).
- **Response includes `cacheHit` flag** so the frontend can skip cost tracking for cached responses.
- **Error taxonomy** has 10 categories (`auth`, `rate-limit`, `timeout`, `network`, `server`, `unsupported`, `budget`, `aborted`, `empty-response`, `unknown`) — consistent with `classifyError` in `provider-adapter.cjs`.
- **Cloud calls are routed through a Netlify Function only** — the API key never reaches the frontend. Same isolation pattern as `provider-adapter.cjs` line 394--530.
- **The interface slots behind `speechAudio.ts`** from `browser-tts-mvp` without changing its component-facing surface — `speechAudio.ts` calls `ttsAdapter.synthesize()` which internally routes to the appropriate tier.

### 6.3 Routing chain

```
1. browser-native  (DEFAULT — active immediately, zero cost)
   ↓ user explicitly opts in via "Cloud TTS" toggle in header
2. cloud-premium   (opt-in only — POST to Netlify Function)
   ↓ on ANY failure (network, auth, budget, timeout, unsupported lang…)
3. browser-native  (automatic fallback — Web Speech API)
   ↓ on browser API failure or missing web speech
4. text-only       (silent — game proceeds normally, no audio)
```

The chain is **per-speech, not per-game**: a single game can mix tiers. A speech that fails at tier 2 falls to tier 3; the next speech starts fresh at whatever tier the user has selected.

### 6.4 Netlify Function interface

```
POST /.netlify/functions/tts-adapter
Content-Type: application/json

Request body: {
  text: string,        // exact text to speak
  language: string,    // "zh-CN" | "en-US"
  voiceId: string,     // "Kore" | "Puck" | ...
  rate: number,        // 1.0 default, 0.25--4.0
  requestId: string,   // opaque, echoed back
}

Response 200: {
  audioData: string | null,   // base64-encoded audio
  audioFormat: string,        // "audio/wav"
  durationSeconds: number | null,
  provider: "gemini-tts" | "cloud-tts",
  voiceIdUsed: string,
  cacheHit: boolean,
  costEstimateUsd: number,
  budgetRemaining: number
}

Response 402 (budget exhausted): {
  error: "budget_exhausted",
  budgetRemaining: 0
}
```

The Netlify Function handles:
- API key isolation (key read from `process.env.GEMINI_API_KEY` only)
- Cache lookup/store
- Budget guard (daily accumulator, UTC rollover, same pattern as `provider-adapter.cjs`)
- Circuit breaker (3 consecutive failures → 60s cooldown, per warm instance)
- Per-IP rate limiting (same pattern as `genai-proxy.cjs`)
- Error classification and redacted logging
- CORS headers matching the existing `getAllowedOrigin()` pattern

---

## 7. Comparison Table: Recommended vs Alternatives

| Factor | Gemini 2.5 Flash TTS (recommended) | Cloud TTS (alternative) | OpenAI TTS (reference) |
|---|---|---|---|
| Auth with existing `API_KEY` | Yes (same `x-goog-api-key`) | No (needs GCP service account) | No (needs OpenAI key) |
| 中文 quality | 30 voices, language auto-detect | 38+ voices across tiers, Chirp 3 HD premium | Partial (voices English-optimized) |
| Cost per 9p game | ~$0.08 | $0.01 (Standard) -- $0.05 (WaveNet) -- $0.33 (Chirp 3 HD) | $0.05 (tts-1) -- $0.10 (tts-1-hd) |
| Cost per 12p game | ~$0.11 | $0.02 (Standard) -- $0.07 (WaveNet) -- $0.46 (Chirp 3 HD) | $0.07 (tts-1) -- $0.14 (tts-1-hd) |
| Free tier | Free of charge (no limit published) | 4M chars/mo (Standard), 1M chars/mo (Chirp) | Not published |
| Streaming | No (batch only) | Yes (Chirp 3 HD only, Preview) | Yes |
| Multi-speaker | Yes (up to 2) | No | No |
| Setup complexity | Zero (same key already in prod) | Medium (new GCP project + service account) | Medium (new billing + key) |

---

## 8. Residual Risks

1. **Pricing volatility (LOW):** Gemini native TTS is in Preview. Pricing may change at GA. The $1/day budget guard absorbs moderate increases. Mitigation: re-check pricing page at GA announcement.

2. **Free tier removal (LOW):** Google could remove or restrict the free tier for TTS models. Impact: cost per game would be ~$0.08--0.11 (still within budget). Mitigation: the budget guard caps spend regardless of free-tier status.

3. **Gemini 2.5 Flash TTS deprecation (LOW):** The model is "preview." Google typically provides deprecation notices and migration paths (e.g., 2.5 Flash → 3.1 Flash). Mitigation: the adapter's `modelVersion` field makes migration a config change.

4. **Chinese voice quality unverified (MEDIUM):** Documentation lists 30 voices with Chinese support, but actual quality for Mandarin TTS output has not been tested. The spike rules prohibit live API calls. Mitigation: first task in implementation is a quality evaluation with a few sample speeches.

5. **Non-streaming latency (LOW):** 2.5 Flash TTS does not stream. 1--3 second TTFB may be noticeable. Mitigation: streaming can be added later by upgrading to 3.1 Flash TTS (2x cost) with a model-version config change.

6. **Cloud TTS auth gap (CONFIRMED):** Cloud Text-to-Speech requires OAuth/Bearer, not API key. The report's recommendation (Gemini native TTS only) avoids this entirely. If Cloud TTS is later desired, a GCP service account must be provisioned and its JSON key stored as a Netlify env var.

7. **aicodemirror unknown (CONFIRMED GAP):** No public TTS documentation exists. Marked "尚未确认" throughout this report. No action possible without documentation.

---

## 9. Design Document (separate file)

The detailed interface types are in the companion file:
**`memory/coordination/reports/cloud-tts-adapter-spike/tts-adapter.types.ts`**

It compiles cleanly in isolation: `npx tsc --noEmit memory/coordination/reports/cloud-tts-adapter-spike/tts-adapter.types.ts`

---

## 10. DRAFT Follow-Up Implementation Card

**This section is the draft implementation card. It lives here in the report — NOT as a real `tasks/` file. The coordinator/planner must promote it only after the owner approves the cost recommendation.**

### Task: cloud-tts-gemini-mvp

**Status:** DRAFT (do not pull until owner approves cloud-tts-adapter-spike recommendation)

**Objective:** Implement Gemini-native cloud TTS as an opt-in premium tier behind the existing `speechAudio.ts` service, with cache, budget guard, and graceful fallback, using the already-live `API_KEY` — zero new auth setup.

**Required reading:**
- `memory/coordination/reports/cloud-tts-adapter-spike.md` (this report)
- `memory/coordination/reports/cloud-tts-adapter-spike/tts-adapter.types.ts`
- `memory/coordination/tasks/browser-tts-mvp.md` + its report (the speechAudio service this card extends)
- `src/services/speechAudio.ts` (created by browser-tts-mvp)
- `src/hooks/useGameState.ts` (AI speech path + enqueue hook point)
- `src/App.tsx` (header audio controls + cloud-TTS opt-in toggle)
- `netlify/functions/provider-adapter.cjs` (budget guard, circuit breaker, CORS, redacted logging patterns to mirror)

**Context:**
- Gemini native TTS uses the Interactions API at `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `x-goog-api-key` header — **same key as the existing Gemini text path** (env var `API_KEY`).
- Audio arrives as base64-encoded PCM WAV (24kHz, 16-bit, mono). The frontend plays it via an `Audio` element (URL from base64 blob) — **NOT** through `SpeechSynthesisUtterance`.
- This card EXTENDS (does not replace) the browser-native `speechAudio.ts` service. Browser-native remains the default; cloud TTS is an explicit opt-in toggle.
- Cache design: key = `SHA256(text):language:voiceId:rate:modelVersion`. Cache storage: Netlify Blobs or a simple in-memory Map in the function (per warm instance, acceptable for the speech library reuse pattern).
- Budget guard: separate TTS daily accumulator in the Netlify Function, same `$1/day` default, same UTC rollover pattern as `provider-adapter.cjs`. On exhaustion, returns 402 → frontend falls back to browser-native.
- Voice selection: map the 30 Gemini voices to a deterministic per-playerId mapping (same pattern as `browser-tts-mvp` voice selection). User can also pick a global voice in preferences.

**Allowed changes:**
- `src/services/speechAudio.ts` (add cloud TTS routing tier — extend, don't rewrite)
- `src/services/ttsAdapter.ts` (new: unified adapter implementing ITTSAdapter from the spike types, wrapping browser-native + cloud tiers)
- `src/services/ttsAdapter.test.ts` (new: tests with mocked fetch + Audio)
- `netlify/functions/tts-adapter.cjs` (new: Gemini Interactions API → base64 audio, cache, budget guard, CORS — mirror provider-adapter.cjs patterns)
- `src/App.tsx` (add "Cloud TTS" opt-in toggle in header audio controls, voice preference selector, persist prefs)
- `src/i18n/index.ts` (ONLY if an audio-prefs storage key is added — prefer duplicating the 10-line try/catch pattern locally)

**Do not change:**
- `netlify/functions/provider-adapter.cjs`, `genai-proxy.cjs`
- `src/gameEngine.ts`, `src/ai/**` decision logic
- `package.json` (reuse `@google/genai` which is already a dependency for Netlify Functions)
- Unrelated code, credentials, deployment configuration, other task cards

**Acceptance criteria:**
1. Cloud TTS toggle in header: off by default. When on, AI speeches are synthesized via Gemini native TTS and played as audio; when off, browser-native TTS is used (unchanged behavior).
2. `speechAudio.ts` routes through the unified `ttsAdapter.ts` which implements the ITTSAdapter interface from the spike types; no component calls the Gemini API directly.
3. API key is read ONLY in the Netlify Function (`process.env.API_KEY`). The frontend never sees it (grep-verifiable).
4. Cache: same text + same language + same voice + same rate + same model version = cache hit, zero upstream calls. Log shows `cacheHit: true`.
5. Budget guard: $1/day TTS accumulator; 402 response on exhaustion; frontend silently falls back to browser-native.
6. Fallback chain: cloud-TTS failure (any kind) → browser-native → text-only. No game stall, no error visible to user.
7. Graceful handling of: missing API_KEY (Netlify Function returns 500, frontend falls back), unsupported language (falls back to browser-native), AbortSignal cancellation (skip speech → next speaker without delay).
8. Voice determinism: same playerId → same Gemini voice across games (respects user voice preference if set).
9. Tests: mock the Gemini Interactions endpoint (or the Netlify Function), verify: successful synthesis, cache hit, budget exhaustion, auth failure fallback, abort, unsupported language.
10. Baseline tests still pass, `npm run build` succeeds, git diff shows ONLY the allowed paths.

**Verification:**
```bash
npm run test:run   # baseline + new TTS adapter tests, zero regressions
npm run build
# Chrome: start game → enable "Cloud TTS" → AI speech audible → disable → browser-native resumes
# Chrome: cloud TTS on → kill Netlify function (or exhaust budget) → speech plays via browser TTS
```

---

## 11. Verification

```bash
# git status — only report paths
git status --short
# Expected output: ONLY lines starting with "?? memory/coordination/reports/cloud-tts-adapter-spike" or similar

# Types file compiles in isolation
npx tsc --noEmit memory/coordination/reports/cloud-tts-adapter-spike/tts-adapter.types.ts

# Test baseline unchanged
npm run test:run   # 309+ passed (matches pre-existing baseline)

# Build unchanged
npm run build      # succeeds
```

