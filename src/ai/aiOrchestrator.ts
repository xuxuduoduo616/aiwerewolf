/**
 * AI Orchestrator — public API replacing aiPlayer.ts exports.
 *
 * Architecture:
 *   Layer 1: BeliefTracker (pure TS) → decides target
 *   Layer 2: SpeechLibrary (distilled corpus) → real-sounding templates
 *   Layer 3: Gemini (optional LLM polish) → contextual variation
 *
 * Falls back gracefully: Gemini → Library → hardcoded template.
 */

import type { GameLog, GamePhase, NightState, Player, Role, VoteRecord, WolfChatMessage } from '../types';
import { ROLE_LABELS, WEREWOLF_SLANG } from '../constants';
import { CUSTOM_AI_STYLES, FALLBACK_STYLE } from '../services/aiStyles';
import { pickSpeech, pickWolfNightSpeech } from '../services/speechLibrary';
import { globalBeliefTracker } from './beliefTracker';
import { selectAction } from './actionSelector';
import type { ActionType } from './actionSelector';

// ─── helpers ───────────────────────────────────────────────────────────────

const isChinese = (text: string): boolean => {
  // Count CJK characters; if >30% are Chinese, treat as Chinese
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  return cjk / Math.max(1, text.length) > 0.3;
};

const fmtLogs = (logs: GameLog[]) =>
  logs.slice(-16).map(l => `${l.speakerId ? `${l.speakerId}号` : '系统'}: ${l.translation || l.message}`).join('\n');

const fmtVotes = (vr: VoteRecord[]) =>
  vr.slice(-12).map(v => `R${v.round} ${v.voterId}→${v.targetId ?? '弃票'}`).join(', ') || '暂无';

const fmtPlayers = (viewer: Player, players: Player[]) =>
  players.map(p => {
    const id = `${p.id}号`;
    const status = p.isAlive ? '活' : '死';
    const role = (viewer.id === p.id || p.isRevealed || viewer.role === 'Werewolf' && p.role === 'Werewolf')
      ? ROLE_LABELS[p.role] : '?';
    return `${id}[${status}][${role}]`;
  }).join(' ');

const generateSpeechWithLLM = async (systemPrompt: string, userPrompt: string) => {
  const { generateSpeechWithLLM: generate } = await import('./geminiAdapter');
  return generate(systemPrompt, userPrompt);
};

const generateActionWithLLM = async (prompt: string, validTargets: number[]) => {
  const { generateActionWithLLM: generate } = await import('./geminiAdapter');
  return generate(prompt, validTargets);
};

// ─── reset ─────────────────────────────────────────────────────────────────

// Module-level difficulty config (set once per game via setAIDifficulty)
let currentAccuracy = 0.85;

export const setAIDifficulty = (actionAccuracy: number) => {
  currentAccuracy = actionAccuracy;
};

export const resetAIMemory = () => {
  // BeliefTracker will be re-initialized on first action
};

// ─── Main speech generation ─────────────────────────────────────────────────

export const generateAIDialogue = async (
  player: Player,
  players: Player[],
  logs: GameLog[],
  phase: GamePhase,
  deadThisRound: number[],
  round: number,
  seerInfo: { targetId: number; isGood: boolean } | null,
  voteRecords: VoteRecord[] = [],
  nightState: NightState = { wolfKillId: null, witchPoisonId: null, witchSaved: false },
): Promise<{ en: string; zh: string }> => {

  // Initialize beliefs if needed
  if (globalBeliefTracker.snapshot(player.id).length === 0) {
    globalBeliefTracker.init(players);
  }

  const styleKey = Object.keys(CUSTOM_AI_STYLES).find(k => player.aiModelLabel?.includes(k)) || 'GPT-4o';
  const style = CUSTOM_AI_STYLES[styleKey] || FALLBACK_STYLE;
  const slang = WEREWOLF_SLANG.slice(0, 6).join('、');
  const deathNote = deadThisRound.length ? `昨晚倒牌：${deadThisRound.map(id => `${id}号`).join('、')}` : '昨晚平安夜';

  const roleStrategies: Partial<Record<Role, string>> = {
    Werewolf: player.isWolfHopper
      ? '你是悍跳狼，需要跳预言家，给一张查杀或给队友发金水'
      : '你是狼人，白天隐藏，必要时倒钩或冲锋',
    Seer: `你是预言家。昨夜查验：${seerInfo ? `${seerInfo.targetId}号是${seerInfo.isGood ? '金水/好人' : '查杀/狼人'}` : '暂无结果'}`,
    Witch: '你是女巫，隐藏身份，结合局势找狼',
    Hunter: '你是猎人，强势表水，必要时枪牌施压',
    Villager: '你是平民，通过发言和票型找狼',
    Idiot: '你是白痴，发言像好人，被抗推翻牌免死',
  };

  const systemPrompt = `你是一名狼人杀高手。性格：${style.label}。说话风格：${style.speakingStyle}。
${roleStrategies[player.role] || ''}
你的真实身份：${ROLE_LABELS[player.role]}（${player.id}号 ${player.name}）
必须使用的术语：${slang}
禁止：透露不该知道的信息，讲废话，超过180字`;

  const userPrompt = `当前局面：第${round}轮，${deathNote}
玩家列表：${fmtPlayers(player, players)}
近期发言：
${fmtLogs(logs)}
票型：${fmtVotes(voteRecords)}

请输出一段白天发言（80-180中文字符，必须提到具体玩家编号）。
返回JSON：{"en":"short English summary","zh":"Chinese speech"}`;

  // Layer 3: Try Gemini LLM first
  const llmResult = await generateSpeechWithLLM(systemPrompt, userPrompt);
  if (llmResult?.zh && isChinese(llmResult.zh)) {
    // Update beliefs from this speech
    globalBeliefTracker.updateFromSpeech(player.id, llmResult.zh, players);
    return llmResult;
  }

  // Layer 2: Speech library fallback
  const libText = await pickSpeech(player.role, [], round);
  if (libText && libText.length > 20 && isChinese(libText)) {
    // Inject a player mention if missing
    const alive = players.filter(p => p.isAlive && p.id !== player.id);
    const suspect = globalBeliefTracker.getMostSuspicious(player.id, alive);
    const mention = suspect ? `（关注${suspect.id}号）` : '';
    const zh = `${libText.slice(0, 160)}${mention}`;
    globalBeliefTracker.updateFromSpeech(player.id, zh, players);
    return { en: 'Speaks based on game situation.', zh };
  }

  // Layer 1: Hardcoded contextual fallback
  const fallback = buildFallback(player, players, round, seerInfo, nightState);
  globalBeliefTracker.updateFromSpeech(player.id, fallback.zh, players);
  return fallback;
};

// ─── Action selection ───────────────────────────────────────────────────────

export const generateAIAction = async (
  player: Player,
  players: Player[],
  logs: GameLog[],
  type: ActionType | 'SAVE',
  voteRecords: VoteRecord[] = [],
): Promise<{ targetId: number | null; reason?: string }> => {

  if (globalBeliefTracker.snapshot(player.id).length === 0) {
    globalBeliefTracker.init(players);
  }

  // SAVE is handled by game engine directly; return pass
  if (type === 'SAVE') return { targetId: null };

  const valid = players
    .filter(p => {
      if (!p.isAlive || p.id === player.id) return false;
      if (type === 'KILL') return p.role !== 'Werewolf';
      if (type === 'VOTE') return p.isAlive;
      return true;
    })
    .map(p => p.id);

  if (valid.length === 0) return { targetId: null };

  // Layer 1: BeliefTracker-based decision (always runs)
  const l1Decision = selectAction(player, players, globalBeliefTracker, type, 1, voteRecords, currentAccuracy);

  // Layer 3: Try Gemini for better action selection
  const round = Math.max(1, voteRecords.length > 0 ? voteRecords[voteRecords.length - 1].round : 1);
  const prompt = `你是${player.id}号，身份：${ROLE_LABELS[player.role]}。
行动：${type}，可选目标：${JSON.stringify(valid)}
近期：${fmtLogs(logs)}
票型：${fmtVotes(voteRecords)}
按狼人杀最优策略选择目标。
JSON：{"targetId":number,"reason":"简短中文原因"}`;

  const llmResult = await generateActionWithLLM(prompt, valid);
  if (llmResult.targetId && valid.includes(llmResult.targetId)) {
    // Update beliefs: this actor suspects the chosen target
    if (type === 'VOTE') {
      globalBeliefTracker.updateFromVote(player.id, llmResult.targetId);
    }
    return llmResult;
  }

  // Use Layer 1 fallback if LLM fails
  if (l1Decision.targetId && valid.includes(l1Decision.targetId)) {
    if (type === 'VOTE') {
      globalBeliefTracker.updateFromVote(player.id, l1Decision.targetId);
    }
    return l1Decision;
  }

  return { targetId: valid[Math.floor(Math.random() * valid.length)], reason: 'random fallback' };
};

// ─── Wolf night chat ─────────────────────────────────────────────────────────

export const generateWolfChat = async (
  wolves: Player[],
  players: Player[],
  logs: GameLog[],
  round: number,
  voteRecords: VoteRecord[] = [],
): Promise<WolfChatMessage[]> => {
  if (wolves.length === 0) return [];

  const aliveGood = players.filter(p => p.isAlive && p.role !== 'Werewolf');
  const strategyTags: WolfChatMessage['strategyTag'][] = ['刀口', '悍跳', '冲锋', '倒钩', '补位'];

  // Try Gemini for wolf chat
  const systemPrompt = '你们是狼人夜间团队，用中文简洁商量策略。';
  const userPrompt = `狼队：${wolves.map(w => `${w.id}号`).join('、')}
存活好人：${aliveGood.map(p => `${p.id}号`).join('、')}
近期发言：${fmtLogs(logs)}
票型：${fmtVotes(voteRecords)}
输出${Math.min(3, wolves.length)}条夜聊策略。
JSON：{"messages":[{"speakerId":number,"message":"中文","strategyTag":"刀口|悍跳|冲锋|倒钩|补位"}]}`;

  const raw = await generateSpeechWithLLM(systemPrompt, userPrompt);

  // Parse wolf chat messages
  if (raw?.zh) {
    try {
      const cleaned = raw.zh.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as
        { messages?: Array<{ speakerId?: number; message?: string; strategyTag?: WolfChatMessage['strategyTag'] }> };

      const generated = parsed?.messages
        ?.filter(item => item.speakerId && item.message && wolves.some(w => w.id === item.speakerId))
        .slice(0, 3)
        .map((item, idx) => ({
          id: `wolf-${round}-${Date.now()}-${idx}`,
          round,
          speakerId: item.speakerId!,
          message: item.message!,
          strategyTag: item.strategyTag || '补位',
        }));

      if (generated && generated.length > 0) return generated;
    } catch {
      // fall through to library fallback
    }
  }

  // Library fallback: pick wolf speeches from corpus
  const result: WolfChatMessage[] = [];
  for (let i = 0; i < Math.min(3, wolves.length); i++) {
    const wolf = wolves[i];
    const libText = await pickWolfNightSpeech();
    const tag = strategyTags[i % strategyTags.length];
    const target = aliveGood[i % aliveGood.length];
    const fallbackMsg = libText && libText.length > 15
      ? libText.slice(0, 120)
      : (i === 0
        ? `我建议刀${target ? `${target.id}号` : '强神位'}。`
        : i === 1
          ? '明天需要一张牌悍跳预言家，我可以跳。'
          : '白天别冲，倒钩配合悍跳狼。');

    result.push({
      id: `wolf-${round}-${wolf.id}-${i}`,
      round,
      speakerId: wolf.id,
      message: fallbackMsg,
      strategyTag: tag,
    });
  }
  return result;
};

// ─── Contextual hardcoded fallback ──────────────────────────────────────────

const buildFallback = (
  player: Player,
  players: Player[],
  round: number,
  seerInfo: { targetId: number; isGood: boolean } | null,
  nightState: NightState,
): { en: string; zh: string } => {
  const alive = players.filter(p => p.isAlive && p.id !== player.id);
  const suspect = globalBeliefTracker.getMostSuspicious(player.id, alive,
    p => player.role !== 'Werewolf' || p.role !== 'Werewolf');
  const suspectLabel = suspect ? `${suspect.id}号` : '外置位';

  if (player.role === 'Seer' && seerInfo) {
    return {
      en: `Seer reports: Player ${seerInfo.targetId} is ${seerInfo.isGood ? 'GOOD' : 'WOLF'}.`,
      zh: `我是预言家，昨晚验了${seerInfo.targetId}号，结果是${seerInfo.isGood ? '金水/好人' : '查杀/狼人'}。今天先围绕这个结果盘逻辑。`,
    };
  }

  if (player.role === 'Werewolf') {
    const lines = [
      `${suspectLabel}的发言前后不一致，逻辑不是自然盘出来的，我倾向于投他。`,
      `场上${suspectLabel}的表水太虚了，这个位置我要带节奏，一起看发言。`,
      `我先不站死边，但${suspectLabel}的视角开得太早，像在带节奏给狼队找抗推位。`,
    ];
    return { en: `Frames Player ${suspect?.id || '?'}.`, zh: lines[player.id % lines.length] };
  }

  const lines = [
    `我站好人视角盘，${suspectLabel}的发言有问题，建议今天集中看他的逻辑漏洞。`,
    `${suspectLabel}铁逻辑断点太明显了，不解释清楚我就先投他。`,
    `场上先不乱分票，${suspectLabel}要先说清楚自己的立场再说。`,
  ];
  return { en: `Pushes suspicion on Player ${suspect?.id || '?'}.`, zh: lines[player.id % lines.length] };
};
