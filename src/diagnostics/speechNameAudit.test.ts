/**
 * Env-gated speech-name audit (card: ai-speech-name-detection-harness).
 *
 * Run:  SPEECH_NAME_AUDIT=1 npx vitest run src/diagnostics/
 *       (wired as `npm run audit:speech-names`)
 *
 * This audit MUST FAIL on the current codebase — it reproduces the
 * wrong-player-name bug with violation count > 0. The follow-up fix card
 * (`ai-speech-roster-name-fix`) must turn this exact command green.
 * Without SPEECH_NAME_AUDIT the whole suite is skipped so the default
 * `npm run test:run` stays green.
 *
 * Offline guarantees: global fetch is stubbed (blocked or mocked — zero
 * network, zero paid calls) and Math.random is seeded (mulberry32 via
 * vi.spyOn), so violation counts are identical across runs.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamePhase, type GameLog } from '../types';
import { generateAIDialogue } from '../ai/aiOrchestrator';
import { globalBeliefTracker } from '../ai/beliefTracker';
import { clearTranslationCache, translateLogText } from '../services/translationService';
import { AUDIT_SEED, makeAuditRoster, mulberry32 } from './fixtures';
import { detectTranslationReferentDrift } from './nameDetector';
import {
  runSpeechAudit,
  rosterSummary,
  sanitizePrompt,
  type AuditResult,
  type AuditSample,
  type CapturedRequest,
} from './speechAuditHarness';

const AUDIT_ENABLED = Boolean(process.env.SPEECH_NAME_AUDIT);

const SAMPLES_DIR = join(
  process.cwd(),
  'memory/coordination/reports/ai-speech-name-detection-harness-samples',
);

// ─── fetch stubs (zero network) ──────────────────────────────────────────────

const promptOf = (body?: string): string => {
  try {
    return typeof body === 'string' ? (JSON.parse(body).prompt ?? '') : '';
  } catch {
    return '';
  }
};

/** Every request is captured then rejected — deterministic LLM failure. */
const installBlockedFetch = (sink: CapturedRequest[]): void => {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    sink.push({ url: String(url), prompt: promptOf(init?.body) });
    throw new TypeError('SPEECH_NAME_AUDIT: network blocked (offline audit)');
  }));
};

// Mocked "LLM success" payloads. The polluted references (Agent[XX], corpus
// names, seat 10 in a 9p game) simulate exactly the classes of text the raw
// corpus/context can push through the remote path; the audit checks whether
// ANY roster guard exists between the model response and the displayed text.
const REMOTE_DAY_SPEECH = {
  zh: '我觉得Agent[05]和サクラ都很可疑，10号昨天的票型也有问题，今天建议先集中投他们。',
  en: 'I think Agent[05] and Sakura are both acting suspicious, and Player 10 voted strangely yesterday, so the village should focus its vote on those seats today.',
};
const REMOTE_WOLF_MESSAGES = JSON.stringify({
  messages: [
    { speakerId: 2, message: '今晚刀サクラ，明天我悍跳预言家。', strategyTag: '刀口' },
    { speakerId: 3, message: '把嫌疑推给Agent[03]那个位置。', strategyTag: '倒钩' },
    { speakerId: 4, message: '注意10号，别让好人聚焦我们。', strategyTag: '补位' },
  ],
});
const REMOTE_VOTE_ACTION = JSON.stringify({ targetId: 5, reason: 'サクラ和Agent[02]的发言都指向5号' });

/** Success stub: routes by prompt shape to speech / wolf-chat / action payloads. */
const installSuccessFetch = (sink: CapturedRequest[]): void => {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    const prompt = promptOf(init?.body);
    sink.push({ url: String(url), prompt });
    let text: string;
    if (prompt.includes('狼队：') || prompt.includes('Wolf team:')) {
      text = JSON.stringify({ zh: REMOTE_WOLF_MESSAGES, en: 'ok' });
    } else if (prompt.includes('行动：VOTE')) {
      text = REMOTE_VOTE_ACTION;
    } else {
      text = JSON.stringify(REMOTE_DAY_SPEECH);
    }
    return { ok: true, json: async () => ({ text }) };
  }));
};

// ─── sample collection for the report ────────────────────────────────────────

const reportSamples: Array<AuditSample & { note?: string }> = [];

const collectSamples = (result: AuditResult, label: string): void => {
  const byContext = new Map<string, AuditSample[]>();
  for (const sample of result.samples) {
    const list = byContext.get(sample.context) ?? [];
    list.push(sample);
    byContext.set(sample.context, list);
  }
  for (const [context, samples] of byContext) {
    const violating = samples.filter(s => s.violations.length > 0).slice(0, 3);
    if (violating.length > 0) {
      for (const sample of violating) {
        reportSamples.push({ ...sample, id: `${label}-${sample.id}` });
      }
    } else {
      // Document contexts that produced no violation on this path.
      const clean = samples[0];
      reportSamples.push({
        ...clean,
        id: `${label}-${clean.id}`,
        note: `no violations detected in the ${context} context on the ${label} path`,
      });
    }
  }
};

const summarize = (result: AuditResult): string =>
  `texts=${result.totalTexts} violations=${result.totalViolations} ` +
  `byKind=${JSON.stringify(result.violationsByKind)} ` +
  `byContext=${JSON.stringify(result.violationsByContext)} ` +
  `bySource=${JSON.stringify(result.violationsBySource)}`;

// ─── the audit ───────────────────────────────────────────────────────────────

describe.skipIf(!AUDIT_ENABLED)('speech-name audit (SPEECH_NAME_AUDIT=1) — must FAIL pre-fix', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(AUDIT_SEED));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    // Persist sanitized failure samples for the report (deterministic content).
    mkdirSync(SAMPLES_DIR, { recursive: true });
    const index: string[] = [
      '# Speech-name audit — sanitized failure samples',
      '',
      'Generated by `npm run audit:speech-names` (offline, seeded, zero network).',
      'Fields: roster, speaker, phase, sanitized prompt, raw response, translated',
      'response, final text, source. No secrets: prompts are client-side only and',
      'pass through `sanitizePrompt` redaction.',
      '',
      '| file | context | source | violations |',
      '| --- | --- | --- | --- |',
    ];
    reportSamples.forEach((sample, i) => {
      const file = `sample-${String(i + 1).padStart(2, '0')}.json`;
      writeFileSync(join(SAMPLES_DIR, file), `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
      index.push(`| ${file} | ${sample.context} | ${sample.source} | ${sample.violations.length} |`);
    });
    index.push('');
    writeFileSync(join(SAMPLES_DIR, 'index.md'), index.join('\n'), 'utf8');
  });

  it('fallback-dominant path (LLM blocked): every generated text references only the current roster', async () => {
    const sink: CapturedRequest[] = [];
    installBlockedFetch(sink);

    const result = await runSpeechAudit({ capturedRequests: sink, llmSucceeds: false });
    console.log(`[speech-name-audit] fallback-dominant: ${summarize(result)}`);
    collectSamples(result, 'fallback');

    expect(result.totalTexts).toBeGreaterThanOrEqual(100);
    expect(
      result.totalViolations,
      `Out-of-roster references in generated speech (fallback-dominant path): ${summarize(result)}`,
    ).toBe(0);
  });

  it('is deterministic: two seeded runs produce identical violation counts', async () => {
    const runOnce = async (): Promise<AuditResult> => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(AUDIT_SEED));
      const sink: CapturedRequest[] = [];
      installBlockedFetch(sink);
      return runSpeechAudit({ capturedRequests: sink, llmSucceeds: false });
    };

    const first = await runOnce();
    const second = await runOnce();
    expect(second.totalTexts).toBe(first.totalTexts);
    expect(second.totalViolations).toBe(first.totalViolations);
    expect(second.violationsByKind).toEqual(first.violationsByKind);
    expect(second.violationsByContext).toEqual(first.violationsByContext);
    expect(second.samples.map(s => s.finalText)).toEqual(first.samples.map(s => s.finalText));
  });

  it('LLM prompts contain no AIWolf entities (recent-speech context is injected un-sanitized)', async () => {
    const sink: CapturedRequest[] = [];
    installBlockedFetch(sink);
    const roster = makeAuditRoster();
    globalBeliefTracker.init(roster);

    // A prior library speech (raw corpus text) sitting in the game log — the
    // production log is exactly where un-sanitized corpus picks end up.
    const logs: GameLog[] = [{
      id: 'audit-log-corpus',
      phase: GamePhase.DAY_DISCUSSION,
      speakerId: 2,
      message: '僕はAgent[04]、ハルの質問に答えるなら、占い師COはまだしないかな。サクラさんはどう思う？',
      isSystem: false,
      tone: 'speech',
    }];

    await generateAIDialogue(
      roster[0], roster, logs, GamePhase.DAY_DISCUSSION, [], 2, null, [],
      { wolfKillId: null, witchPoisonId: null, witchSaved: false }, 'zh',
    );

    const prompt = sanitizePrompt(sink[0]?.prompt ?? '');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt, 'un-sanitized corpus text reaches the LLM prompt via fmtLogs').not.toContain('Agent[04]');
    expect(prompt, 'un-sanitized corpus name reaches the LLM prompt via fmtLogs').not.toContain('サクラ');
  });

  it('remote-model path (mocked success): responses are roster-guarded before display', async () => {
    const sink: CapturedRequest[] = [];
    installSuccessFetch(sink);

    const result = await runSpeechAudit({
      capturedRequests: sink,
      llmSucceeds: true,
      dayRounds: 1,
      voteRounds: 1,
      wolfChatRounds: 1,
    });
    console.log(`[speech-name-audit] remote-success: ${summarize(result)}`);
    collectSamples(result, 'remote');

    expect(
      result.totalViolations,
      `Un-guarded remote-model text reached final speech: ${summarize(result)}`,
    ).toBe(0);
  });

  it('translation layer preserves player referents (mocked translation response)', async () => {
    clearTranslationCache();
    const roster = makeAuditRoster();
    const source = '我怀疑3号，今天投3号。';
    // A referent-rewriting translation — the service must reject or fix it.
    const translated_payload = 'I suspect Player 5 today — Sakura keeps lying about Agent[03].';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: translated_payload }),
    })));

    const translated = await translateLogText('audit-translation-1', source, 'en');
    const drift = detectTranslationReferentDrift(source, translated, roster);

    reportSamples.push({
      id: 'translation-audit-translation-1',
      context: 'day-speech',
      language: 'en',
      speakerId: 8,
      speakerName: roster[7].name,
      phase: GamePhase.DAY_DISCUSSION,
      round: 1,
      roster: rosterSummary(roster),
      prompt: 'Translate the following Werewolf (social deduction game) speech into English. [translationService.ts:92 — prompt has no roster list]',
      rawResponse: translated_payload,
      translatedResponse: translated,
      finalText: translated,
      source: 'remote-model',
      violations: drift,
    });

    expect(
      drift,
      'translation changed player referents and no layer caught it',
    ).toHaveLength(0);
  });
});
