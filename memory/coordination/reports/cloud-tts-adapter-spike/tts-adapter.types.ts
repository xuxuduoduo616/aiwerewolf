/**
 * cloud-tts-adapter-spike — Types-only mock interface file
 *
 * This file defines the unified cloud-TTS adapter interface contract.
 * It contains NO network code, NO runtime logic, NO imports from src/,
 * and is NOT imported by the application. It is a design artifact kept
 * alongside the spike report for the owner to review before implementation.
 *
 * Once the Cloud TTS feature is approved, these types should be promoted
 * into src/services/ and a Netlify Function adapter that imports them.
 */

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** A single TTS synthesis request. */
export interface TTSRequest {
  /** The text to be spoken (final displayed text, post translation + roster guard). */
  text: string;
  /** BCP-47 language tag, e.g. "zh-CN", "en-US". Determines voice selection. */
  language: string;
  /**
   * Provider-specific voice ID.
   *
   * Gemini native TTS: one of the 30 prebuilt voice names
   *   ("Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Leda", "Enceladus",
   *    "Sulafat", "Achernar", ...).
   * Cloud TTS Standard/WaveNet: "cmn-CN-Standard-A" etc.
   * Cloud TTS Chirp 3 HD: "cmn-CN-Chirp3-HD-Kore" etc.
   * Browser-native: a SpeechSynthesisVoice voiceURI.
   */
  voiceId: string;
  /** Playback rate. 1.0 = normal speed. Range 0.25–4.0 (Web Speech API cap). */
  rate: number;
  /**
   * Opaque request ID used by the caller for deduplication (GameLog.id).
   * The adapter MUST NOT generate or interpret this value — it is echoed
   * back in the response for the caller's bookkeeping.
   */
  requestId: string;
  /**
   * AbortSignal that the caller can use to cancel an in-flight synthesis.
   * When the signal fires, the adapter MUST cancel the upstream request
   * (if possible) and resolve/reject quickly so the game is not blocked.
   */
  abortSignal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Provider identifiers
// ---------------------------------------------------------------------------

export type TTSProviderId =
  | "browser-native"   // Web Speech API (default, always available)
  | "gemini-tts"       // Gemini native TTS via Interactions API (same API_KEY as genai-proxy)
  | "cloud-tts"        // Google Cloud Text-to-Speech (separate auth: service-account Bearer)
  | "text-only";       // Silent fallback (no audio, game proceeds normally)

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * The unified response contract every TTS provider adapter must satisfy.
 *
 * The frontend speechAudio service consumes this shape regardless of which
 * provider produced it. All providers (including browser-native) are wrapped
 * to conform to this contract so the routing layer is uniform.
 */
export interface TTSResponse {
  /** The requestId echoed back from the request. */
  requestId: string;

  /**
   * The audio payload.
   *
   * - cloud providers: base64-encoded audio data (PCM WAV for Gemini TTS;
   *   configurable encoding for Cloud TTS — LINEAR16, MP3, OGG_OPUS).
   * - browser-native: the resulting SpeechSynthesisUtterance blob URI after
   *   conversion, or null if the browser produced audio directly.
   * - text-only fallback: always null.
   */
  audioData: string | null;

  /**
   * MIME type of audioData, e.g. "audio/wav", "audio/mpeg", "audio/ogg;codecs=opus".
   */
  audioFormat: string;

  /** Duration of the audio in seconds, if the provider reports it. */
  durationSeconds: number | null;

  /** Which provider actually fulfilled the request. */
  provider: TTSProviderId;

  /** The voice ID that was selected (may differ from request if the requested voice was unavailable). */
  voiceIdUsed: string;

  /**
   * True when the audio was served from a local or server-side cache rather
   * than synthesized fresh. Lets the caller skip cost tracking.
   */
  cacheHit: boolean;

  /**
   * Estimated cost in USD for this synthesis call.
   * 0 for browser-native and text-only providers.
   */
  costEstimateUsd: number;
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

/** All TTS failures are classified into this taxonomy. */
export type TTSErrorKind =
  | "auth"           // Missing/expired/invalid API key or token
  | "rate-limit"     // 429 / quota exceeded
  | "timeout"        // Upstream did not respond within the configured timeout
  | "network"        // Connection refused, DNS failure, TLS error
  | "server"         // 5xx from the provider
  | "unsupported"    // Language or voice not supported by the provider
  | "budget"         // Daily budget exhausted (local guard, before network)
  | "aborted"        // The caller cancelled via AbortSignal
  | "empty-response" // Provider returned 200 but no audio payload
  | "unknown";       // Catch-all for unclassified errors

export interface TTSError {
  kind: TTSErrorKind;
  message: string;
  provider: TTSProviderId;
  /** HTTP status code if available, otherwise null. */
  httpStatus: number | null;
  /** The requestId from the original TTSRequest, for caller correlation. */
  requestId: string;
}

// ---------------------------------------------------------------------------
// Unified adapter interface
// ---------------------------------------------------------------------------

/**
 * The single adapter interface every TTS provider must implement.
 *
 * Cloud calls are routed through a Netlify Function (the API key never
 * reaches the frontend — same isolation pattern as provider-adapter.cjs).
 * The frontend only knows about `TTSRequest` and `TTSResponse`; it never
 * constructs provider-specific HTTP requests.
 */
export interface ITTSAdapter {
  /** Human-readable provider name for logging / debug UI. */
  readonly providerId: TTSProviderId;

  /**
   * Synthesize speech from text.
   *
   * @returns TTSResponse on success.
   * @throws TTSError on any failure (the routing layer catches and falls back).
   */
  synthesize(request: TTSRequest): Promise<TTSResponse>;

  /**
   * Check whether this provider is currently healthy (not in circuit-breaker
   * open state, not rate-limited, key is configured, etc.).
   *
   * The routing layer calls this before attempting synthesis to decide
   * whether to skip to the next fallback tier.
   */
  isAvailable(): Promise<boolean> | boolean;
}

// ---------------------------------------------------------------------------
// Cache design contract
// ---------------------------------------------------------------------------

/**
 * Cache key for deterministic TTS caching.
 *
 * Two requests with identical cache keys produce byte-identical audio.
 * The Netlify Function stores cache entries keyed by this fingerprint.
 *
 * The hash covers the sanitized text exactly as spoken; language, voice,
 * rate, and model version are included as separate fields rather than being
 * folded into the hash so that the same text can be replayed in a different
 * language or voice without cache invalidation.
 */
export interface TTSCacheKey {
  /** SHA-256 hex digest of `text` (the exact string sent to the TTS engine). */
  textHash: string;
  /** BCP-47 language tag. */
  language: string;
  /** Provider voice ID. */
  voiceId: string;
  /** Playback rate. */
  rate: number;
  /**
   * Provider + model version identifier, e.g. "gemini-2.5-flash-preview-tts".
   * Must change whenever the provider's audio generation changes in a way
   * that would produce different audio for the same input.
   */
  modelVersion: string;
}

/**
 * Cache entry stored in Netlify blob storage (or a KV store).
 *
 * The speech library (~8,500 entries) is the primary reuse target:
 * identical library lines across games replay from cache at zero TTS cost.
 */
export interface TTSCacheEntry {
  key: TTSCacheKey;
  /** Base64-encoded audio data. */
  audioData: string;
  /** Audio MIME type. */
  audioFormat: string;
  /** Duration in seconds. */
  durationSeconds: number;
  /** UNIX timestamp in milliseconds when the entry was created. */
  createdAt: number;
  /** Number of times this entry has been served from cache. */
  hitCount: number;
}

// ---------------------------------------------------------------------------
// Routing chain design (documented, not implemented)
// ---------------------------------------------------------------------------

/**
 * Route priority (documentation-only — the actual routing is implemented in
 * the Netlify Function and the frontend's speechAudio service):
 *
 *   1. browser-native  (DEFAULT — active immediately, zero cost)
 *     ↓ user explicitly opts in via "Cloud TTS" toggle
 *   2. cloud-premium   (opt-in only — gemini-tts or cloud-tts, via Netlify Function)
 *     ↓ on ANY failure (network, auth, budget, timeout…)
 *   3. browser-native  (automatic fallback — Web Speech API)
 *     ↓ on browser API failure / unsupported language
 *   4. text-only       (silent — game proceeds normally, no audio)
 *
 * The chain is per-speech, not per-game: a single game can mix tiers.
 * A speech that fails at tier 2 falls to tier 3; the next speech starts
 * fresh at whatever tier the user has selected.
 */

// ---------------------------------------------------------------------------
// Budget guard contract
// ---------------------------------------------------------------------------

/**
 * Budget state returned by the Netlify Function alongside the audio payload.
 * Follows the same pattern as provider-adapter.cjs (per-instance daily
 * accumulator, UTC rollover, $1/day default).
 */
export interface TTSBudgetState {
  /** USD remaining in the daily budget for this instance. */
  remainingUsd: number;
  /** Total USD spent this UTC day (including the current call). */
  spentUsd: number;
  /** Whether the budget has been exhausted (future calls will get 402). */
  exhausted: boolean;
}
