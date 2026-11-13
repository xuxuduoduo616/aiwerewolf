#!/usr/bin/env node
// --- START OF FILE scripts/replay-to-benchmark.mjs ---
//
// H2-C: turn local anonymous replay fixtures into benchmark records with the
// deterministic offline runner in `src/ai/evaluation.ts`, and check the
// repository against the golden table plus the published thresholds.
//
//   node scripts/replay-to-benchmark.mjs <a.replay.json>...   # JSON to stdout
//   node scripts/replay-to-benchmark.mjs --check              # CI-style gate
//
// Zero network, zero external model calls: the only provider is
// `createMockProvider()` from `evaluation.ts`, and the speech/action script is
// the recorded replay itself. Same fixture bytes → same output bytes: no
// timestamps, no random ids, no absolute paths.
//
// The script imports the TypeScript benchmark modules through Vite's SSR module
// loader (`vite` is already a devDependency; Vite 5 supports the project's
// Node.js 20 baseline). No build step, no Node 22-only API and no extra
// dependency is required. The loader only starts when the CLI actually needs
// the modules, so importing this file from a Vitest test stays side-effect free.

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/**
 * Load `benchmarkFixtures.ts` / `benchmark.ts` through Vite SSR. The server is
 * middleware-only and `server.ws: false` disables Vite's HMR WebSocket server,
 * so the process never listens on a port (verified by the listen guard test).
 * The caller closes the server.
 *
 * Vite's SSR module runner understands TS, extensionless relative imports and
 * `import.meta.url`, and it preserves the modules' file URLs, so the fixture
 * directory default still resolves to this checkout. Nothing is bundled into
 * the repository: the cache lives in the OS temp directory.
 */
export const loadBenchmarkModules = async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    appType: 'custom',
    logLevel: 'error',
    cacheDir: path.join(os.tmpdir(), 'dsh-h2c-vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const fixtures = await server.ssrLoadModule('/src/ai/benchmarkFixtures.ts');
    const benchmark = await server.ssrLoadModule('/src/ai/benchmark.ts');
    return { fixtures, benchmark, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
};

/** Stable stdout format: 2-space JSON, one trailing newline. */
export const formatBenchmarkResults = results =>
  `${JSON.stringify(results, null, 2)}\n`;

const describeValue = value => JSON.stringify(value);

/**
 * Field-by-field diff that ignores key order (the golden table is hand-written,
 * the converter's key order is fixed). Returns human-readable differences.
 */
export const compareBenchmarkResults = (actual, expected) => {
  const differences = [];
  if (!actual || typeof actual !== 'object') return ['actual result is not an object'];
  for (const key of Object.keys(expected)) {
    if (!(key in actual)) {
      differences.push(`missing field "${key}"`);
    } else if (actual[key] !== expected[key]) {
      differences.push(`"${key}": expected ${describeValue(expected[key])}, got ${describeValue(actual[key])}`);
    }
  }
  for (const key of Object.keys(actual)) {
    if (!(key in expected)) differences.push(`unexpected field "${key}"`);
  }
  return differences;
};

/**
 * Gate used by `--check` and by the Vitest suite. `fixtures` are the loaded
 * benchmark fixtures, `formatted` their serialized stdout, `secondFormatted`
 * the serialization of an independent second conversion.
 */
export const checkBenchmarkFixtures = ({
  fixtures,
  formatted,
  secondFormatted,
  expected,
  benchmark,
  repoRoot = REPO_ROOT,
}) => {
  const problems = [];
  const notes = [];

  if (fixtures.length < 3) {
    problems.push(`need at least 3 fixtures, found ${fixtures.length}`);
  }
  const boardIds = new Set(fixtures.map(fixture => fixture.replay.boardId));
  if (!boardIds.has('9-standard')) problems.push('missing a 9-standard fixture');
  if (!boardIds.has('12-standard')) problems.push('missing a 12-standard fixture');
  if (fixtures.length !== Object.keys(expected).length) {
    problems.push(`fixture count ${fixtures.length} does not match the golden table (${Object.keys(expected).length})`);
  }

  for (const fixture of fixtures) {
    const actual = fixture.result;
    const expectation = expected[fixture.id];
    const fixtureProblems = [];
    if (!expectation) {
      fixtureProblems.push('no expected benchmark result in EXPECTED_BENCHMARK_RESULTS');
    } else {
      fixtureProblems.push(...compareBenchmarkResults(actual, expectation));
    }
    if (!benchmark.isValidBenchmarkResult(actual)) {
      fixtureProblems.push('result violates isValidBenchmarkResult');
    }
    if (typeof actual.infoLeakageRate !== 'number') {
      fixtureProblems.push('infoLeakageRate is missing');
    }
    fixtureProblems.push(...benchmark.benchmarkThresholdViolations(actual).map(violation => `threshold: ${violation}`));
    problems.push(...fixtureProblems.map(problem => `${fixture.id}: ${problem}`));
    notes.push(`${fixture.id} (${fixture.replay.boardId}): ${fixtureProblems.length === 0 ? 'OK' : 'FAIL'}`);
  }

  for (const id of Object.keys(expected)) {
    if (!fixtures.some(fixture => fixture.id === id)) {
      problems.push(`expected fixture ${id} is missing from the fixture directory`);
    }
  }

  if (formatted !== secondFormatted) {
    problems.push('benchmark output is not byte-stable across two conversions');
  }
  if (formatted.includes(repoRoot)) {
    problems.push('benchmark output contains an absolute repository path');
  }
  if (formatted.includes(path.join(repoRoot, 'src'))) {
    problems.push('benchmark output contains an absolute source path');
  }
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(formatted)) {
    problems.push('benchmark output contains a timestamp');
  }

  return { ok: problems.length === 0, problems, notes };
};

const isCliEntry = () => {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(path.resolve(entry)).href : false;
};

const main = async () => {
  const args = process.argv.slice(2);
  const fixturesIndex = args.indexOf('--fixtures');
  const fixtureDir = fixturesIndex >= 0 ? args[fixturesIndex + 1] : undefined;
  const fixturesValueIndex = fixturesIndex >= 0 ? fixturesIndex + 1 : -1;
  const check = args.includes('--check');
  const fileArgs = args.filter((arg, index) =>
    !arg.startsWith('--') && index !== fixturesValueIndex);

  if (!check && fileArgs.length === 0) {
    console.error('Usage: node scripts/replay-to-benchmark.mjs --check [--fixtures <dir>]');
    console.error('       node scripts/replay-to-benchmark.mjs <replay.json>...');
    process.exitCode = 2;
    return;
  }

  const { fixtures, benchmark, close } = await loadBenchmarkModules();
  try {
    if (check) {
      const first = fixtures.loadBenchmarkFixtures(fixtureDir);
      const second = fixtures.loadBenchmarkFixtures(fixtureDir);
      const formatted = formatBenchmarkResults(first.map(fixture => fixture.result));
      const secondFormatted = formatBenchmarkResults(second.map(fixture => fixture.result));
      const outcome = checkBenchmarkFixtures({
        fixtures: first,
        formatted,
        secondFormatted,
        expected: fixtures.EXPECTED_BENCHMARK_RESULTS,
        benchmark,
      });
      for (const note of outcome.notes) console.log(note);
      if (!outcome.ok) {
        for (const problem of outcome.problems) console.error(`- ${problem}`);
        console.error('benchmark check: FAIL');
        process.exitCode = 1;
        return;
      }
      console.log(`benchmark check: PASS (${first.length} fixtures, golden values and thresholds match, output stable)`);
      return;
    }

    const results = fileArgs
      .slice()
      .sort()
      .map(file => {
        const baseName = path.basename(file);
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        const replay = fixtures.parseReplayFixture(parsed, baseName);
        const fixtureId = baseName.endsWith(fixtures.FIXTURE_FILE_SUFFIX)
          ? baseName.slice(0, -fixtures.FIXTURE_FILE_SUFFIX.length)
          : path.basename(baseName, path.extname(baseName));
        return fixtures.buildBenchmarkFromReplay(replay, fixtureId).result;
      });
    process.stdout.write(formatBenchmarkResults(results));
  } finally {
    await close();
  }
};

if (isCliEntry()) {
  main().catch(error => {
    console.error(`benchmark conversion failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}

// --- END OF FILE scripts/replay-to-benchmark.mjs ---
