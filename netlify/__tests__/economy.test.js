import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

const testDir = dirname(fileURLToPath(import.meta.url));
const functionPath = join(testDir, '../functions/economy.cjs');
const sqlPath = join(testDir, '../../docs/economy-schema.sql');
const paymentPath = join(testDir, '../functions/payment-escrow.cjs');
const functionSource = readFileSync(functionPath, 'utf8');
const sqlSource = readFileSync(sqlPath, 'utf8');
const paymentSource = readFileSync(paymentPath, 'utf8');

const sqlPrerequisites = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid()
  returns uuid
  language sql
  stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create table public.game_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    board_id text not null,
    role text not null,
    result text not null check (result in ('WIN', 'LOSE')),
    rounds integer not null check (rounds >= 0),
    summary text not null,
    created_at timestamptz not null default now()
  );
  alter table public.game_records enable row level security;
  create policy game_records_select_own on public.game_records
    for select to authenticated using (auth.uid() = user_id);
  create policy game_records_insert_own on public.game_records
    for insert to authenticated with check (auth.uid() = user_id);
  grant select, insert on public.game_records to authenticated;
`;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const GAME_RECORD_ID = '22222222-2222-4222-8222-222222222222';
const LEDGER_CURSOR = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'test-user-token-0000000001';
const ORIGIN = 'https://game.example';
const SUPABASE_URL = 'https://project.example';
const ANON_KEY = 'test-only-anon-placeholder';
const IDEMPOTENCY_KEY = 'request-key-0000000001';

const configuredEnv = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: ANON_KEY,
  ALLOWED_ORIGIN: ORIGIN,
};

const defaultState = {
  catalog: [],
  wallet: { coins: 0, crystals: 0 },
  inventory: [],
  equippedSkinId: null,
  checkIn: {
    streak: 0,
    lastClaimDate: null,
    serverDate: '2026-08-23',
    claimedMilestoneDays: [],
  },
  onboarding: { completed: false, completedAt: null },
  ledger: [],
  nextCursor: null,
};

let createClient;
let getUser;
let rpc;
let requireMock;

const loadHandler = ({ env = configuredEnv, authResult, rpcImplementation } = {}) => {
  getUser = vi.fn().mockResolvedValue(authResult || {
    data: { user: { id: USER_ID } },
    error: null,
  });
  rpc = vi.fn(rpcImplementation || (async (name) => ({
    data: name === 'economy_get_state' ? defaultState : { action: name },
    error: null,
  })));
  createClient = vi.fn(() => ({ auth: { getUser }, rpc }));
  requireMock = vi.fn((id) => {
    if (id === '@supabase/supabase-js') return { createClient };
    throw new Error(`Unexpected require: ${id}`);
  });

  const module = { exports: {} };
  const context = vm.createContext({
    Buffer,
    URL,
    process: { env: { ...env } },
    require: requireMock,
    exports: module.exports,
    module,
  });
  new vm.Script(functionSource, { filename: functionPath }).runInContext(context);
  return module.exports.handler;
};

const createEvent = (overrides = {}) => ({
  httpMethod: 'GET',
  headers: {
    origin: ORIGIN,
    authorization: `Bearer ${TOKEN}`,
  },
  queryStringParameters: {},
  ...overrides,
});

const postEvent = (body, overrides = {}) => createEvent({
  httpMethod: 'POST',
  headers: {
    origin: ORIGIN,
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json; charset=utf-8',
  },
  body: JSON.stringify(body),
  ...overrides,
});

const parse = (result) => JSON.parse(result.body);

let sqlDb;
let sqlIdentity = 1;

const sqlUuid = (family, identity) => (
  `${family.toString(16).padStart(8, '0')}-0000-4000-8000-${identity.toString(16).padStart(12, '0')}`
);

const addSqlUser = async () => {
  const identity = sqlIdentity++;
  const userId = sqlUuid(1, identity);
  await sqlDb.query('insert into auth.users (id) values ($1)', [userId]);
  return { identity, userId };
};

const sqlRecordId = (identity, offset = 0) => sqlUuid(2 + offset, identity);
const sqlKey = (label, identity, offset = 0) => (
  `${label}-${identity.toString().padStart(6, '0')}-${offset.toString().padStart(6, '0')}`
);

const asAuthenticated = async (userId, callback) => {
  await sqlDb.exec(`
    reset role;
    set "request.jwt.claim.sub" = '${userId}';
    set role authenticated;
  `);
  try {
    return await callback();
  } finally {
    await sqlDb.exec('reset role; reset "request.jwt.claim.sub";');
  }
};

const asAnon = async (callback) => {
  await sqlDb.exec('reset role; reset "request.jwt.claim.sub"; set role anon;');
  try {
    return await callback();
  } finally {
    await sqlDb.exec('reset role; reset "request.jwt.claim.sub";');
  }
};

const createClientGameRecord = async (userId, recordId, result = 'WIN') => (
  asAuthenticated(userId, () => sqlDb.query(`
    insert into public.game_records
      (id, user_id, board_id, role, result, rounds, summary)
    values ($1, $2, '9-player', 'VILLAGER', $3, 3, 'client-authored history')
  `, [recordId, userId, result]))
);

const insertTrustedEligibility = async (userId, recordId, outcome = 'WIN') => {
  await sqlDb.query(`
    insert into public.economy_gameplay_eligibility
      (user_id, game_record_id, outcome, completed_at, source_event_id)
    values ($1, $2, $3, now(), $4)
  `, [userId, recordId, outcome, `trusted-event-${recordId}`]);
};

const callSqlJson = async (userId, statement, params = []) => (
  asAuthenticated(userId, async () => {
    const result = await sqlDb.query(`select ${statement} as result`, params);
    return result.rows[0].result;
  })
);

const countRows = async (tableName, userId) => {
  const result = await sqlDb.query(
    `select count(*)::integer as count from public.${tableName} where user_id = $1`,
    [userId],
  );
  return result.rows[0].count;
};

const walletBalance = async (userId, currency = 'coins') => {
  const result = await sqlDb.query(`
    select coalesce(max(balance), 0)::integer as balance
    from public.economy_wallets
    where user_id = $1 and currency = $2
  `, [userId, currency]);
  return result.rows[0].balance;
};

const insertHistoricalCheckInClaim = async ({
  userId, identity, offset, streakDay, serverDate,
}) => {
  const receiptId = sqlUuid(20 + offset, identity);
  await sqlDb.query(`
    insert into public.economy_mutation_receipts
      (id, user_id, idempotency_key, action, canonical_payload, status, result, completed_at)
    values ($1, $2, $3, 'claim_check_in', '{}'::jsonb, 'completed', '{}'::jsonb, now())
  `, [receiptId, userId, sqlKey('history-claim', identity, offset)]);
  await sqlDb.query(`
    insert into public.economy_check_in_claims
      (user_id, server_date, streak_day, coins_awarded, crystals_awarded, receipt_id)
    values ($1, $2, $3, 30, 0, $4)
  `, [userId, serverDate, streakDay, receiptId]);
};

describe('economy HTTP fail-closed boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['missing URL', { SUPABASE_ANON_KEY: ANON_KEY, ALLOWED_ORIGIN: ORIGIN }],
    ['missing anon key', { SUPABASE_URL, ALLOWED_ORIGIN: ORIGIN }],
    ['missing origin allowlist', { SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY }],
    ['malformed URL', { ...configuredEnv, SUPABASE_URL: 'http://project.example' }],
    ['URL with a path', { ...configuredEnv, SUPABASE_URL: `${SUPABASE_URL}/rest` }],
    ['malformed origin', { ...configuredEnv, ALLOWED_ORIGIN: `${ORIGIN}/path` }],
  ])('returns generic 503 before auth, body, or RPC for %s', async (_label, env) => {
    const handler = loadHandler({ env });
    const hostileEvent = new Proxy({}, {
      get: () => { throw new Error('request must not be read'); },
    });

    const result = await handler(hostileEvent);

    expect(result.statusCode).toBe(503);
    expect(parse(result)).toEqual({ code: 'ECONOMY_NOT_CONFIGURED' });
    expect(createClient).not.toHaveBeenCalled();
    expect(requireMock).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['wrong scheme', { authorization: `Basic ${TOKEN}` }],
    ['too short', { authorization: 'Bearer short' }],
    ['embedded whitespace', { authorization: 'Bearer invalid token value' }],
  ])('returns the same 401 for %s bearer syntax without RPC', async (_label, authHeaders) => {
    const handler = loadHandler();
    const result = await handler(createEvent({ headers: { origin: ORIGIN, ...authHeaders } }));

    expect(result.statusCode).toBe(401);
    expect(parse(result)).toEqual({ code: 'UNAUTHORIZED' });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', { data: { user: null }, error: { message: 'invalid jwt details' } }],
    ['expired', { data: { user: null }, error: { message: 'jwt expired details' } }],
    ['malformed subject', { data: { user: { id: 'attacker-id' } }, error: null }],
  ])('returns a generic 401 for %s verified-token result and never calls RPC', async (_label, authResult) => {
    const handler = loadHandler({ authResult });
    const result = await handler(createEvent());

    expect(result.statusCode).toBe(401);
    expect(parse(result)).toEqual({ code: 'UNAUTHORIZED' });
    expect(result.body).not.toMatch(/jwt|expired|attacker/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('derives request identity exclusively from the verified bearer context', async () => {
    const handler = loadHandler();
    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    expect(getUser).toHaveBeenCalledWith(TOKEN);
    expect(createClient).toHaveBeenCalledWith(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    expect(rpc).toHaveBeenCalledWith('economy_get_state', {
      p_ledger_limit: 25,
      p_ledger_cursor: null,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/user_?id|11111111/i);
  });

  it('returns claimed milestone days unchanged in the existing GET success envelope', async () => {
    const state = {
      ...defaultState,
      checkIn: { ...defaultState.checkIn, streak: 1, claimedMilestoneDays: [7, 30, 90] },
    };
    const handler = loadHandler({
      rpcImplementation: async () => ({ data: state, error: null }),
    });

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    expect(parse(result)).toEqual({ data: state });
    expect(parse(result).data.checkIn).toEqual({
      streak: 1,
      lastClaimDate: null,
      serverDate: '2026-08-23',
      claimedMilestoneDays: [7, 30, 90],
    });
    expect(rpc).toHaveBeenCalledWith('economy_get_state', {
      p_ledger_limit: 25,
      p_ledger_cursor: null,
    });
  });

  it('rejects body user spoofing and every unknown field after auth', async () => {
    const handler = loadHandler();
    const result = await handler(postEvent({
      action: 'claim_check_in',
      idempotencyKey: IDEMPOTENCY_KEY,
      userId: '99999999-9999-4999-8999-999999999999',
    }));

    expect(result.statusCode).toBe(400);
    expect(parse(result)).toEqual({ code: 'INVALID_REQUEST' });
    expect(getUser).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects every attempted claimed-milestone input on GET query/body and POST body', async () => {
    const attemptedRequests = [
      createEvent({ queryStringParameters: { claimedMilestoneDays: '7,14' } }),
      createEvent({ body: JSON.stringify({ claimedMilestoneDays: [7, 14] }) }),
      postEvent({
        action: 'claim_check_in',
        idempotencyKey: IDEMPOTENCY_KEY,
        claimedMilestoneDays: [7, 14],
      }),
    ];

    for (const event of attemptedRequests) {
      const handler = loadHandler();
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(parse(result).code).toMatch(/^INVALID_(PAGINATION|REQUEST)$/);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it('strictly gates origin, method and content type before authentication', async () => {
    const badOriginHandler = loadHandler();
    const badOrigin = await badOriginHandler(createEvent({
      headers: { origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` },
    }));
    expect(badOrigin.statusCode).toBe(403);
    expect(parse(badOrigin)).toEqual({ code: 'ORIGIN_NOT_ALLOWED' });
    expect(badOrigin.headers).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(createClient).not.toHaveBeenCalled();

    const methodHandler = loadHandler();
    const method = await methodHandler(createEvent({ httpMethod: 'PUT' }));
    expect(method.statusCode).toBe(405);
    expect(parse(method)).toEqual({ code: 'METHOD_NOT_ALLOWED' });
    expect(method.headers.Allow).toBe('GET, POST, OPTIONS');
    expect(createClient).not.toHaveBeenCalled();

    const contentHandler = loadHandler();
    const content = await contentHandler(postEvent(
      { action: 'claim_check_in', idempotencyKey: IDEMPOTENCY_KEY },
      { headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN}`, 'content-type': 'text/plain' } },
    ));
    expect(content.statusCode).toBe(415);
    expect(parse(content)).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('serves a narrow credential-free OPTIONS contract only for allowed origins', async () => {
    const handler = loadHandler();
    const result = await handler(createEvent({
      httpMethod: 'OPTIONS',
      headers: { origin: ORIGIN },
    }));

    expect(result).toMatchObject({ statusCode: 204, body: '' });
    expect(result.headers).toMatchObject({
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      Vary: 'Origin',
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{bad-json', 'INVALID_JSON', 400],
    ['array body', '[]', 'INVALID_REQUEST', 400],
    ['scalar body', '42', 'INVALID_REQUEST', 400],
    ['oversized body', JSON.stringify({ value: 'x'.repeat(8200) }), 'BODY_TOO_LARGE', 413],
  ])('rejects %s without RPC', async (_label, body, code, status) => {
    const handler = loadHandler();
    const result = await handler(createEvent({
      httpMethod: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body,
    }));

    expect(result.statusCode).toBe(status);
    expect(parse(result)).toEqual({ code });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized content length without reading JSON', async () => {
    const handler = loadHandler();
    const result = await handler(postEvent(
      { action: 'claim_check_in', idempotencyKey: IDEMPOTENCY_KEY },
      { headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'content-length': '8193',
      } },
    ));
    expect(result.statusCode).toBe(413);
    expect(parse(result)).toEqual({ code: 'BODY_TOO_LARGE' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: 'unknown', idempotencyKey: IDEMPOTENCY_KEY }, 'UNKNOWN_ACTION'],
    [{ action: 'claim_check_in', idempotencyKey: 'short' }, 'INVALID_IDEMPOTENCY_KEY'],
    [{ action: 'claim_gameplay_reward', idempotencyKey: IDEMPOTENCY_KEY, gameRecordId: 'bad' }, 'INVALID_GAME_RECORD_ID'],
    [{ action: 'unlock_skin', idempotencyKey: IDEMPOTENCY_KEY, skinId: '../bad' }, 'INVALID_SKIN_ID'],
    [{ action: 'equip_skin', idempotencyKey: IDEMPOTENCY_KEY, skinId: 4 }, 'INVALID_SKIN_ID'],
  ])('rejects invalid command %j with %s', async (body, code) => {
    const handler = loadHandler();
    const result = await handler(postEvent(body));
    expect(result.statusCode).toBe(400);
    expect(parse(result)).toEqual({ code });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('economy RPC allowlist and server authority', () => {
  it.each([
    ['claim_check_in', {}, 'economy_claim_check_in', {}],
    ['finish_onboarding', {}, 'economy_finish_onboarding', {}],
    ['claim_gameplay_reward', { gameRecordId: GAME_RECORD_ID }, 'economy_claim_gameplay_reward', { p_game_record_id: GAME_RECORD_ID }],
    ['unlock_skin', { skinId: 'mist-wanderer' }, 'economy_unlock_skin', { p_skin_id: 'mist-wanderer' }],
    ['equip_skin', { skinId: 'mist-wanderer' }, 'economy_equip_skin', { p_skin_id: 'mist-wanderer' }],
  ])('maps only %s to its single corresponding RPC', async (action, additionalBody, expectedRpc, additionalParams) => {
    const handler = loadHandler();
    const result = await handler(postEvent({ action, idempotencyKey: IDEMPOTENCY_KEY, ...additionalBody }));

    expect(result.statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(expectedRpc, {
      p_idempotency_key: IDEMPOTENCY_KEY,
      ...additionalParams,
    });
    const serializedParams = JSON.stringify(rpc.mock.calls[0][1]);
    expect(serializedParams).not.toMatch(/userId|user_id|date|price|reward|balance|catalog|result/i);
  });

  it('supports exact idempotent replay and stable conflict without a second mutation', async () => {
    const receipts = new Map();
    let mutations = 0;
    const implementation = async (name, params) => {
      const key = params.p_idempotency_key;
      const canonical = JSON.stringify({ name, ...params });
      const existing = receipts.get(key);
      if (existing && existing.canonical !== canonical) {
        return { data: null, error: { message: 'ECONOMY_IDEMPOTENCY_CONFLICT private sql omitted' } };
      }
      if (existing) return { data: existing.result, error: null };
      mutations += 1;
      const result = { action: name, mutationOrdinal: mutations };
      receipts.set(key, { canonical, result });
      return { data: result, error: null };
    };
    const handler = loadHandler({ rpcImplementation: implementation });
    const first = await handler(postEvent({ action: 'claim_check_in', idempotencyKey: IDEMPOTENCY_KEY }));
    const replay = await handler(postEvent({ action: 'claim_check_in', idempotencyKey: IDEMPOTENCY_KEY }));
    const conflict = await handler(postEvent({ action: 'finish_onboarding', idempotencyKey: IDEMPOTENCY_KEY }));

    expect(first.body).toBe(replay.body);
    expect(mutations).toBe(1);
    expect(conflict.statusCode).toBe(409);
    expect(parse(conflict)).toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(conflict.body).not.toContain('private sql');
  });

  it.each([
    ['ECONOMY_UNAUTHORIZED hidden', 401, 'UNAUTHORIZED'],
    ['ECONOMY_REWARD_UNAVAILABLE hidden', 409, 'GAMEPLAY_REWARD_UNAVAILABLE'],
    ['ECONOMY_ALREADY_CLAIMED hidden', 409, 'ALREADY_CLAIMED'],
    ['ECONOMY_DAILY_LIMIT hidden', 409, 'DAILY_LIMIT_REACHED'],
    ['ECONOMY_INSUFFICIENT_BALANCE hidden', 409, 'INSUFFICIENT_BALANCE'],
    ['ECONOMY_ALREADY_OWNED hidden', 409, 'ALREADY_OWNED'],
    ['ECONOMY_NOT_OWNED hidden', 409, 'NOT_OWNED'],
    ['ECONOMY_NOT_FOUND hidden', 404, 'NOT_FOUND'],
  ])('maps known database outcome %s without returning details', async (message, status, code) => {
    const handler = loadHandler({ rpcImplementation: async () => ({ data: null, error: { message } }) });
    const result = await handler(postEvent({ action: 'claim_check_in', idempotencyKey: IDEMPOTENCY_KEY }));
    expect(result.statusCode).toBe(status);
    expect(parse(result)).toEqual({ code });
    expect(result.body).not.toContain('hidden');
  });

  it('scrubs unknown upstream errors, SQL text and thrown stacks', async () => {
    const sqlHandler = loadHandler({
      rpcImplementation: async () => ({ data: null, error: { message: 'select secret from internal_table', details: TOKEN } }),
    });
    const sqlResult = await sqlHandler(createEvent());
    expect(sqlResult.statusCode).toBe(502);
    expect(parse(sqlResult)).toEqual({ code: 'ECONOMY_UPSTREAM_ERROR' });
    expect(sqlResult.body).not.toMatch(/select|internal|token/i);

    const throwHandler = loadHandler({
      rpcImplementation: async () => { throw new Error(`stack ${TOKEN}`); },
    });
    const throwResult = await throwHandler(createEvent());
    expect(throwResult.statusCode).toBe(502);
    expect(parse(throwResult)).toEqual({ code: 'ECONOMY_UPSTREAM_ERROR' });
    expect(throwResult.body).not.toContain(TOKEN);
  });

  it('enforces default, bounded and cursor-aware ledger pagination', async () => {
    const handler = loadHandler();
    const bounded = await handler(createEvent({
      queryStringParameters: { ledgerLimit: '100', ledgerCursor: LEDGER_CURSOR },
    }));
    expect(bounded.statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledWith('economy_get_state', {
      p_ledger_limit: 100,
      p_ledger_cursor: LEDGER_CURSOR,
    });

    for (const queryStringParameters of [
      { ledgerLimit: '0' }, { ledgerLimit: '101' }, { ledgerLimit: '1.5' },
      { ledgerCursor: 'bad' }, { userId: USER_ID },
    ]) {
      const invalidHandler = loadHandler();
      const invalid = await invalidHandler(createEvent({ queryStringParameters }));
      expect(invalid.statusCode).toBe(400);
      expect(parse(invalid)).toEqual({ code: 'INVALID_PAGINATION' });
      expect(rpc).not.toHaveBeenCalled();
    }
  });
});

describe('economy SQL behavior in PGlite', () => {
  beforeAll(async () => {
    sqlDb = new PGlite();
    await sqlDb.waitReady;
    await sqlDb.exec(sqlPrerequisites);
    await sqlDb.exec(sqlSource);
  }, 30_000);

  afterAll(async () => {
    if (sqlDb) await sqlDb.close();
  });

  it('returns an exact empty milestone history and never infers claims from a high streak', async () => {
    const { userId } = await addSqlUser();
    await sqlDb.query(`
      insert into public.economy_player_state
        (user_id, check_in_streak, last_check_in_date)
      values ($1, 90, (current_timestamp at time zone 'UTC')::date - 1)
    `, [userId]);

    const state = await callSqlJson(userId, 'public.economy_get_state(25, null)');

    expect(state.checkIn).toMatchObject({ streak: 90, claimedMilestoneDays: [] });
  });

  it('uses only filtered claims history when streak resets, including dedupe and fixed ordering', async () => {
    const { identity, userId } = await addSqlUser();
    await sqlDb.query(`
      insert into public.economy_player_state
        (user_id, check_in_streak, last_check_in_date)
      values ($1, 1, (current_timestamp at time zone 'UTC')::date - 10)
    `, [userId]);
    const historicalDays = [90, 7, 30, 7, 8];
    for (const [offset, streakDay] of historicalDays.entries()) {
      await insertHistoricalCheckInClaim({
        userId,
        identity,
        offset,
        streakDay,
        serverDate: `2026-01-${String(offset + 1).padStart(2, '0')}`,
      });
    }

    const state = await callSqlJson(userId, 'public.economy_get_state(25, null)');

    expect(state.checkIn).toMatchObject({
      streak: 1,
      claimedMilestoneDays: [7, 30, 90],
    });
  });

  it('isolates arbitrary milestone subsets by auth.uid()', async () => {
    const firstUser = await addSqlUser();
    const secondUser = await addSqlUser();
    for (const [offset, streakDay] of [60, 14].entries()) {
      await insertHistoricalCheckInClaim({
        ...firstUser,
        offset,
        streakDay,
        serverDate: `2026-02-${String(offset + 1).padStart(2, '0')}`,
      });
    }
    for (const [offset, streakDay] of [90, 7, 30].entries()) {
      await insertHistoricalCheckInClaim({
        ...secondUser,
        offset: offset + 5,
        streakDay,
        serverDate: `2026-03-${String(offset + 1).padStart(2, '0')}`,
      });
    }

    const firstState = await callSqlJson(
      firstUser.userId,
      'public.economy_get_state(25, null)',
    );
    const secondState = await callSqlJson(
      secondUser.userId,
      'public.economy_get_state(25, null)',
    );

    expect(firstState.checkIn.claimedMilestoneDays).toEqual([14, 60]);
    expect(secondState.checkIn.claimedMilestoneDays).toEqual([7, 30, 90]);
  });

  it('keeps claimed milestone history identical across ledger pages', async () => {
    const { identity, userId } = await addSqlUser();
    await insertHistoricalCheckInClaim({
      userId,
      identity,
      offset: 10,
      streakDay: 14,
      serverDate: '2025-12-14',
    });
    await callSqlJson(
      userId,
      'public.economy_finish_onboarding($1)',
      [sqlKey('milestone-page-onboarding', identity)],
    );
    await callSqlJson(
      userId,
      'public.economy_claim_check_in($1)',
      [sqlKey('milestone-page-check-in', identity)],
    );

    const firstPage = await callSqlJson(userId, 'public.economy_get_state(1, null)');
    expect(firstPage.ledger).toHaveLength(1);
    expect(firstPage.nextCursor).toMatch(/^[0-9a-f-]{36}$/i);
    const secondPage = await callSqlJson(
      userId,
      'public.economy_get_state(1, $1)',
      [firstPage.nextCursor],
    );

    expect(secondPage.ledger).toHaveLength(1);
    expect(firstPage.checkIn.claimedMilestoneDays).toEqual([14]);
    expect(secondPage.checkIn.claimedMilestoneDays).toEqual([14]);
  });

  it('executes the schema and exposes the exact accepted wuxia catalog', async () => {
    const products = await sqlDb.query(`
      select id, name, currency, price, asset_key
      from public.economy_skin_catalog
      where active is true and acquisition = 'purchase'
      order by currency, price
    `);
    expect(products.rows).toEqual([
      { id: 'mist-wanderer', name: 'Mist Wanderer', currency: 'coins', price: 800, asset_key: 'skins/mist-wanderer' },
      { id: 'bamboo-vigil', name: 'Bamboo Vigil', currency: 'coins', price: 1400, asset_key: 'skins/bamboo-vigil' },
      { id: 'tidal-swordsman', name: 'Tidal Swordsman', currency: 'coins', price: 2200, asset_key: 'skins/tidal-swordsman' },
      { id: 'moonlit-crane', name: 'Moonlit Crane', currency: 'coins', price: 3200, asset_key: 'skins/moonlit-crane' },
      { id: 'jade-moon-oath', name: 'Jade Moon Oath', currency: 'crystals', price: 20, asset_key: 'skins/jade-moon-oath' },
      { id: 'tidebreaker-vow', name: 'Tidebreaker Vow', currency: 'crystals', price: 40, asset_key: 'skins/tidebreaker-vow' },
      { id: 'crimson-lotus-shadow', name: 'Crimson Lotus Shadow', currency: 'crystals', price: 80, asset_key: 'skins/crimson-lotus-shadow' },
    ]);
    const frames = await sqlDb.query(`
      select id, name, asset_key from public.economy_skin_catalog
      where active is true and item_kind = 'avatar_frame' order by tier
    `);
    expect(frames.rows).toEqual([
      { id: 'avatar-frame:ink-ring', name: 'Ink Ring Avatar Frame', asset_key: 'frames/ink-ring' },
      { id: 'avatar-frame:crimson-moon', name: 'Crimson Moon Avatar Frame', asset_key: 'frames/crimson-moon' },
    ]);
  });

  it('denies a client-authored WIN record when no trusted eligibility exists', async () => {
    const { identity, userId } = await addSqlUser();
    const recordId = sqlRecordId(identity);
    await createClientGameRecord(userId, recordId, 'WIN');

    await expect(callSqlJson(
      userId,
      'public.economy_claim_gameplay_reward($1, $2)',
      [sqlKey('forged-win', identity), recordId],
    )).rejects.toThrow(/ECONOMY_REWARD_UNAVAILABLE/);

    expect(await countRows('economy_gameplay_eligibility', userId)).toBe(0);
    expect(await countRows('economy_gameplay_claims', userId)).toBe(0);
    expect(await countRows('economy_mutation_receipts', userId)).toBe(0);
    expect(await countRows('economy_ledger', userId)).toBe(0);
    expect(await walletBalance(userId)).toBe(0);
  });

  it('rewards only a trusted eligibility outcome and ignores client result', async () => {
    const { identity, userId } = await addSqlUser();
    const recordId = sqlRecordId(identity);
    await createClientGameRecord(userId, recordId, 'WIN');
    await insertTrustedEligibility(userId, recordId, 'LOSE');

    const result = await callSqlJson(
      userId,
      'public.economy_claim_gameplay_reward($1, $2)',
      [sqlKey('trusted-loss', identity), recordId],
    );

    expect(result).toMatchObject({
      action: 'claim_gameplay_reward',
      gameRecordId: recordId,
      awardedCoins: 80,
      wallet: { coins: 80, crystals: 0 },
    });
    expect(await countRows('economy_gameplay_claims', userId)).toBe(1);
    expect(await countRows('economy_ledger', userId)).toBe(1);
    expect(await walletBalance(userId)).toBe(80);
  });

  it('executes replay, conflict and failure rollback against real SQL', async () => {
    const firstUser = await addSqlUser();
    const key = sqlKey('onboarding', firstUser.identity);
    const first = await callSqlJson(firstUser.userId, 'public.economy_finish_onboarding($1)', [key]);
    const replay = await callSqlJson(firstUser.userId, 'public.economy_finish_onboarding($1)', [key]);
    expect(replay).toEqual(first);

    await expect(callSqlJson(
      firstUser.userId,
      'public.economy_claim_check_in($1)',
      [key],
    )).rejects.toThrow(/ECONOMY_IDEMPOTENCY_CONFLICT/);
    expect(await walletBalance(firstUser.userId)).toBe(200);
    expect(await countRows('economy_ledger', firstUser.userId)).toBe(1);
    expect(await countRows('economy_mutation_receipts', firstUser.userId)).toBe(1);

    const secondUser = await addSqlUser();
    await expect(callSqlJson(
      secondUser.userId,
      'public.economy_unlock_skin($1, $2)',
      [sqlKey('rollback', secondUser.identity), 'mist-wanderer'],
    )).rejects.toThrow(/ECONOMY_INSUFFICIENT_BALANCE/);
    expect(await countRows('economy_mutation_receipts', secondUser.userId)).toBe(0);
    expect(await countRows('economy_wallets', secondUser.userId)).toBe(0);
    expect(await countRows('economy_ledger', secondUser.userId)).toBe(0);
    expect(await countRows('economy_inventory', secondUser.userId)).toBe(0);
  });

  it('enforces RLS isolation and denies direct economy/eligibility writes', async () => {
    const firstUser = await addSqlUser();
    const secondUser = await addSqlUser();
    await sqlDb.query(`
      insert into public.economy_wallets (user_id, currency, balance)
      values ($1, 'coins', 10), ($2, 'coins', 20)
    `, [firstUser.userId, secondUser.userId]);

    const visible = await asAuthenticated(firstUser.userId, () => sqlDb.query(`
      select user_id, balance from public.economy_wallets order by user_id
    `));
    expect(visible.rows).toEqual([{ user_id: firstUser.userId, balance: 10 }]);
    await expect(asAuthenticated(firstUser.userId, () => sqlDb.query(`
      update public.economy_wallets set balance = 999 where user_id = $1
    `, [firstUser.userId]))).rejects.toThrow(/permission denied/);

    const recordId = sqlRecordId(firstUser.identity);
    await createClientGameRecord(firstUser.userId, recordId, 'WIN');
    await insertTrustedEligibility(firstUser.userId, recordId, 'LOSE');
    const forbiddenEligibilityWrites = [
      [`insert into public.economy_gameplay_eligibility
          (user_id, game_record_id, outcome, completed_at, source_event_id)
        values ($1, $2, 'WIN', now(), 'client-forged-event-0001')`, [firstUser.userId, recordId]],
      ['update public.economy_gameplay_eligibility set outcome = \'WIN\' where user_id = $1', [firstUser.userId]],
      ['delete from public.economy_gameplay_eligibility where user_id = $1', [firstUser.userId]],
    ];
    for (const [statement, params] of forbiddenEligibilityWrites) {
      await expect(asAuthenticated(
        firstUser.userId,
        () => sqlDb.query(statement, params),
      )).rejects.toThrow(/permission denied/);
      await expect(asAnon(
        () => sqlDb.query(statement, params),
      )).rejects.toThrow(/permission denied/);
    }
    await expect(asAuthenticated(firstUser.userId, () => sqlDb.query(
      'select * from public.economy_gameplay_eligibility',
    ))).rejects.toThrow(/permission denied/);
    expect(await countRows('economy_gameplay_eligibility', firstUser.userId)).toBe(1);
  });

  it('gives one effect for queued concurrent same-day claims and same-key replay', async () => {
    const firstUser = await addSqlUser();
    const outcomes = await asAuthenticated(firstUser.userId, () => Promise.allSettled([
      sqlDb.query('select public.economy_claim_check_in($1)', [sqlKey('day-claim', firstUser.identity, 1)]),
      sqlDb.query('select public.economy_claim_check_in($1)', [sqlKey('day-claim', firstUser.identity, 2)]),
    ]));
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(String(outcomes.find(({ status }) => status === 'rejected')?.reason)).toMatch(/ECONOMY_ALREADY_CLAIMED/);
    expect(await countRows('economy_check_in_claims', firstUser.userId)).toBe(1);
    expect(await countRows('economy_mutation_receipts', firstUser.userId)).toBe(1);
    expect(await countRows('economy_ledger', firstUser.userId)).toBe(1);
    expect(await walletBalance(firstUser.userId)).toBe(30);

    const secondUser = await addSqlUser();
    const replayKey = sqlKey('same-key', secondUser.identity);
    const replays = await asAuthenticated(secondUser.userId, () => Promise.all([
      sqlDb.query('select public.economy_claim_check_in($1) as result', [replayKey]),
      sqlDb.query('select public.economy_claim_check_in($1) as result', [replayKey]),
    ]));
    expect(replays[0].rows[0].result).toEqual(replays[1].rows[0].result);
    expect(await countRows('economy_check_in_claims', secondUser.userId)).toBe(1);
    expect(await countRows('economy_mutation_receipts', secondUser.userId)).toBe(1);
    expect(await countRows('economy_ledger', secondUser.userId)).toBe(1);
  });

  it('executes the 7/14/30/60/90 milestones and does not replay them at day 91', async () => {
    const cases = [
      { day: 7, coins: 250, crystals: 0, assets: ['avatar-frame:ink-ring'] },
      { day: 14, coins: 550, crystals: 0, assets: [] },
      { day: 30, coins: 40, crystals: 3, assets: [] },
      { day: 60, coins: 60, crystals: 0, assets: ['mist-wanderer'] },
      { day: 90, coins: 100, crystals: 8, assets: ['avatar-frame:crimson-moon'] },
      { day: 91, coins: 250, crystals: 0, assets: [] },
    ];

    for (const expected of cases) {
      const { identity, userId } = await addSqlUser();
      await sqlDb.query(`
        insert into public.economy_wallets (user_id, currency, balance)
        values ($1, 'coins', 0), ($1, 'crystals', 0)
      `, [userId]);
      await sqlDb.query(`
        insert into public.economy_player_state
          (user_id, check_in_streak, last_check_in_date)
        values ($1, $2, (current_timestamp at time zone 'UTC')::date - 1)
      `, [userId, expected.day - 1]);

      const result = await callSqlJson(
        userId,
        'public.economy_claim_check_in($1)',
        [sqlKey('milestone', identity, expected.day)],
      );
      expect(result).toMatchObject({
        streak: expected.day,
        awardedCoins: expected.coins,
        awardedCrystals: expected.crystals,
        unlockedItemIds: expected.assets,
      });
      expect(await walletBalance(userId)).toBe(expected.coins);
      expect(await walletBalance(userId, 'crystals')).toBe(expected.crystals);
      const inventory = await sqlDb.query(`
        select item_id from public.economy_inventory where user_id = $1 order by item_id
      `, [userId]);
      expect(inventory.rows.map(({ item_id }) => item_id)).toEqual(expected.assets);
    }
  }, 15_000);

  it('awards onboarding once and rolls back a second-key attempt', async () => {
    const { identity, userId } = await addSqlUser();
    const first = await callSqlJson(
      userId,
      'public.economy_finish_onboarding($1)',
      [sqlKey('onboard-once', identity, 1)],
    );
    expect(first).toMatchObject({ awardedCoins: 200, wallet: { coins: 200, crystals: 0 } });
    await expect(callSqlJson(
      userId,
      'public.economy_finish_onboarding($1)',
      [sqlKey('onboard-once', identity, 2)],
    )).rejects.toThrow(/ECONOMY_ALREADY_CLAIMED/);
    expect(await walletBalance(userId)).toBe(200);
    expect(await countRows('economy_ledger', userId)).toBe(1);
    expect(await countRows('economy_mutation_receipts', userId)).toBe(1);
  });

  it('enforces gameplay ownership, duplicate claim, 200-Coin and five-claim caps', async () => {
    const firstUser = await addSqlUser();
    const secondUser = await addSqlUser();
    const recordIds = Array.from({ length: 5 }, (_, offset) => sqlRecordId(firstUser.identity, offset));
    for (const recordId of recordIds) {
      await createClientGameRecord(firstUser.userId, recordId, 'WIN');
      await insertTrustedEligibility(firstUser.userId, recordId, 'LOSE');
    }

    await expect(callSqlJson(
      secondUser.userId,
      'public.economy_claim_gameplay_reward($1, $2)',
      [sqlKey('wrong-owner', secondUser.identity), recordIds[0]],
    )).rejects.toThrow(/ECONOMY_REWARD_UNAVAILABLE/);

    await callSqlJson(firstUser.userId, 'public.economy_claim_gameplay_reward($1, $2)', [sqlKey('game', firstUser.identity, 0), recordIds[0]]);
    await expect(callSqlJson(
      firstUser.userId,
      'public.economy_claim_gameplay_reward($1, $2)',
      [sqlKey('game-duplicate', firstUser.identity), recordIds[0]],
    )).rejects.toThrow(/ECONOMY_ALREADY_CLAIMED/);
    for (let offset = 1; offset < 4; offset += 1) {
      await callSqlJson(firstUser.userId, 'public.economy_claim_gameplay_reward($1, $2)', [sqlKey('game', firstUser.identity, offset), recordIds[offset]]);
    }
    await expect(callSqlJson(
      firstUser.userId,
      'public.economy_claim_gameplay_reward($1, $2)',
      [sqlKey('game', firstUser.identity, 4), recordIds[4]],
    )).rejects.toThrow(/ECONOMY_DAILY_LIMIT/);
    expect(await countRows('economy_gameplay_claims', firstUser.userId)).toBe(4);
    expect(await walletBalance(firstUser.userId)).toBe(200);

    const cappedUser = await addSqlUser();
    const cappedRecord = sqlRecordId(cappedUser.identity);
    await createClientGameRecord(cappedUser.userId, cappedRecord, 'LOSE');
    await insertTrustedEligibility(cappedUser.userId, cappedRecord, 'LOSE');
    await sqlDb.query(`
      insert into public.economy_wallets (user_id, currency, balance)
      values ($1, 'coins', 0), ($1, 'crystals', 0)
    `, [cappedUser.userId]);
    await sqlDb.query(`
      insert into public.economy_player_state
        (user_id, gameplay_server_date, gameplay_claims_today, gameplay_coins_today)
      values ($1, (current_timestamp at time zone 'UTC')::date, 5, 0)
    `, [cappedUser.userId]);
    await expect(callSqlJson(
      cappedUser.userId,
      'public.economy_claim_gameplay_reward($1, $2)',
      [sqlKey('five-cap', cappedUser.identity), cappedRecord],
    )).rejects.toThrow(/ECONOMY_DAILY_LIMIT/);
    expect(await countRows('economy_gameplay_claims', cappedUser.userId)).toBe(0);
  }, 15_000);

  it('rolls back insufficient unlock, prevents duplicates, and equips only owned skins', async () => {
    const insufficientUser = await addSqlUser();
    await expect(callSqlJson(
      insufficientUser.userId,
      'public.economy_unlock_skin($1, $2)',
      [sqlKey('insufficient', insufficientUser.identity), 'mist-wanderer'],
    )).rejects.toThrow(/ECONOMY_INSUFFICIENT_BALANCE/);
    expect(await countRows('economy_mutation_receipts', insufficientUser.userId)).toBe(0);
    expect(await countRows('economy_inventory', insufficientUser.userId)).toBe(0);
    expect(await countRows('economy_ledger', insufficientUser.userId)).toBe(0);

    const fundedUser = await addSqlUser();
    await sqlDb.query(`
      insert into public.economy_wallets (user_id, currency, balance)
      values ($1, 'coins', 1000), ($1, 'crystals', 0)
    `, [fundedUser.userId]);
    await sqlDb.query('insert into public.economy_player_state (user_id) values ($1)', [fundedUser.userId]);
    const unlockKey = sqlKey('unlock', fundedUser.identity);
    const unlock = await callSqlJson(
      fundedUser.userId,
      'public.economy_unlock_skin($1, $2)',
      [unlockKey, 'mist-wanderer'],
    );
    const replay = await callSqlJson(
      fundedUser.userId,
      'public.economy_unlock_skin($1, $2)',
      [unlockKey, 'mist-wanderer'],
    );
    expect(replay).toEqual(unlock);
    expect(unlock).toMatchObject({ chargedCurrency: 'coins', chargedAmount: 800, wallet: { coins: 200 } });
    await expect(callSqlJson(
      fundedUser.userId,
      'public.economy_unlock_skin($1, $2)',
      [sqlKey('duplicate-unlock', fundedUser.identity), 'mist-wanderer'],
    )).rejects.toThrow(/ECONOMY_ALREADY_OWNED/);
    await expect(callSqlJson(
      fundedUser.userId,
      'public.economy_equip_skin($1, $2)',
      [sqlKey('equip-missing', fundedUser.identity), 'bamboo-vigil'],
    )).rejects.toThrow(/ECONOMY_NOT_OWNED/);
    await callSqlJson(
      fundedUser.userId,
      'public.economy_equip_skin($1, $2)',
      [sqlKey('equip-owned', fundedUser.identity), 'mist-wanderer'],
    );
    const state = await sqlDb.query(`
      select equipped_skin_id from public.economy_player_state where user_id = $1
    `, [fundedUser.userId]);
    expect(state.rows).toEqual([{ equipped_skin_id: 'mist-wanderer' }]);
    expect(await walletBalance(fundedUser.userId)).toBe(200);
    expect(await countRows('economy_inventory', fundedUser.userId)).toBe(1);
    expect(await countRows('economy_ledger', fundedUser.userId)).toBe(1);
    expect(await countRows('economy_mutation_receipts', fundedUser.userId)).toBe(2);
  });
});

describe('economy SQL atomic, reward, ownership and RLS contract', () => {
  it('declares bounded two-currency wallets, append-only ledger and uniqueness guards', () => {
    expect(sqlSource).toMatch(/currency in \('coins', 'crystals'\)/);
    expect(sqlSource).toMatch(/balance between 0 and 2000000000/);
    expect(sqlSource).toMatch(/economy_ledger_append_only/);
    expect(sqlSource).toMatch(/before update or delete on public\.economy_ledger/);
    expect(sqlSource).toMatch(/primary key \(user_id, item_id\)/);
    expect(sqlSource).toMatch(/primary key \(user_id, server_date\)/);
    expect(sqlSource).toMatch(/primary key \(user_id, game_record_id\)/);
    expect(sqlSource).toMatch(/unique \(user_id, idempotency_key\)/);
  });

  it('uses auth.uid, fixed search paths, RLS and grants only minimal public RPCs', () => {
    expect(sqlSource.match(/security definer/g)?.length).toBeGreaterThanOrEqual(11);
    expect(sqlSource.match(/set search_path = pg_catalog, public/g)?.length).toBeGreaterThanOrEqual(12);
    expect(sqlSource).toMatch(/alter table public\.economy_wallets enable row level security/);
    expect(sqlSource).toMatch(/alter table public\.economy_gameplay_claims enable row level security/);
    expect(sqlSource).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)/);
    expect(sqlSource).toMatch(/revoke all on public\.economy_wallets[\s\S]*from public, anon, authenticated/);
    expect(sqlSource.match(/grant execute on function public\.economy_/g)).toHaveLength(6);

    for (const name of [
      'economy_claim_check_in', 'economy_finish_onboarding',
      'economy_claim_gameplay_reward', 'economy_unlock_skin', 'economy_equip_skin',
    ]) {
      const signature = new RegExp(`function public\\.${name}\\(([^)]*)\\)`, 'i').exec(sqlSource)?.[1] || '';
      expect(signature).not.toMatch(/user_?id|date|price|reward|balance|result/i);
    }
  });

  it('serializes idempotency and state so replay, conflict and concurrent double-click are atomic', () => {
    expect(sqlSource).toMatch(/on conflict \(user_id, idempotency_key\) do nothing/);
    expect(sqlSource).toMatch(/where user_id = v_user_id and idempotency_key = p_idempotency_key\s+for update/);
    expect(sqlSource).toMatch(/v_existing\.canonical_payload <> p_canonical_payload/);
    expect(sqlSource).toMatch(/ECONOMY_IDEMPOTENCY_CONFLICT/);
    expect(sqlSource).toMatch(/where user_id = v_user_id for update/);
    expect(sqlSource).toMatch(/economy_complete_receipt/);
    expect(sqlSource.trim()).toMatch(/^--[\s\S]*begin;[\s\S]*commit;$/);
  });

  it('defines UTC check-in cycle, same-day exclusion and all five one-time milestones', () => {
    expect(sqlSource).toMatch(/current_timestamp at time zone 'UTC'/);
    expect(sqlSource).toMatch(/v_state\.last_check_in_date = v_server_date/);
    expect(sqlSource).toMatch(/v_server_date - 1 then v_state\.check_in_streak \+ 1\s+else 1/);
    expect(sqlSource).toMatch(/array\[30, 40, 50, 60, 70, 100, 250\]/);
    expect(sqlSource).toMatch(/v_streak = 7[\s\S]*avatar-frame:ink-ring/);
    expect(sqlSource).toMatch(/v_streak = 14[\s\S]*v_coins := v_coins \+ 300/);
    expect(sqlSource).toMatch(/v_streak = 30[\s\S]*v_crystals := 3/);
    expect(sqlSource).toMatch(/v_streak = 60[\s\S]*mist-wanderer/);
    expect(sqlSource).toMatch(/v_streak = 90[\s\S]*v_crystals := 8[\s\S]*avatar-frame:crimson-moon/);
    expect(sqlSource).not.toMatch(/v_streak\s*>=\s*(7|14|30|60|90)/);
  });

  it('derives claimed milestone state only from auth-scoped check-in claims', () => {
    const claimedExpression = /'claimedMilestoneDays',([\s\S]*?)\n\s*\),\n\s*'onboarding'/.exec(sqlSource)?.[1] || '';
    expect(claimedExpression).toMatch(/select distinct claim\.streak_day/);
    expect(claimedExpression).toMatch(/from public\.economy_check_in_claims claim/);
    expect(claimedExpression).toMatch(/claim\.user_id = v_user_id/);
    expect(claimedExpression).toMatch(/claim\.streak_day in \(7, 14, 30, 60, 90\)/);
    expect(claimedExpression).toMatch(/jsonb_agg\(milestone\.streak_day order by milestone\.streak_day\)/);
    expect(claimedExpression).toMatch(/'\[\]'::jsonb/);
    expect(claimedExpression).not.toMatch(/economy_player_state|economy_ledger|wallet|inventory|receipt|catalog/i);
  });

  it('makes onboarding fixed and once-only under a row lock', () => {
    expect(sqlSource).toMatch(/select onboarding_completed_at into v_completed_at[\s\S]*for update/);
    expect(sqlSource).toMatch(/if v_completed_at is not null then[\s\S]*ECONOMY_ALREADY_CLAIMED/);
    expect(sqlSource).toMatch(/'coins', 200, 'onboarding'/);
  });

  it('derives gameplay ownership/outcome only from trusted eligibility and enforces both UTC caps', () => {
    expect(sqlSource).toMatch(/from public\.economy_gameplay_eligibility[\s\S]*game_record_id = p_game_record_id and user_id = v_user_id/);
    expect(sqlSource).toMatch(/v_eligibility\.outcome = 'WIN' then 20/);
    expect(sqlSource).toMatch(/ECONOMY_REWARD_UNAVAILABLE/);
    expect(sqlSource).toMatch(/v_state\.gameplay_claims_today = 0 then 40/);
    expect(sqlSource).toMatch(/gameplay_claims_today >= 5 or v_state\.gameplay_coins_today >= 200/);
    expect(sqlSource).toMatch(/least\(v_reward, 200 - v_state\.gameplay_coins_today\)/);
    expect(sqlSource).toMatch(/primary key \(user_id, game_record_id\)/);
  });

  it('uses server catalog prices and ownership locks for unlock/equip failure safety', () => {
    expect(sqlSource).toMatch(/tier = 'basic' and currency = 'coins' and price in \(800, 1400, 2200, 3200\)/);
    expect(sqlSource).toMatch(/tier = 'premium' and currency = 'crystals' and price in \(20, 40, 80\)/);
    expect(sqlSource).toMatch(/active is true and item_kind = 'skin'[\s\S]*acquisition = 'purchase'/);
    expect(sqlSource).toMatch(/v_item\.currency, -v_item\.price, 'skin_unlock'/);
    expect(sqlSource).toMatch(/ECONOMY_INSUFFICIENT_BALANCE/);
    expect(sqlSource).toMatch(/ECONOMY_ALREADY_OWNED/);
    expect(sqlSource).toMatch(/join public\.economy_skin_catalog catalog[\s\S]*inventory\.user_id = v_user_id[\s\S]*catalog\.item_kind = 'skin'/);
    expect(sqlSource).toMatch(/ECONOMY_NOT_OWNED/);
    expect(sqlSource).not.toMatch(/gameplay_modifier|reward_multiplier|hidden_permission/i);
  });

  it('keeps the economy module independent from the unchanged payment closure', () => {
    expect(functionSource).not.toMatch(/payment-escrow|PAYMENTS_NOT_CONFIGURED|coin_orders|user_coins/);
    expect(functionSource).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY/i);
    expect(paymentSource).toContain('PAYMENTS_NOT_CONFIGURED');
    expect(paymentSource).not.toContain('economy.cjs');
  });
});
