#!/usr/bin/env node
// --- START OF FILE scripts/ai-decision-eval.mjs ---
//
// Deterministic offline CLI for the AI Decision Paired Benchmark (P1–P9).
//
//   node scripts/ai-decision-eval.mjs             # Markdown summary report
//   node scripts/ai-decision-eval.mjs --json      # JSON report to stdout
//   node scripts/ai-decision-eval.mjs --check     # CI-style gate (exit 0 on PASS)
//
// Zero network, zero external model calls. Uses Vite's middleware-only SSR
// module loader (`server.ws: false`) so the process never listens on a port.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/**
 * Load `src/ai/pairedBenchmark.ts` through Vite SSR without opening a socket.
 */
export const loadPairedBenchmarkModule = async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    appType: 'custom',
    logLevel: 'error',
    cacheDir: path.join(os.tmpdir(), 'aiwerewolf-p2a-vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const paired = await server.ssrLoadModule('/src/ai/pairedBenchmark.ts');
    return { paired, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
};

export const runPairedCheck = async (paired, casesPath) => {
  const dataset = paired.loadPairedCases(casesPath);
  const first = await paired.runPairedBenchmark(dataset);
  const second = await paired.runPairedBenchmark(dataset);
  const outcome = paired.checkPairedBenchmarkReport(first, second);
  const deterministicJson = paired.formatPairedBenchmarkJson(first, { deterministic: true });
  const problems = [...outcome.problems];
  if (deterministicJson.includes(REPO_ROOT)) {
    problems.push('deterministic paired benchmark output contains an absolute repository path');
  }
  return {
    ok: problems.length === 0,
    problems,
    notes: outcome.notes,
    report: first,
  };
};

const isCliEntry = () => {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(path.resolve(entry)).href : false;
};

const main = async () => {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const json = args.includes('--json');
  const deterministic = args.includes('--deterministic');
  const casesIndex = args.indexOf('--cases');
  const casesPath = casesIndex >= 0 ? args[casesIndex + 1] : undefined;

  const { paired, close } = await loadPairedBenchmarkModule();
  try {
    if (check) {
      const result = await runPairedCheck(paired, casesPath);
      for (const note of result.notes) console.log(note);
      if (!result.ok) {
        for (const problem of result.problems) console.error(`- ${problem}`);
        console.error('ai-decision-eval check: FAIL');
        process.exitCode = 1;
        return;
      }
      const { summary } = result.report;
      console.log(
        `ai-decision-eval check: PASS (${summary.casesPassed}/${summary.casesTotal} paired cases, `
        + `sensitivity=${summary.evidenceSensitivityRate}, illegal=${summary.illegalActionRate}, `
        + `unauthorized=${summary.unauthorizedInfoReadRate}, fallback=${summary.fallbackRate}, `
        + `uniformity=${summary.tieBreakUniformity}, stable)`,
      );
      return;
    }

    const dataset = paired.loadPairedCases(casesPath);
    const report = await paired.runPairedBenchmark(dataset);
    if (json) {
      process.stdout.write(paired.formatPairedBenchmarkJson(report, { deterministic }));
      return;
    }
    process.stdout.write(paired.formatPairedBenchmarkMarkdown(report));
  } finally {
    await close();
  }
};

if (isCliEntry()) {
  main().catch(error => {
    console.error(`ai-decision-eval failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}

// --- END OF FILE scripts/ai-decision-eval.mjs ---
