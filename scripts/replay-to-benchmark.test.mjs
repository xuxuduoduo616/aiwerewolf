import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { benchmarkThresholdViolations, isValidBenchmarkResult } from '../src/ai/benchmark';
import {
  EXPECTED_BENCHMARK_RESULTS,
  loadBenchmarkFixtures,
} from '../src/ai/benchmarkFixtures';
import {
  checkBenchmarkFixtures,
  compareBenchmarkResults,
  formatBenchmarkResults,
} from './replay-to-benchmark.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./replay-to-benchmark.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'src', 'ai', '__fixtures__', 'replays');

// Preload that records every `net.Server.listen()` call. Vite's HMR WebSocket
// server would trip this guard; the benchmark CLI must never listen on a port.
const LISTEN_GUARD_SOURCE = `
const net = require('node:net');
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  console.error('[NET-GUARD] listen', JSON.stringify(args.map(arg => (typeof arg === 'object' ? '[object]' : arg))));
  return originalListen.apply(this, args);
};
`;
const benchmarkModule = { isValidBenchmarkResult, benchmarkThresholdViolations };
const fixtures = loadBenchmarkFixtures();
const results = fixtures.map(fixture => fixture.result);
const formatted = formatBenchmarkResults(results);

const runCli = args =>
  execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });

describe('replay-to-benchmark formatting', () => {
  it('serializes results deterministically with the documented field order', () => {
    const first = formatBenchmarkResults(results);
    const second = formatBenchmarkResults(results);
    expect(second).toBe(first);
    expect(first.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(first);
    expect(Object.keys(parsed[0])).toEqual([
      'gameId',
      'dataVersion',
      'method',
      'roleConsistencyScore',
      'illegalActionRate',
      'voteRationalityScore',
      'speechRepetitionRate',
      'estimatedCostUSD',
      'evalSet',
      'notes',
      'infoLeakageRate',
    ]);
    expect(first).not.toContain(REPO_ROOT);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(first).not.toContain('undefined');
  });

  it('compares golden values field-by-field and reports drift', () => {
    const golden = EXPECTED_BENCHMARK_RESULTS[fixtures[0].id];
    expect(compareBenchmarkResults(fixtures[0].result, golden)).toEqual([]);

    const drifted = { ...fixtures[0].result, voteRationalityScore: 0.5 };
    expect(compareBenchmarkResults(drifted, golden).join('\n')).toContain('voteRationalityScore');

    const missingField = { ...fixtures[0].result };
    delete missingField.notes;
    expect(compareBenchmarkResults(missingField, golden).join('\n')).toContain('missing field "notes"');

    expect(compareBenchmarkResults({ ...fixtures[0].result, extra: 1 }, golden).join('\n'))
      .toContain('unexpected field "extra"');
  });
});

describe('replay-to-benchmark check gate', () => {
  it('passes on the committed fixtures and golden table', () => {
    const outcome = checkBenchmarkFixtures({
      fixtures,
      formatted,
      secondFormatted: formatBenchmarkResults(results.map(result => ({ ...result }))),
      expected: EXPECTED_BENCHMARK_RESULTS,
      benchmark: benchmarkModule,
    });
    expect(outcome.problems).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.notes).toHaveLength(fixtures.length);
  });

  it('fails when a golden value or a threshold is violated', () => {
    const driftedFixtures = fixtures.map((fixture, index) => (
      index === 0
        ? { ...fixture, result: { ...fixture.result, illegalActionRate: 0.5 } }
        : fixture
    ));
    const driftedFormatted = formatBenchmarkResults(driftedFixtures.map(fixture => fixture.result));
    const outcome = checkBenchmarkFixtures({
      fixtures: driftedFixtures,
      formatted: driftedFormatted,
      secondFormatted: driftedFormatted,
      expected: EXPECTED_BENCHMARK_RESULTS,
      benchmark: benchmarkModule,
    });
    expect(outcome.ok).toBe(false);
    const problems = outcome.problems.join('\n');
    expect(problems).toContain('illegalActionRate');
    expect(problems).toContain('threshold');
    expect(outcome.notes[0]).toContain('FAIL');
  });

  it('fails when the second conversion is not byte-identical or leaks an absolute path', () => {
    const outcome = checkBenchmarkFixtures({
      fixtures,
      formatted,
      secondFormatted: `${formatted} `,
      expected: EXPECTED_BENCHMARK_RESULTS,
      benchmark: benchmarkModule,
      repoRoot: REPO_ROOT,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.problems.join('\n')).toContain('byte-stable');
  });
});

describe('replay-to-benchmark CLI', () => {
  it('--check exits zero and reports the committed fixture set', () => {
    const stdout = runCli(['--check']);
    expect(stdout).toContain('local-12p-001 (12-standard): OK');
    expect(stdout).toContain('local-9p-001 (9-standard): OK');
    expect(stdout).toContain('local-9p-002 (9-standard): OK');
    expect(stdout).toContain('benchmark check: PASS');
  });

  it('converts fixture paths to JSON matching the golden table', () => {
    const paths = fixtures.map(fixture => path.join(FIXTURES_DIR, fixture.fileName));
    const stdout = runCli(paths);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveLength(fixtures.length);
    for (const result of parsed) {
      expect(result).toEqual(EXPECTED_BENCHMARK_RESULTS[result.gameId]);
    }
  });
});

describe('replay-to-benchmark network isolation', () => {
  it('--check never listens on a TCP port (Vite ws server disabled)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'h2c-listen-guard-'));
    const guardPath = path.join(dir, 'guard.cjs');
    writeFileSync(guardPath, LISTEN_GUARD_SOURCE);
    try {
      const result = spawnSync(process.execPath, ['--require', guardPath, SCRIPT_PATH, '--check'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('benchmark check: PASS');
      expect(result.stderr).not.toContain('[NET-GUARD] listen');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
