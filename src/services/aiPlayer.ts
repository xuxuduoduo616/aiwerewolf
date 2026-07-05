import { GameLog, GamePhase, NightState, Player, Role, VoteRecord, WolfChatMessage } from '../types';
import { ROLE_LABELS, WEREWOLF_SLANG } from '../constants';
import { CUSTOM_AI_STYLES, FALLBACK_STYLE, DEFAULT_BACKGROUND_PROMPT } from './aiStyles';

type PlayerMemory = {
  timeline: string[];
  beliefs: Record<number, number>;
};

type SeerInfo = { targetId: number; isGood: boolean } | null;

const memoryStore = new Map<number, PlayerMemory>();

export const resetAIMemory = () => {
  memoryStore.clear();
};

const ensureMemory = (player: Player, players: Player[]) => {
  if (!memoryStore.has(player.id)) {
    const mem: PlayerMemory = {
      timeline: [`Init: Player ${player.id} (${player.aiPersonality})`],
      beliefs: {},
    };
    players.forEach(p => {
      if (p.id === player.id) return;
      mem.beliefs[p.id] = 0.5;
      if (player.role === Role.WEREWOLF && p.role === Role.WEREWOLF) mem.beliefs[p.id] = 0.95;
    });
    memoryStore.set(player.id, mem);
  }
  return memoryStore.get(player.id)!;
};

const callLLM = async (prompt: string, temp = 0.9) => {
  const localVitePorts = new Set(['5173', '4173', '4174', '4175']);
  if (typeof window !== 'undefined' && localVitePorts.has(window.location.port)) {
    return null;
  }

  try {
    const res = await fetch('/.netlify/functions/genai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        prompt,
        responseMimeType: 'application/json',
        temperature: temp,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json.text === 'string' ? json.text : null;
  } catch (e) {
    return null;
  }
};

const extractJson = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end >= start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(candidate) as T;
  } catch (e) {
    return null;
  }
};

const visibleRole = (viewer: Player, player: Player) => {
  if (viewer.id === player.id || player.isRevealed || !player.isAlive) return ROLE_LABELS[player.role];
  if (viewer.role === Role.WEREWOLF && player.role === Role.WEREWOLF) return '狼队友';
  return '未知身份';
};

const formatPlayersForViewer = (viewer: Player, players: Player[]) => {
  return players.map(player => {
    const status = player.isAlive ? '存活' : '出局';
    const vote = player.canVote ? '有票' : '无票';
    return `${player.id}号 ${player.name} ${status} ${vote} ${visibleRole(viewer, player)} claims=[${player.publicClaims.join('、') || '无'}]`;
  }).join('\n');
};

const formatLogs = (logs: GameLog[]) => {
  return logs
    .slice(-24)
    .map(log => `${log.speakerId ? `${log.speakerId}号` : '系统'}: ${log.translation || log.message}`)
    .join('\n');
};

const formatVotes = (voteRecords: VoteRecord[]) => {
  if (voteRecords.length === 0) return '暂无票型';
  return voteRecords
    .slice(-18)
    .map(vote => `第${vote.round}轮 ${vote.voterId}号 -> ${vote.targetId ? `${vote.targetId}号` : '弃票'}`)
    .join('\n');
};

const buildContext = (
  player: Player,
  players: Player[],
  logs: GameLog[],
  voteRecords: VoteRecord[],
  nightState: NightState,
  round: number,
  phase: GamePhase,
  seerInfo: SeerInfo
) => {
  const mem = ensureMemory(player, players);
  const styleKey = Object.keys(CUSTOM_AI_STYLES).find(k => player.aiModelLabel?.includes(k)) || 'GPT-4o';
  const style = CUSTOM_AI_STYLES[styleKey] || FALLBACK_STYLE;
  const teammates = players.filter(p => player.role === Role.WEREWOLF && p.role === Role.WEREWOLF && p.id !== player.id);

  const roleStrategy: Record<Role, string> = {
    [Role.WEREWOLF]: player.isWolfHopper
      ? '你是悍跳狼。第一天必须起跳预言家，给一张好人牌发查杀或给狼队友发金水，并解释警徽流。'
      : '你是狼人。白天隐藏视角，必要时倒钩、冲锋或帮悍跳狼补逻辑，不要暴露夜间信息。',
    [Role.SEER]: '你是预言家。你要报告查验结果、安排警徽流、保护可信金水。',
    [Role.WITCH]: '你是女巫。你要隐藏神职身份，结合银水、刀口和发言找狼。',
    [Role.HUNTER]: '你是猎人。你要强势表水，必要时用枪牌压力逼狼爆点。',
    [Role.IDIOT]: '你是白痴。你白天被抗推可翻牌免死，但之后无票；发言要像好人一样盘逻辑。',
    [Role.VILLAGER]: '你是平民。你没有夜间信息，只能用发言、票型和行为找狼。',
  };

  const seerSecret = seerInfo
    ? `你的最近查验: ${seerInfo.targetId}号是${seerInfo.isGood ? '好人/金水' : '狼人/查杀'}。`
    : '你没有新的查验结果。';

  return `
${DEFAULT_BACKGROUND_PROMPT}

【角色设定】
你是${player.id}号 ${player.name}。真实底牌:${ROLE_LABELS[player.role]}。
性格:${style.label}。说话风格:${style.speakingStyle}。
口头禅:${style.catchphrases.join(' / ')}
角色目标:${roleStrategy[player.role]}
${teammates.length ? `狼队友:${teammates.map(p => `${p.id}号`).join('、')}` : ''}
${player.role === Role.SEER ? seerSecret : ''}

【当前局势】
阶段:${phase}；轮次:${round}
昨夜狼刀:${nightState.wolfKillId ? `${nightState.wolfKillId}号` : '未知/空刀'}；女巫毒:${nightState.witchPoisonId ? `${nightState.witchPoisonId}号` : '未用'}；解药:${nightState.witchSaved ? '已救' : '未救'}

【玩家状态，只能根据可见身份发言，不要暴露你不该知道的好人底牌】
${formatPlayersForViewer(player, players)}

【近期发言】
${formatLogs(logs) || '暂无'}

【票型】
${formatVotes(voteRecords)}

【短期记忆】
${mem.timeline.slice(-6).join('\n')}

【必须使用的狼人杀黑话池】
${WEREWOLF_SLANG.join('、')}
`;
};

const pickAlive = (players: Player[], predicate: (player: Player) => boolean, seed = 0) => {
  const candidates = players.filter(player => player.isAlive && predicate(player));
  if (candidates.length === 0) return undefined;
  return candidates[Math.abs(seed) % candidates.length];
};

const fallbackDialogue = (
  player: Player,
  players: Player[],
  round: number,
  seerInfo: SeerInfo
): { en: string; zh: string } => {
  const suspect = pickAlive(
    players,
    p => p.id !== player.id && (player.role !== Role.WEREWOLF || p.role !== Role.WEREWOLF),
    player.id + round
  );
  const suspectLabel = suspect ? `${suspect.id}号` : '外置位';
  const second = pickAlive(players, p => p.id !== player.id && p.id !== suspect?.id, player.id + round + 2);
  const secondLabel = second ? `${second.id}号` : '后置位';

  if (player.role === Role.WEREWOLF && player.isWolfHopper) {
    return {
      en: `Claims Seer and pushes Player ${suspect?.id || '?'}.`,
      zh: `我这里直接跳预言家，昨晚验的${suspectLabel}是查杀。这个位置发言没有闭环，像是在给狼队带节奏。我的警徽流先压一张强势位，再看谁冲锋谁倒钩。`,
    };
  }

  if (player.role === Role.WEREWOLF) {
    const wolfLines = [
      `${suspectLabel}这轮表水太虚了，逻辑不是自然盘出来的，更像提前写好的发言。我不急着冲票，但这张牌必须进抗推位。`,
      `我先不站死边，但${suspectLabel}打人的收益很怪，像在给狼队找抗推位。${secondLabel}如果继续跟风冲锋，我会一起打包进狼坑。`,
      `${suspectLabel}的问题不是发言短，是视角开得太早。好人没必要这么急着带节奏，这里我建议先听他二轮怎么补。`,
    ];
    return {
      en: `Frames Player ${suspect?.id || '?'}.`,
      zh: wolfLines[player.id % wolfLines.length],
    };
  }

  if (player.role === Role.SEER && seerInfo) {
    return {
      en: `Reports inspection on Player ${seerInfo.targetId}.`,
      zh: `我是预言家，昨晚验的${seerInfo.targetId}号是${seerInfo.isGood ? '金水' : '查杀'}。这不是情绪发言，是铁逻辑信息。今天先围绕这个结果盘，别被狼队带节奏。`,
    };
  }

  if (player.role === Role.WITCH) {
    return {
      en: 'Analyzes the night kill and asks for cleaner logic.',
      zh: `我先不拍身份，但昨晚刀口很有信息量。现在好人不要互打，先看谁在强行扭曲发言顺序，谁可能是在给狼队做冲锋。`,
    };
  }

  if (player.role === Role.HUNTER) {
    return {
      en: 'Pressures suspects with a hunter-like stance.',
      zh: `我这张牌不怕上焦点，谁打我先把逻辑交干净。${suspectLabel}如果继续含糊表水，我会把你当定狼方向盘。`,
    };
  }

  if (player.role === Role.IDIOT) {
    return {
      en: 'Defends as a good player and warns against mis-vote.',
      zh: `我这轮不是狼坑位。你们要抗推我可以，但先把票型收益盘清楚，别让狼队用一张好人牌换轮次。`,
    };
  }

  const villagerLines = [
    `我站好人视角盘，${suspectLabel}的发言前后不一致，像是在找抗推位。今天先别乱分票，集中看这张牌的逻辑漏洞。`,
    `${suspectLabel}和${secondLabel}里面至少要开一张狼。一个负责带节奏，一个负责补刀，票型出来以后会很明显。`,
    `我不认${suspectLabel}的表水，他没有解释自己为什么突然转票。这个不是状态问题，是铁逻辑断点。`,
  ];

  return {
    en: `Pushes suspicion on Player ${suspect?.id || '?'}.`,
    zh: villagerLines[player.id % villagerLines.length],
  };
};

export const generateAIDialogue = async (
  player: Player,
  players: Player[],
  logs: GameLog[],
  phase: GamePhase,
  deadPlayers: number[],
  round: number,
  seerInfo: SeerInfo,
  voteRecords: VoteRecord[] = [],
  nightState: NightState = { wolfKillId: null, witchPoisonId: null, witchSaved: false }
): Promise<{ en: string; zh: string }> => {
  const context = buildContext(player, players, logs, voteRecords, nightState, round, phase, seerInfo);
  const deathReport = deadPlayers.length > 0 ? `昨晚倒牌:${deadPlayers.join('、')}号` : '昨晚平安夜。';

  const prompt = `
${context}

【任务】
你现在要进行白天发言。根据你的真实身份和胜利目标，针对当前局势输出一段自然中文狼人杀发言。
要求:
1. 80-180个中文字符，像真人玩家，不要解释自己是AI。
2. 必须提到至少一个具体玩家编号。
3. 必须结合${deathReport}、近期发言或票型，不要重复空话。
4. 狼人不能暴露自己知道的所有身份；好人不能说自己不知道的夜间信息。
5. 中文要自然使用金水、查杀、悍跳、倒钩、冲锋、表水、抗推位等术语。

JSON:
{ "en": "short English summary", "zh": "Chinese speech" }
`;

  const parsed = extractJson<{ en?: string; zh?: string }>(await callLLM(prompt, 1.0));
  const result = parsed?.zh ? { en: parsed.en || 'Speaks.', zh: parsed.zh } : fallbackDialogue(player, players, round, seerInfo);
  ensureMemory(player, players).timeline.push(`R${round}: ${result.zh.slice(0, 80)}`);
  return result;
};

export const generateAIAction = async (
  player: Player,
  players: Player[],
  logs: GameLog[],
  type: 'KILL' | 'CHECK' | 'VOTE' | 'SAVE' | 'POISON',
  voteRecords: VoteRecord[] = []
): Promise<{ targetId: number | null; reason?: string }> => {
  const valid = players
    .filter(target => {
      if (!target.isAlive || target.id === player.id) return false;
      if (type === 'KILL') return target.role !== Role.WEREWOLF;
      if (type === 'VOTE') return target.canVote || target.isAlive;
      return true;
    })
    .map(target => target.id);

  if (valid.length === 0) return { targetId: null };

  const prompt = `
你是${player.id}号，真实底牌:${ROLE_LABELS[player.role]}。
行动:${type}
可选目标:${JSON.stringify(valid)}
近期发言:
${formatLogs(logs)}
票型:
${formatVotes(voteRecords)}

请根据狼人杀胜利目标选择一个目标。狼人优先刀强神/真预言家；预言家优先验未知强势位；投票优先投最像狼的位置。
JSON:{ "targetId": number, "reason": "short Chinese reason" }
`;

  const parsed = extractJson<{ targetId?: number; reason?: string }>(await callLLM(prompt, 0.35));
  if (parsed?.targetId && valid.includes(parsed.targetId)) return { targetId: parsed.targetId, reason: parsed.reason };

  const fallbackTarget = valid[Math.floor(Math.random() * valid.length)];
  return { targetId: fallbackTarget, reason: 'fallback target' };
};

export const generateWolfChat = async (
  wolves: Player[],
  players: Player[],
  logs: GameLog[],
  round: number,
  voteRecords: VoteRecord[] = []
): Promise<WolfChatMessage[]> => {
  if (wolves.length === 0) return [];
  const aliveGood = players.filter(player => player.isAlive && player.role !== Role.WEREWOLF);
  const likelyTarget = aliveGood[0];
  const prompt = `
你们是狼人夜间团队。狼队成员:${wolves.map(w => `${w.id}号`).join('、')}。
存活好人候选:${aliveGood.map(p => `${p.id}号`).join('、')}
近期发言:${formatLogs(logs)}
票型:${formatVotes(voteRecords)}

输出${Math.min(3, wolves.length)}条狼队夜聊建议，包含刀口、悍跳、冲锋、倒钩等策略。
JSON:{ "messages": [ { "speakerId": number, "message": "中文", "strategyTag": "刀口|悍跳|冲锋|倒钩|补位" } ] }
`;

  const parsed = extractJson<{ messages?: Array<{ speakerId?: number; message?: string; strategyTag?: WolfChatMessage['strategyTag'] }> }>(
    await callLLM(prompt, 0.9)
  );

  const generated = parsed?.messages
    ?.filter(item => item.speakerId && item.message && wolves.some(w => w.id === item.speakerId))
    .slice(0, 3)
    .map((item, index) => ({
      id: `wolf-${round}-${Date.now()}-${index}`,
      round,
      speakerId: item.speakerId!,
      message: item.message!,
      strategyTag: item.strategyTag || '补位',
    }));

  if (generated?.length) return generated;

  return wolves.slice(0, 3).map((wolf, index) => ({
    id: `wolf-${round}-${wolf.id}-${index}`,
    round,
    speakerId: wolf.id,
    strategyTag: index === 0 ? '刀口' : index === 1 ? '悍跳' : '倒钩',
    message: index === 0
      ? `我建议刀${likelyTarget ? `${likelyTarget.id}号` : '强神位'}，这个位置像能带队盘逻辑。`
      : index === 1
        ? '明天需要一张狼去悍跳预言家，先给狼队友发金水或者给外置位查杀。'
        : '我可以倒钩，白天别全员冲锋，票型要做得像好人。'
  }));
};

export const generateAIReply = async (target: Player, msg: string, players: Player[], logs: GameLog[]) => {
  const prompt = `
你是${target.id}号，身份:${ROLE_LABELS[target.role]}。
人类玩家刚才说:"${msg}"
近期发言:${formatLogs(logs)}
请用中文狼人杀语气回应，不能暴露不该知道的信息。
JSON:{ "en": "...", "zh": "..." }
`;
  const parsed = extractJson<{ en?: string; zh?: string }>(await callLLM(prompt, 1.0));
  return parsed?.zh ? { en: parsed.en || 'Replies.', zh: parsed.zh } : fallbackDialogue(target, players, 1, null);
};
