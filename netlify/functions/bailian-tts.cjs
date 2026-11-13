// Private voice pilot. The paid endpoint is available only to one verified tester.
const { createClient } = require('@supabase/supabase-js');

const MODEL_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
const AUDIO_HOST = 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com';
const CHINESE_VOICES = ['longanhuan_v3.1', 'longze_v3.1', 'longyan_v3.1'];
// Premium English narrators, ordered so adjacent seats alternate gender and
// accent. Seats 2-9 (9-player) and 2-12 (12-player) therefore never share a
// voice. All IDs are native English voices; none are novelty/effect voices.
const ENGLISH_VOICES = [
  'Andy_v3.1', 'Ava_v3.1', 'Brian_v3.1', 'Emily_v3.1', 'David_v3.1',
  'Annie_v3.1', 'Eric_v3.1', 'Beth_v3.1', 'Luca_v3.1', 'Luna_v3.1', 'Donna_v3.1',
];
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
// Bailian's streamed WAV uses these lengths before the final PCM size is known.
const STREAMED_RIFF_SIZE = 0x7fffffbf;
const STREAMED_DATA_SIZE = 0x7fffff9b;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

const errorResponse = (statusCode, code) => ({
  statusCode,
  headers: { ...HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});

// H1-D observability: one enum-only JSON line per failed synthesis attempt.
// `lang` and `seat` are the validated request enums; no speech text, token or
// origin is logged, and the HTTP response contract stays `502 TTS_UNAVAILABLE`.
const ttsEventForError = (error) => {
  const name = String(error?.name || '');
  const message = String(error?.message || '').toLowerCase();
  return name === 'TimeoutError' || name === 'AbortError'
    || message.includes('timeout') || message.includes('aborted')
    ? 'tts_timeout' : 'tts_unavailable';
};
const logTtsEvent = (event, speech) => {
  if (typeof console === 'undefined') return;
  console.warn(JSON.stringify({ event, lang: speech.lang, seat: speech.seat }));
};

const header = (event, name) =>
  Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || '';

function isPilotRequest(event) {
  const expected = process.env.BAILIAN_TTS_PREVIEW_ORIGIN;
  if (!expected || header(event, 'origin') !== expected) return false;
  try {
    const target = new URL(event.rawUrl);
    if (target.origin !== expected) return false;
    if (target.origin === 'https://ai-werewolf.net') {
      return process.env.BAILIAN_TTS_PRODUCTION_PILOT === 'true';
    }
    if (['localhost', '127.0.0.1'].includes(target.hostname)) {
      return target.protocol === 'http:';
    }
    const siteName = process.env.SITE_NAME;
    if (!siteName || target.protocol !== 'https:' || target.port) return false;
    const suffix = `--${siteName}.netlify.app`;
    return target.hostname.endsWith(suffix)
      && /^deploy-preview-[1-9][0-9]*$/.test(target.hostname.slice(0, -suffix.length));
  } catch {
    return false;
  }
}

function parseSpeech(event) {
  if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 8192) return null;
  try {
    const { text, lang, seat } = JSON.parse(event.body);
    if (typeof text !== 'string' || !text.trim() || [...text].length > 600) return null;
    if (!['zh-CN', 'en-US'].includes(lang) || !Number.isInteger(seat) || seat < 2 || seat > 12) return null;
    return { text, lang, seat };
  } catch {
    return null;
  }
}

function selectVoice(lang, seat) {
  const voices = lang === 'en-US' ? ENGLISH_VOICES : CHINESE_VOICES;
  return voices[(seat - 2) % voices.length];
}

function trustedAudioUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== AUDIO_HOST
      || url.port || url.username || url.password || !url.pathname.endsWith('.wav')) {
    throw new Error('Invalid audio URL');
  }
  // The official response example uses HTTP. Fetch the same object over TLS.
  url.protocol = 'https:';
  return url;
}

function isPcmWave(audio) {
  if (audio.length < 44 || audio.toString('latin1', 0, 4) !== 'RIFF'
      || audio.toString('latin1', 8, 12) !== 'WAVE') return false;
  const riffSize = audio.readUInt32LE(4);
  const streamed = riffSize === STREAMED_RIFF_SIZE;
  if (!streamed && riffSize !== audio.length - 8) return false;

  let blockAlign = 0;
  let hasData = false;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const tag = audio.toString('latin1', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (streamed && tag === 'data' && size === STREAMED_DATA_SIZE) {
      const bytes = audio.length - start;
      return !hasData && blockAlign > 0 && bytes > 0 && bytes % blockAlign === 0;
    }

    // RIFF pads odd-sized chunks to a two-byte boundary.
    const next = start + size + (size % 2);
    if (next > audio.length) return false;
    if (tag === 'fmt ') {
      if (blockAlign || size < 16 || audio.readUInt16LE(start) !== 1) return false;
      const channels = audio.readUInt16LE(start + 2);
      const sampleRate = audio.readUInt32LE(start + 4);
      const byteRate = audio.readUInt32LE(start + 8);
      const align = audio.readUInt16LE(start + 12);
      const bits = audio.readUInt16LE(start + 14);
      if (!channels || !sampleRate || ![8, 16, 24, 32].includes(bits)
          || align !== channels * bits / 8 || byteRate !== sampleRate * align) return false;
      blockAlign = align;
    } else if (tag === 'data') {
      if (hasData || !blockAlign || !size || size % blockAlign !== 0) return false;
      hasData = true;
    }
    offset = next;
  }
  return !streamed && hasData && offset === audio.length;
}

async function readWave(response) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_AUDIO_BYTES) {
    throw new Error('Invalid audio response');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_AUDIO_BYTES) throw new Error('Audio too large');
    chunks.push(Buffer.from(chunk));
  }
  const audio = Buffer.concat(chunks);
  if (!isPcmWave(audio)) throw new Error('Invalid WAV');
  return audio;
}

exports.handler = async (event = {}) => {
  const key = process.env.DASHSCOPE_API_KEY;
  const host = process.env.BAILIAN_TTS_API_HOST || '';
  const tester = process.env.BAILIAN_TTS_TESTER_ID;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (process.env.BAILIAN_TTS_ENABLED !== 'true' || !isPilotRequest(event)
      || !/^(?:ws|llm)-[a-z0-9-]{1,59}\.cn-beijing\.maas\.aliyuncs\.com$/.test(host)
      || !key || !tester || !supabaseUrl || !anonKey) {
    return errorResponse(503, 'TTS_DISABLED');
  }
  if (event.httpMethod !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED');

  const token = /^Bearer ([^\s]{16,4096})$/.exec(header(event, 'authorization'))?.[1];
  if (!token) return errorResponse(401, 'UNAUTHORIZED');
  const speech = parseSpeech(event);
  if (!speech) return errorResponse(400, 'INVALID_SPEECH');

  // English sentences are longer and need a wider synthesis budget; the
  // previous 5.5s cutoff produced 502s that fell back to browser voices.
  const signal = AbortSignal.timeout(speech.lang === 'en-US' ? 20000 : 5500);
  try {
    const auth = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal }) },
    });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user || data.user.is_anonymous || data.user.id !== tester) {
      return errorResponse(403, 'TESTER_REQUIRED');
    }
    return await synthesize(speech, host, key, signal);
  } catch (error) {
    logTtsEvent(ttsEventForError(error), speech);
    return errorResponse(502, 'TTS_UNAVAILABLE');
  }
};

async function synthesize(speech, host, key, signal) {
  const language = speech.lang === 'zh-CN' ? 'Chinese' : 'English';
  const response = await fetch(`https://${host}${MODEL_PATH}`, {
    method: 'POST',
    signal,
    redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen-audio-3.1-tts-flash',
      input: {
        text: speech.text,
        format: 'wav',
        sample_rate: 24000,
        voice: selectVoice(speech.lang, speech.seat),
        instruction: `Speak in ${language}. Read the text verbatim in a plain, everyday speaking voice at a normal pace. Use natural sentence intonation and a dry voice without singing, vocal effects, or exaggerated character acting.`,
      },
    }),
  });
  if (!response.ok) {
    logTtsEvent(response.status === 429 ? 'tts_rate_limited' : 'tts_unavailable', speech);
    return errorResponse(502, 'TTS_UNAVAILABLE');
  }
  const dataFromModel = await response.json();
  const audioUrl = trustedAudioUrl(dataFromModel.output?.audio?.url);
  const audio = await readWave(await fetch(audioUrl, { signal, redirect: 'error' }));
  return {
    statusCode: 200,
    headers: { ...HEADERS, 'Content-Type': 'audio/wav' },
    isBase64Encoded: true,
    body: audio.toString('base64'),
  };
}

exports.synthesize = synthesize;
exports.parseSpeech = parseSpeech;
exports.selectVoice = selectVoice;
exports.ENGLISH_VOICES = ENGLISH_VOICES;
