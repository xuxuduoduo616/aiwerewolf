// Unit tests for the pure report-formatting function of provider-dry-run.mjs.
// No live calls, no filesystem access, no network — formatter in, markdown out.
import { describe, expect, it } from 'vitest';
import { formatReport, redactForReport } from './provider-dry-run.mjs';

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
