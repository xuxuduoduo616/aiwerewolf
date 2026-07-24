import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const functionPath = join(dirname(fileURLToPath(import.meta.url)), '../functions/payment-escrow.cjs');
const functionSource = readFileSync(functionPath, 'utf8');
const unavailableBody = '{"code":"PAYMENTS_NOT_CONFIGURED"}';

const getUser = vi.fn();
const from = vi.fn();
const insert = vi.fn();
const upsert = vi.fn();
const getAdminClient = vi.fn(() => ({ auth: { getUser }, from }));
const requireMock = vi.fn((id) => {
  if (id === './supabase-admin.cjs') return { getAdminClient };
  throw new Error(`Unexpected require: ${id}`);
});
const fetchMock = vi.fn();

const processMock = {
  env: {
    ALLOWED_ORIGIN: '',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-configured-placeholder',
  },
};

const loadHandler = () => {
  const module = { exports: {} };
  const context = vm.createContext({
    console,
    fetch: fetchMock,
    process: processMock,
    require: requireMock,
    exports: module.exports,
    module,
  });
  new vm.Script(functionSource, { filename: functionPath }).runInContext(context);
  return module.exports.handler;
};

const createEvent = (overrides = {}) => ({
  httpMethod: 'POST',
  headers: { origin: 'https://game.example' },
  body: JSON.stringify({ pack_id: 'coin-60', coin_amount: 60, bonus_amount: 60 }),
  ...overrides,
});

const expectNoPrivilegedOrMutationCall = () => {
  expect(requireMock).not.toHaveBeenCalled();
  expect(getAdminClient).not.toHaveBeenCalled();
  expect(getUser).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(upsert).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
};

describe('payment-escrow fail-closed boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['guest request', { headers: {} }],
    ['authenticated request', { headers: { Authorization: 'Bearer invalid-or-expired' } }],
    ['missing body', { body: undefined }],
    ['malformed JSON', { body: '{not-json' }],
    ['unknown pack', { body: JSON.stringify({ pack_id: 'unknown' }) }],
  ])('returns the exact unavailable contract for %s', async (_label, overrides) => {
    const response = await loadHandler()(createEvent(overrides));

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(unavailableBody);
    expect(JSON.parse(response.body)).toEqual({ code: 'PAYMENTS_NOT_CONFIGURED' });
    expectNoPrivilegedOrMutationCall();
  });

  it('returns before reading a hostile or malformed body', async () => {
    const bodyRead = vi.fn(() => { throw new Error('body must not be read'); });
    const event = createEvent();
    Object.defineProperty(event, 'body', { get: bodyRead });

    const response = await loadHandler()(event);

    expect(response.statusCode).toBe(503);
    expect(response.body).toBe(unavailableBody);
    expect(bodyRead).not.toHaveBeenCalled();
    expectNoPrivilegedOrMutationCall();
  });

  it('returns 503 for repeated and concurrent POSTs without rate or mutation branches', async () => {
    const handler = loadHandler();
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => handler(createEvent())),
    );

    expect(responses).toHaveLength(50);
    for (const response of responses) {
      expect(response.statusCode).toBe(503);
      expect(response.body).toBe(unavailableBody);
    }
    expectNoPrivilegedOrMutationCall();
  });

  it('keeps OPTIONS and method handling non-mutating', async () => {
    const handler = loadHandler();
    const options = await handler(createEvent({ httpMethod: 'OPTIONS', body: '' }));
    const get = await handler(createEvent({ httpMethod: 'GET', body: '' }));

    expect(options).toMatchObject({ statusCode: 204, body: '' });
    expect(options.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'https://game.example',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    expect(get.statusCode).toBe(405);
    expect(JSON.parse(get.body)).toEqual({ error: 'Method not allowed' });
    expectNoPrivilegedOrMutationCall();
  });

  it('contains no admin, order, wallet, simulated-success, or local credit path', () => {
    expect(functionSource).not.toMatch(/getAdminClient|coin_orders|user_coins/);
    expect(functionSource).not.toMatch(/\.insert\(|\.upsert\(|new_balance|_test_mode/);
    expect(functionSource).not.toMatch(/Math\.random|status:\s*['"]pending['"]/);
  });
});
