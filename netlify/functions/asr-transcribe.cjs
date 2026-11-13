// Same-origin speech-to-text proxy for the optional click-to-record microphone.
// The Qwen API key stays server-side; the recording is forwarded in memory and
// dropped with the response. Audio, transcript and user identity are never
// stored or logged. Only the validated `{ audio, lang, durationMs }` contract
// is accepted, and the endpoint is deliberately single-shot (one request per recording).
//
// Text is never sent to the LLM or TTS functions: this proxy only talks to the
// Qwen ASR model and returns `{ text }` to the browser. The API key is read
// from `process.env.QWEN_API_KEY` and is never echoed back.

// The `qwen-audio-3.1-asr-flash-message` / `-streaming` models are WebSocket
// real-time models. This function is a single-shot HTTP proxy, so it uses the
// non-realtime Qwen3-ASR-Flash sibling with the same `input_audio` contract.
const MODEL = 'qwen3-asr-flash';
// OpenAI-compatible Qwen ASR endpoint (single-shot request, `messages` input).
const ASR_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const ASR_TIMEOUT_MS = 12_000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_DURATION_MS = 60_000;
const LANGUAGES = ['en-US', 'zh-CN'];
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: { ...HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const errorResponse = (statusCode, code) => jsonResponse(statusCode, { code });

const header = (event, name) =>
  Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || '';

// Only the site's own pages may call this function (same-origin browser POST).
function isSameOrigin(event) {
  const origin = header(event, 'origin');
  if (!origin) return false;
  try {
    const target = new URL(event.rawUrl);
    if (!['http:', 'https:'].includes(target.protocol)) return false;
    return target.origin === origin;
  } catch {
    return false;
  }
}

function readAudio(value) {
  if (typeof value !== 'string' || !value) return null;
  const dataUrlMatch = /^data:audio\/[^,]+;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  const base64 = dataUrlMatch ? dataUrlMatch[1] : value;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  const audio = Buffer.from(base64, 'base64');
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) return null;
  return {
    bytes: audio.length,
    dataUrl: dataUrlMatch ? value : `data:audio/wav;base64,${base64}`,
  };
}

function parseRequest(event) {
  const contentType = header(event, 'content-type').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { statusCode: 415, code: 'UNSUPPORTED_MEDIA_TYPE' };
  }
  if (event.isBase64Encoded || typeof event.body !== 'string' || !event.body) {
    return { statusCode: 400, code: 'INVALID_REQUEST' };
  }
  if (Buffer.byteLength(event.body) > MAX_BODY_BYTES) {
    return { statusCode: 400, code: 'INVALID_AUDIO' };
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, code: 'INVALID_REQUEST' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { statusCode: 400, code: 'INVALID_REQUEST' };
  }

  // Exactly three fields: no seat, identity, game content or extra payload.
  const fields = Object.keys(parsed);
  if (fields.length !== 3 || !fields.every(field => ['audio', 'lang', 'durationMs'].includes(field))) {
    return { statusCode: 400, code: 'INVALID_REQUEST' };
  }

  const { audio, lang, durationMs } = parsed;
  if (!LANGUAGES.includes(lang)) return { statusCode: 400, code: 'INVALID_REQUEST' };
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    return { statusCode: 400, code: 'INVALID_REQUEST' };
  }

  const decoded = readAudio(audio);
  if (!decoded) return { statusCode: 400, code: 'INVALID_AUDIO' };
  return {
    lang,
    durationMs: Math.round(durationMs),
    dataUrl: decoded.dataUrl,
  };
}

function readTranscript(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return null;
}

// Enum-only log line: language, duration, outcome and status code. Never the
// audio bytes, the transcript or any identity.
const logAsrEvent = (event, request, statusCode) => {
  if (typeof console === 'undefined') return;
  const entry = { event, lang: request.lang, durationMs: request.durationMs };
  if (Number.isInteger(statusCode)) entry.status = statusCode;
  console.warn(JSON.stringify(entry));
};

const isTimeout = (error) => {
  const name = String(error?.name || '');
  const message = String(error?.message || '').toLowerCase();
  return name === 'TimeoutError' || name === 'AbortError'
    || message.includes('timeout') || message.includes('aborted');
};

async function transcribe(request, key) {
  const signal = AbortSignal.timeout(ASR_TIMEOUT_MS);
  const response = await fetch(ASR_ENDPOINT, {
    method: 'POST',
    signal,
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: request.dataUrl } }],
        },
      ],
      stream: false,
      asr_options: {
        language: request.lang === 'zh-CN' ? 'zh' : 'en',
        enable_itn: true,
      },
    }),
  });

  if (!response.ok) {
    logAsrEvent(response.status === 429 ? 'asr_rate_limited' : 'asr_unavailable', request, response.status);
    return errorResponse(502, 'ASR_UNAVAILABLE');
  }

  const payload = await response.json();
  const text = readTranscript(payload);
  if (typeof text !== 'string') {
    logAsrEvent('asr_unavailable', request, response.status);
    return errorResponse(502, 'ASR_UNAVAILABLE');
  }
  return jsonResponse(200, { text: text.trim(), model: MODEL, durationMs: request.durationMs });
}

exports.handler = async (event = {}) => {
  if (event.httpMethod !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED');
  if (!isSameOrigin(event)) return errorResponse(403, 'FORBIDDEN_ORIGIN');

  const key = process.env.QWEN_API_KEY;
  if (!key) return errorResponse(503, 'ASR_NOT_CONFIGURED');

  const request = parseRequest(event);
  if (!request || Number.isInteger(request.statusCode)) {
    return errorResponse(request.statusCode, request.code);
  }

  try {
    return await transcribe(request, key);
  } catch (error) {
    logAsrEvent(isTimeout(error) ? 'asr_timeout' : 'asr_unavailable', request, null);
    return errorResponse(502, 'ASR_UNAVAILABLE');
  }
};

exports.MODEL = MODEL;
exports.ASR_ENDPOINT = ASR_ENDPOINT;
exports.ASR_TIMEOUT_MS = ASR_TIMEOUT_MS;
exports.MAX_AUDIO_BYTES = MAX_AUDIO_BYTES;
exports.parseRequest = parseRequest;
