/**
 * Diagnostics — offline speech-generation audit harness.
 *
 * DIAGNOSIS ONLY (card: ai-speech-name-detection-harness). Drives the REAL
 * production pipeline functions (`generateAIDialogue`, `generateWolfChat`,
 * the vote-reason path of `generateAIAction`) against the fixed 9p roster
 * fixture. The calling test controls the environment:
 *
 *   - global `fetch` is stubbed (blocked → deterministic LLM failure, the
 *     production-dominant path pre-2026-07-17; or a mocked success payload
 *     for the remote-path audit) — ZERO network, zero paid calls;
 *   - `Math.random` is seeded (mulberry32 via vi.spyOn) so speech-library
 *     picks and selector randomness are reproducible.
 *
 * The harness itself is pure orchestration + detection bookkeeping.
 */

import { GamePhase, type GameLog, type NightState, type Player } from '../types';
import type { DisplayLanguage } from '../i18n';
import { generateAIAction, generateAIDialogue, generateWolfChat, setAIDifficulty } from '../ai/aiOrchestrator';
import { globalBeliefTracker } from '../ai/beliefTracker';
import { detectNameViolations, type NameViolation } from './nameDetector';
import { makeAuditRoster } from './fixtures';

export type SpeechContext = 'day-speech' | 'last-words' | 'wolf-chat' | 'vote-reason';

export type SpeechSource =
  | 'remote-model'
  | 'library'
  | 'hardcoded-fallback'
  | 'selector-reason'
  | 'random-fallback';

/** One entry per fetch attempt, recorded by the test's fetch stub. */
export interface CapturedRequest {
  url: string;
  /** The prompt string sent to the LLM endpoint ('' when absent). */
  prompt: string;
}

export interface AuditSample {
  id: string;
  context: SpeechContext;
  language: DisplayLanguage;
  speakerId: number;
  speakerName: string;
  phase: string;
  round: number;
  roster: string;
  /** Sanitized prompt captured from the (blocked or mocked) fetch. */
  prompt: string;
  /** Raw LLM-layer response ('' on the blocked/failure path). */
  rawResponse: string;
  /** Translated response ('' — translation is audited separately). */
  translatedResponse: string;
  finalText: string;
  source: SpeechSource;
  violations: NameViolation[];
}

export interface AuditResult {
  samples: AuditSample[];
  totalTexts: number;
  totalViolations: number;
  violationsByKind: Record<string, number>;
  violationsByContext: Record<string, number>;
  violationsBySource: Record<string, number>;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const NIGHT_IDLE: NightState = { wolfKillId: null, witchPoisonId: null, witchSaved: false };

/** No secrets exist in client-side prompts, but redact defensively anyway. */
export const sanitizePrompt = (text: string): string =>
  text
    .replace(/Bearer\s+[^\s'",;|]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:authorization|x-api-key)['"]?\s*[:=]\s*)['"]?[^\s'",;|]+/gi, '$1[REDACTED]');

export const rosterSummary = (roster: Player[]): string =>
  roster
    .map(p => `${p.id}:${p.name}(${p.role}${p.isAlive ? '' : ',dead'})`)
    .join(' ');

/**
 * Classify which pipeline layer produced a final text. The hardcoded
 * fallback/wolf-chat lines are a small closed set of distinctive strings
 * (aiOrchestrator.ts buildFallback + generateWolfChat), so template matching
 * is reliable; anything else on the LLM-failure path came from the library.
 */
const HARDCODED_FRAGMENTS: ReadonlyArray<string> = [
  // buildFallback zh
  '我是预言家，昨晚验了', '的发言前后不一致', '的表水太虚了', '我先不站死边',
  '我站好人视角盘', '铁逻辑断点太明显了', '场上先不乱分票',
  // buildFallback en
  'I am the seer. Last night I checked', 'keeps contradicting earlier statements',
  'is far too hollow', 'I will not lock my read yet',
  'From the village side, the speech from', 'breaks down far too obviously',
  'Let\'s not scatter our votes today',
  // generateWolfChat hardcoded lines
  '我建议刀', '明天需要一张牌悍跳预言家', '白天别冲，倒钩配合悍跳狼',
  'I suggest we hit', 'needs to fake-claim seer', 'Do not charge during the day',
];

export const classifySource = (finalText: string, llmSucceeded: boolean): SpeechSource => {
  if (llmSucceeded) return 'remote-model';
  if (HARDCODED_FRAGMENTS.some(f => finalText.includes(f))) return 'hardcoded-fallback';
  return 'library';
};

// ─── the audit run ───────────────────────────────────────────────────────────

export interface AuditRunOptions {
  /** Filled by the test's fetch stub; drained per pipeline call. */
  capturedRequests: CapturedRequest[];
  /** True when the fetch stub returns a successful (mocked) LLM payload. */
  llmSucceeds: boolean;
  languages?: DisplayLanguage[];
  dayRounds?: number;
  voteRounds?: number;
  wolfChatRounds?: number;
}

/**
 * Generate ≥100 speeches through the real pipeline for the fixed roster:
 * day speech, last words (dead speaker through the same handleDiscussion
 * path — useGameState.ts:524,594), wolf night chat, and vote reasoning.
 */
export const runSpeechAudit = async (options: AuditRunOptions): Promise<AuditResult> => {
  const {
    capturedRequests,
    llmSucceeds,
    languages = ['zh', 'en'],
    dayRounds = 3,
    voteRounds = 3,
    wolfChatRounds = 3,
  } = options;

  const roster = makeAuditRoster();
  const wolves = roster.filter(p => p.role === 'Werewolf');
  // Deterministic start: fresh beliefs, fixed difficulty (normal-game default).
  globalBeliefTracker.init(roster);
  setAIDifficulty(0.85);

  const samples: AuditSample[] = [];
  let counter = 0;

  const takePrompt = (from: number): string => {
    const captured = capturedRequests.slice(from);
    return sanitizePrompt(captured[0]?.prompt ?? '');
  };

  const push = (
    context: SpeechContext,
    language: DisplayLanguage,
    speaker: Player,
    phase: GamePhase,
    round: number,
    prompt: string,
    rawResponse: string,
    finalText: string,
    source: SpeechSource,
  ) => {
    counter += 1;
    samples.push({
      id: `${context}-${language}-r${round}-p${speaker.id}-${counter}`,
      context,
      language,
      speakerId: speaker.id,
      speakerName: speaker.name,
      phase,
      round,
      roster: rosterSummary(roster),
      prompt,
      rawResponse: sanitizePrompt(rawResponse),
      translatedResponse: '',
      finalText,
      source,
      violations: detectNameViolations(finalText, roster),
    });
  };

  const logs: GameLog[] = []; // clean context; contamination is audited separately

  for (const language of languages) {
    // 1) Day speeches — every seat speaks each round.
    for (let round = 1; round <= dayRounds; round++) {
      for (const speaker of roster) {
        const mark = capturedRequests.length;
        const seerInfo = speaker.role === 'Seer' ? { targetId: 2, isGood: false } : null;
        const response = await generateAIDialogue(
          speaker, roster, logs, GamePhase.DAY_DISCUSSION, [], round, seerInfo, [], NIGHT_IDLE, language,
        );
        const finalText = language === 'en' ? response.en : response.zh;
        push(
          'day-speech', language, speaker, GamePhase.DAY_DISCUSSION, round,
          takePrompt(mark), llmSucceeds ? JSON.stringify(response) : '',
          finalText, classifySource(finalText, llmSucceeds),
        );
      }
    }

    // 2) Last words — dead speakers run the exact same generateAIDialogue
    //    path handleDiscussion uses for queued last-words speakers.
    const deadIds = [2, 5, 8];
    const withDeaths = roster.map(p => (deadIds.includes(p.id) ? { ...p, isAlive: false } : p));
    for (const deadId of deadIds) {
      const speaker = withDeaths.find(p => p.id === deadId)!;
      const mark = capturedRequests.length;
      const response = await generateAIDialogue(
        speaker, withDeaths, logs, GamePhase.DAY_DISCUSSION, deadIds, 2, null, [], NIGHT_IDLE, language,
      );
      const finalText = language === 'en' ? response.en : response.zh;
      push(
        'last-words', language, speaker, GamePhase.DAY_DISCUSSION, 2,
        takePrompt(mark), llmSucceeds ? JSON.stringify(response) : '',
        finalText, classifySource(finalText, llmSucceeds),
      );
    }

    // 3) Wolf night chat.
    for (let round = 1; round <= wolfChatRounds; round++) {
      const mark = capturedRequests.length;
      const chat = await generateWolfChat(wolves, roster, logs, round, [], language);
      const prompt = takePrompt(mark);
      for (const message of chat) {
        const speaker = roster.find(p => p.id === message.speakerId)!;
        push(
          'wolf-chat', language, speaker, GamePhase.NIGHT_WEREWOLVES, round,
          prompt, llmSucceeds ? message.message : '',
          message.message, classifySource(message.message, llmSucceeds),
        );
      }
    }
  }

  // 4) Vote reasoning — language-independent path (generateAIAction).
  // The Layer-1 selector emits a small closed set of zh reason templates
  // (actionSelector.ts); anything else on a successful-LLM run came from the
  // mocked remote model.
  const SELECTOR_REASON_FRAGMENTS = ['随机选择', '投可疑度最高的', '跟投最多票目标', 'fallback投票', '无可投票目标'];
  for (let round = 1; round <= voteRounds; round++) {
    for (const voter of roster) {
      const mark = capturedRequests.length;
      const action = await generateAIAction(voter, roster, logs, 'VOTE', []);
      const reason = action.reason ?? '';
      const source: SpeechSource =
        reason === 'random fallback'
          ? 'random-fallback'
          : SELECTOR_REASON_FRAGMENTS.some(f => reason.includes(f))
            ? 'selector-reason'
            : llmSucceeds
              ? 'remote-model'
              : 'selector-reason';
      push(
        'vote-reason', 'zh', voter, GamePhase.DAY_VOTING, round,
        takePrompt(mark), llmSucceeds ? reason : '', reason, source,
      );
    }
  }

  // Aggregate.
  const violationsByKind: Record<string, number> = {};
  const violationsByContext: Record<string, number> = {};
  const violationsBySource: Record<string, number> = {};
  let totalViolations = 0;
  for (const sample of samples) {
    for (const violation of sample.violations) {
      totalViolations += 1;
      violationsByKind[violation.kind] = (violationsByKind[violation.kind] ?? 0) + 1;
      violationsByContext[sample.context] = (violationsByContext[sample.context] ?? 0) + 1;
      violationsBySource[sample.source] = (violationsBySource[sample.source] ?? 0) + 1;
    }
  }

  return {
    samples,
    totalTexts: samples.length,
    totalViolations,
    violationsByKind,
    violationsByContext,
    violationsBySource,
  };
};
