import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const functionPath = join(dirname(fileURLToPath(import.meta.url)), '../functions/supabase-admin.cjs');
const functionSource = readFileSync(functionPath, 'utf8');
const projectUrl = 'https://project.invalid';
const serviceRolePlaceholder = 'test-only-service-role-placeholder';
const unavailableBody = '{"error":"Method not allowed"}';

const createClient = vi.fn();
const requireMock = vi.fn((id) => {
  if (id === '@supabase/supabase-js') return { createClient };
  throw new Error(`Unexpected require: ${id}`);
});

const loadModule = (env = {}) => {
  const module = { exports: {} };
  const context = vm.createContext({
    process: { env },
    require: requireMock,
    exports: module.exports,
    module,
  });
  new vm.Script(functionSource, { filename: functionPath }).runInContext(context);
  return module.exports;
};

const expectUnavailableResponse = (response) => {
  expect(response).toEqual({
    statusCode: 405,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
    body: unavailableBody,
  });
  expect(JSON.parse(response.body)).toEqual({ error: 'Method not allowed' });
  expect(response.body).not.toContain(projectUrl);
  expect(response.body).not.toContain(serviceRolePlaceholder);
  expect(response.body).not.toContain('HandlerNotFound');
};

describe('supabase-admin packaged helper boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['no configuration', {}],
    ['missing service role', { SUPABASE_URL: projectUrl }],
    ['missing URL', { SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder }],
  ])('preserves the null helper result for %s', (_label, env) => {
    const module = loadModule(env);

    expect(module).toHaveProperty('getAdminClient');
    expect(module).toHaveProperty('SUPABASE_URL');
    expect(module.getAdminClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('preserves lazy cached client creation and the existing auth options', () => {
    const client = { kind: 'controlled-admin-client' };
    createClient.mockReturnValue(client);
    const module = loadModule({
      SUPABASE_URL: projectUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
    });

    expect(module.SUPABASE_URL).toBe(projectUrl);
    expect(createClient).not.toHaveBeenCalled();
    expect(module.getAdminClient()).toBe(client);
    expect(module.getAdminClient()).toBe(client);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(projectUrl, serviceRolePlaceholder, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  });

  it.each(['GET', 'POST', 'OPTIONS', undefined])(
    'returns the fixed 405 contract for method %s without creating a client',
    async (httpMethod) => {
      const { handler } = loadModule({
        SUPABASE_URL: projectUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
      });

      const response = await handler(httpMethod === undefined ? {} : { httpMethod });

      expectUnavailableResponse(response);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it('returns before reading hostile request data or touching privileged surfaces', async () => {
    const requestRead = vi.fn(() => {
      throw new Error('request data must not be read');
    });
    const event = new Proxy({}, {
      get: requestRead,
    });
    const { handler } = loadModule({
      SUPABASE_URL: projectUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRolePlaceholder,
    });

    const responses = await Promise.all(Array.from({ length: 25 }, () => handler(event)));

    responses.forEach(expectUnavailableResponse);
    expect(requestRead).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});
