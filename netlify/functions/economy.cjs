/**
 * Authenticated economy boundary.
 *
 * The bearer token is verified before a request-scoped Supabase client invokes
 * an allow-listed RPC.  User identity, time, catalog, prices, rewards and
 * balances are never accepted from the browser.
 */

const MAX_BODY_BYTES = 8 * 1024;
const MAX_LEDGER_LIMIT = 100;
const DEFAULT_LEDGER_LIMIT = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const SKIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const ACTIONS = Object.freeze({
  claim_check_in: {
    rpc: 'economy_claim_check_in',
    fields: ['action', 'idempotencyKey'],
    params: (body) => ({ p_idempotency_key: body.idempotencyKey }),
  },
  finish_onboarding: {
    rpc: 'economy_finish_onboarding',
    fields: ['action', 'idempotencyKey'],
    params: (body) => ({ p_idempotency_key: body.idempotencyKey }),
  },
  claim_gameplay_reward: {
    rpc: 'economy_claim_gameplay_reward',
    fields: ['action', 'gameRecordId', 'idempotencyKey'],
    params: (body) => ({
      p_idempotency_key: body.idempotencyKey,
      p_game_record_id: body.gameRecordId,
    }),
  },
  unlock_skin: {
    rpc: 'economy_unlock_skin',
    fields: ['action', 'idempotencyKey', 'skinId'],
    params: (body) => ({
      p_idempotency_key: body.idempotencyKey,
      p_skin_id: body.skinId,
    }),
  },
  equip_skin: {
    rpc: 'economy_equip_skin',
    fields: ['action', 'idempotencyKey', 'skinId'],
    params: (body) => ({
      p_idempotency_key: body.idempotencyKey,
      p_skin_id: body.skinId,
    }),
  },
});

const getHeader = (headers, name) => {
  if (!headers || typeof headers !== 'object') return '';
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry && typeof entry[1] === 'string' ? entry[1].trim() : '';
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const response = (statusCode, code, origin, extraHeaders = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    ...extraHeaders,
  },
  body: JSON.stringify({ code }),
});

const success = (data, origin) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  },
  body: JSON.stringify({ data }),
});

const readConfig = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const rawOrigins = process.env.ALLOWED_ORIGIN || '';
  const allowedOrigins = rawOrigins.split(',').map((value) => value.trim()).filter(Boolean);

  if (anonKey.length < 16 || allowedOrigins.length === 0) {
    return null;
  }

  try {
    const parsedSupabaseUrl = new URL(supabaseUrl);
    const localSupabase = ['localhost', '127.0.0.1', '[::1]'].includes(parsedSupabaseUrl.hostname);
    if (parsedSupabaseUrl.origin !== supabaseUrl
      || (parsedSupabaseUrl.protocol !== 'https:' && !localSupabase)) {
      throw new Error('invalid Supabase URL');
    }
    const normalizedOrigins = allowedOrigins.map((value) => {
      const parsed = new URL(value);
      const localOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (parsed.origin !== value || (parsed.protocol !== 'https:' && !localOrigin)) {
        throw new Error('invalid origin');
      }
      return parsed.origin;
    });
    return { supabaseUrl: parsedSupabaseUrl.origin, anonKey, allowedOrigins: normalizedOrigins };
  } catch {
    return null;
  }
};

const parseBearer = (headers) => {
  const authorization = getHeader(headers, 'authorization');
  const match = /^Bearer ([^\s]{16,4096})$/.exec(authorization);
  return match ? match[1] : null;
};

const parseLedgerQuery = (event) => {
  const query = event.queryStringParameters == null ? {} : event.queryStringParameters;
  if (!isRecord(query)) return null;
  const allowed = new Set(['ledgerLimit', 'ledgerCursor']);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;

  const rawLimit = query.ledgerLimit;
  const ledgerLimit = rawLimit == null || rawLimit === ''
    ? DEFAULT_LEDGER_LIMIT
    : (/^[1-9][0-9]{0,2}$/.test(String(rawLimit)) ? Number(rawLimit) : NaN);
  if (!Number.isSafeInteger(ledgerLimit) || ledgerLimit < 1 || ledgerLimit > MAX_LEDGER_LIMIT) {
    return null;
  }

  const ledgerCursor = query.ledgerCursor == null || query.ledgerCursor === ''
    ? null
    : String(query.ledgerCursor);
  if (ledgerCursor !== null && !UUID_PATTERN.test(ledgerCursor)) return null;
  return { p_ledger_limit: ledgerLimit, p_ledger_cursor: ledgerCursor };
};

const parsePostBody = (event) => {
  if (event.isBase64Encoded === true || typeof event.body !== 'string') {
    return { error: 'INVALID_REQUEST' };
  }

  const contentLength = getHeader(event.headers, 'content-length');
  if (contentLength && (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return { error: 'BODY_TOO_LARGE' };
  }
  if (Buffer.byteLength(event.body, 'utf8') > MAX_BODY_BYTES) {
    return { error: 'BODY_TOO_LARGE' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { error: 'INVALID_JSON' };
  }
  if (!isRecord(body)) return { error: 'INVALID_REQUEST' };

  const action = typeof body.action === 'string' ? body.action : '';
  const contract = ACTIONS[action];
  if (!contract) return { error: 'UNKNOWN_ACTION' };
  const actualFields = Object.keys(body).sort();
  const expectedFields = [...contract.fields].sort();
  if (actualFields.length !== expectedFields.length
    || actualFields.some((field, index) => field !== expectedFields[index])) {
    return { error: 'INVALID_REQUEST' };
  }
  if (typeof body.idempotencyKey !== 'string'
    || !IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey)) {
    return { error: 'INVALID_IDEMPOTENCY_KEY' };
  }
  if (action === 'claim_gameplay_reward'
    && (typeof body.gameRecordId !== 'string' || !UUID_PATTERN.test(body.gameRecordId))) {
    return { error: 'INVALID_GAME_RECORD_ID' };
  }
  if ((action === 'unlock_skin' || action === 'equip_skin')
    && (typeof body.skinId !== 'string' || !SKIN_ID_PATTERN.test(body.skinId))) {
    return { error: 'INVALID_SKIN_ID' };
  }

  return { body, contract };
};

const mapRpcError = (error, origin) => {
  const safeMessage = error && typeof error.message === 'string' ? error.message : '';
  const known = [
    ['ECONOMY_UNAUTHORIZED', 401, 'UNAUTHORIZED'],
    ['ECONOMY_IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'],
    ['ECONOMY_REWARD_UNAVAILABLE', 409, 'GAMEPLAY_REWARD_UNAVAILABLE'],
    ['ECONOMY_ALREADY_CLAIMED', 409, 'ALREADY_CLAIMED'],
    ['ECONOMY_DAILY_LIMIT', 409, 'DAILY_LIMIT_REACHED'],
    ['ECONOMY_INSUFFICIENT_BALANCE', 409, 'INSUFFICIENT_BALANCE'],
    ['ECONOMY_ALREADY_OWNED', 409, 'ALREADY_OWNED'],
    ['ECONOMY_NOT_OWNED', 409, 'NOT_OWNED'],
    ['ECONOMY_NOT_FOUND', 404, 'NOT_FOUND'],
    ['ECONOMY_INVALID_STATE', 409, 'INVALID_STATE'],
  ];
  const matched = known.find(([prefix]) => safeMessage.startsWith(prefix));
  return matched
    ? response(matched[1], matched[2], origin)
    : response(502, 'ECONOMY_UPSTREAM_ERROR', origin);
};

const createUserClient = (config, token) => {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
};

exports.handler = async function handler(event = {}) {
  // Configuration is the first gate and is evaluated before auth or request data.
  const config = readConfig();
  if (!config) return response(503, 'ECONOMY_NOT_CONFIGURED', '');

  const method = String(event.httpMethod || '').toUpperCase();
  const requestOrigin = getHeader(event.headers, 'origin');
  const origin = config.allowedOrigins.includes(requestOrigin) ? requestOrigin : '';
  if (!origin) return response(403, 'ORIGIN_NOT_ALLOWED', '');

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
        'X-Content-Type-Options': 'nosniff',
      },
      body: '',
    };
  }
  if (method !== 'GET' && method !== 'POST') {
    return response(405, 'METHOD_NOT_ALLOWED', origin, { Allow: 'GET, POST, OPTIONS' });
  }
  if (method === 'POST') {
    const contentType = getHeader(event.headers, 'content-type').toLowerCase();
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
      return response(415, 'UNSUPPORTED_MEDIA_TYPE', origin);
    }
  }

  const token = parseBearer(event.headers);
  if (!token) return response(401, 'UNAUTHORIZED', origin);

  let client;
  try {
    client = createUserClient(config, token);
    const authResult = await client.auth.getUser(token);
    const user = authResult && authResult.data && authResult.data.user;
    if (authResult.error || !user || typeof user.id !== 'string' || !UUID_PATTERN.test(user.id)) {
      return response(401, 'UNAUTHORIZED', origin);
    }
  } catch {
    return response(401, 'UNAUTHORIZED', origin);
  }

  if (method === 'GET') {
    if (event.body != null && event.body !== '') return response(400, 'INVALID_REQUEST', origin);
    const params = parseLedgerQuery(event);
    if (!params) return response(400, 'INVALID_PAGINATION', origin);
    try {
      const result = await client.rpc('economy_get_state', params);
      if (result.error) return mapRpcError(result.error, origin);
      if (!isRecord(result.data)) return response(502, 'ECONOMY_UPSTREAM_ERROR', origin);
      return success(result.data, origin);
    } catch {
      return response(502, 'ECONOMY_UPSTREAM_ERROR', origin);
    }
  }

  const parsed = parsePostBody(event);
  if (parsed.error) {
    const statusCode = parsed.error === 'BODY_TOO_LARGE' ? 413 : 400;
    return response(statusCode, parsed.error, origin);
  }

  try {
    const result = await client.rpc(parsed.contract.rpc, parsed.contract.params(parsed.body));
    if (result.error) return mapRpcError(result.error, origin);
    if (!isRecord(result.data)) return response(502, 'ECONOMY_UPSTREAM_ERROR', origin);
    return success(result.data, origin);
  } catch {
    return response(502, 'ECONOMY_UPSTREAM_ERROR', origin);
  }
};
