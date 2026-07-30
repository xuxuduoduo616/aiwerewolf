// Unit tests for the pure report-formatting function of provider-dry-run.mjs.
// No live calls, no filesystem access, no network — formatter in, markdown out.
import { describe, expect, it, vi } from 'vitest';
import { formatReport, redactForReport } from './provider-dry-run.mjs';
import {
  OPENAI_GATEWAY_SLUGS,
  OPENAI_MODEL_IDS,
  probeAIModelUpstreams,
} from './openai-model-preflight.mjs';

const baseMeta = {
  date: '2026-07-16T00:00:00.000Z',
  mode: 'dry-run only (zero network)',
  networkViolations: [],
};

const passingEntry = {
  provider: 'gemini-2.5-flash',
  protocol: 'gemini',
  model: 'gemini-2.5-flash',
  dryRun: { ok: true, detail: 'model_used=gemini-2.5-flash, cost_estimate=0.000001, fallback_used=false' },
  probe: { status: 'skipped', detail: 'LIVE_PROBE not set' },
};

describe('formatReport', () => {
  it('renders date, mode, and one table row per entry', () => {
    const secondEntry = {
      provider: 'deepseek-anthropic',
      protocol: 'anthropic-messages',
      model: 'deepseek-chat',
      dryRun: { ok: true, detail: 'model_used=deepseek-anthropic, cost_estimate=0, fallback_used=false' },
      probe: { status: 'skipped', detail: 'no key (DEEPSEEK_API_KEY not set)' },
    };
    const markdown = formatReport([passingEntry, secondEntry], baseMeta);
    expect(markdown).toContain('- Date: 2026-07-16T00:00:00.000Z');
    expect(markdown).toContain('- Mode: dry-run only (zero network)');
    expect(markdown).toContain('| Provider | Protocol | Model | Dry-run | Live probe |');
    expect(markdown).toContain('| gemini-2.5-flash | gemini | gemini-2.5-flash | PASS');
    expect(markdown).toContain('| deepseek-anthropic | anthropic-messages | deepseek-chat | PASS');
    expect(markdown).toContain('skipped — no key (DEEPSEEK_API_KEY not set)');
  });

  it('reports "none" under open issues when everything passes', () => {
    const markdown = formatReport([passingEntry], baseMeta);
    expect(markdown).toContain('## Open issues');
    expect(markdown).toContain('- none');
  });

  it('lists dry-run failures, probe failures, and guard violations as open issues', () => {
    const failingEntry = {
      provider: 'aicodemirror-claude',
      protocol: 'anthropic-messages',
      model: 'claude-sonnet-4-6',
      dryRun: { ok: false, detail: 'statusCode=500 (expected 200)' },
      probe: { status: 'failed', detail: 'HTTP 401 (auth, key: AICODEMIRROR_API_KEY)' },
    };
    const markdown = formatReport([failingEntry], {
      ...baseMeta,
      networkViolations: ['fetch(https://example.com)'],
    });
    expect(markdown).toContain('- aicodemirror-claude: dry-run FAIL — statusCode=500 (expected 200)');
    expect(markdown).toContain('- aicodemirror-claude: probe failed — HTTP 401 (auth, key: AICODEMIRROR_API_KEY)');
    expect(markdown).toContain('- dry-run guard violation: fetch(https://example.com)');
    expect(markdown).not.toContain('- none');
  });

  it('redacts Bearer tokens and header values leaked into detail strings', () => {
    const leakyEntry = {
      provider: 'deepseek-openai',
      protocol: 'openai-chat',
      model: 'deepseek-chat',
      dryRun: { ok: false, detail: 'upstream said Authorization: Bearer sk-super-secret-token' },
      probe: { status: 'failed', detail: "x-api-key: 'sk-another-secret' rejected" },
    };
    const markdown = formatReport([leakyEntry], baseMeta);
    expect(markdown).not.toContain('sk-super-secret-token');
    expect(markdown).not.toContain('sk-another-secret');
    expect(markdown).toContain('Authorization: [REDACTED]');
    expect(markdown).toContain("x-api-key: [REDACTED]");
  });

  it('escapes pipe characters so details cannot break the table', () => {
    const pipeEntry = {
      ...passingEntry,
      dryRun: { ok: false, detail: 'weird|detail' },
    };
    const markdown = formatReport([pipeEntry], baseMeta);
    expect(markdown).toContain('weird\\|detail');
  });

  it('is deterministic for identical input (pure function)', () => {
    const first = formatReport([passingEntry], baseMeta);
    const second = formatReport([passingEntry], baseMeta);
    expect(first).toBe(second);
  });
});

describe('redactForReport', () => {
  it('strips Bearer values and authorization/x-api-key header values', () => {
    expect(redactForReport('Bearer abc123')).toBe('Bearer [REDACTED]');
    expect(redactForReport('authorization: abc123')).toBe('authorization: [REDACTED]');
    expect(redactForReport('x-api-key=abc123')).toBe('x-api-key=[REDACTED]');
  });

  it('leaves non-sensitive text untouched', () => {
    expect(redactForReport('HTTP 401 (auth)')).toBe('HTTP 401 (auth)');
  });
});

describe('OpenAI model preflight', () => {
  it('direct OpenAI is GET-only and succeeds only when both exact IDs are returned', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init]);
      const model = decodeURIComponent(String(url).split('/').pop());
      return { ok: true, status: 200, json: async () => ({ id: model }) };
    };
    const result = await probeAIModelUpstreams({
      openAIKey: 'fake-openai-key-for-tests-only',
      gatewayKey: '',
      fetchImpl,
      timeoutMs: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.selectedUpstream).toBe('direct');
    expect(result.upstreams.direct.results.map(({ model }) => model)).toEqual(Array.from(OPENAI_MODEL_IDS));
    expect(calls).toHaveLength(2);
    for (const [url, init] of calls) {
      expect(url).toMatch(/^https:\/\/api\.openai\.com\/v1\/models\/gpt-5\./);
      expect(init.method).toBe('GET');
      expect(init).not.toHaveProperty('body');
    }
  });

  it('Gateway is GET-only, atomically proves both slugs, and is preferred', async () => {
    const calls = [];
    const result = await probeAIModelUpstreams({
      openAIKey: '',
      gatewayKey: 'fake-ai-gateway-key-for-tests-only',
      fetchImpl: async (url, init) => {
        calls.push([url, init]);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: Object.values(OPENAI_GATEWAY_SLUGS).map((id) => ({ id })) }),
        };
      },
      timeoutMs: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.selectedUpstream).toBe('gateway');
    expect(result.upstreams.gateway.results.every(({ status }) => status === 'ok')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('https://ai-gateway.vercel.sh/v1/models');
    expect(calls[0][1].method).toBe('GET');
    expect(calls[0][1]).not.toHaveProperty('body');
  });

  it('selects Gateway when direct access fails but both Gateway slugs are proven', async () => {
    const calls = [];
    const result = await probeAIModelUpstreams({
      openAIKey: 'fake-invalid-openai-key-for-tests-only',
      gatewayKey: 'fake-ai-gateway-key-for-tests-only',
      fetchImpl: async (url, init) => {
        calls.push([url, init]);
        if (url === 'https://ai-gateway.vercel.sh/v1/models') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: Object.values(OPENAI_GATEWAY_SLUGS).map((id) => ({ id })) }),
          };
        }
        return { ok: false, status: 401, json: async () => { throw new Error('body not read'); } };
      },
      timeoutMs: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.selectedUpstream).toBe('gateway');
    expect(result.upstreams.direct.results.every(({ reason }) => reason === 'auth')).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls.every(([, init]) => init.method === 'GET' && !('body' in init))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('fake-invalid-openai-key-for-tests-only');
    expect(JSON.stringify(result)).not.toContain('fake-ai-gateway-key-for-tests-only');
  });

  it('fails Gateway atomically when either exact slug is missing', async () => {
    const result = await probeAIModelUpstreams({
      openAIKey: '',
      gatewayKey: 'fake-ai-gateway-key-for-tests-only',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: OPENAI_GATEWAY_SLUGS['gpt-5.5'] }] }),
      }),
      timeoutMs: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.selectedUpstream).toBeNull();
    expect(result.upstreams.gateway.results).toEqual([
      { upstream: 'gateway', model: 'gpt-5.5', status: 'ok', reason: 'exact-gateway-slug' },
      { upstream: 'gateway', model: 'gpt-5.6-luna', status: 'failed', reason: 'model-id-mismatch' },
    ]);
  });

  it('does no network work without either key and returns only safe status classes', async () => {
    const fetchImpl = vi.fn();
    const missing = await probeAIModelUpstreams({ openAIKey: '', gatewayKey: '', fetchImpl });
    expect(missing.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(missing.upstreams.direct.results.every(({ reason }) => reason === 'missing-key')).toBe(true);
    expect(missing.upstreams.gateway.results.every(({ reason }) => reason === 'missing-key')).toBe(true);

    const denied = await probeAIModelUpstreams({
      openAIKey: 'fake-openai-key-for-tests-only',
      gatewayKey: 'fake-ai-gateway-key-for-tests-only',
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => {
          throw new Error('upstream body must not be read');
        },
      }),
      timeoutMs: 100,
    });
    expect(denied.ok).toBe(false);
    expect(denied.upstreams.direct.results.every(({ reason }) => reason === 'auth')).toBe(true);
    expect(denied.upstreams.gateway.results.every(({ reason }) => reason === 'auth')).toBe(true);
    expect(JSON.stringify(denied)).not.toContain('fake-openai-key-for-tests-only');
    expect(JSON.stringify(denied)).not.toContain('fake-ai-gateway-key-for-tests-only');
  });
});
