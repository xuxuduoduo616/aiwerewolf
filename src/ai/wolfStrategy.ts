import type { Player, WolfChatMessage } from '../types';
import type { DisplayLanguage } from '../i18n';

/** Accept complete concise replies whole. Never shorten at an ambiguous period. */
export const conciseWolfText = (value: string): string | null => {
  const text = value.trim();
  if (!text || !/[.!?。！？]["”’')\]]*$/.test(text)) return null;
  const sentenceText = text.replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\./gi, word => word.replace(/\./g, ''))
    .replace(/(\d)\.(?=\d)/g, '$1');
  const sentences = sentenceText.match(/[^.!?。！？]+[.!?。！？]+["”’')\]]*/g);
  // Ambiguous or excessive output takes a full fallback rather than losing words.
  return sentences?.length && sentences.length <= 3 && text.split(/\s+/).length <= 90 && text.length <= 600 ? text : null;
};

export const humanWolfInstructions = (history: WolfChatMessage[], players: Player[]): WolfChatMessage[] =>
  history.filter(entry => players.some(player => player.id === entry.speakerId && player.isHuman
    && player.role === 'Werewolf') && entry.message.trim());

type Responsibility = 'seer' | 'lead' | 'distance' | 'quiet' | 'support';
interface WolfPlan { role: Responsibility; targetId?: number; hasInstructions: boolean }

/** Local expression fallback understands the strategy chips and common revisions.
 * This never changes votes, kills, beliefs, or any game rule. */
export const wolfPlanFor = (speaker: Player, players: Player[], history: WolfChatMessage[]): WolfPlan => {
  const instructions = humanWolfInstructions(history, players);
  let plan: WolfPlan = { role: 'support', hasInstructions: instructions.length > 0 };
  for (const instruction of instructions) {
    let text = instruction.message;
    for (const player of players) {
      if (!player.name || player.name.length < 2) continue;
      const escaped = player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), `Player ${player.id}`);
    }
    for (const clause of text.split(/[.;!?\n]|,(?=\s*(?:Player\s*\d+|I\b))|\b(?:while|and)\s+(?=Player\s*\d+)/i)) {
      const ids = Array.from(clause.matchAll(/\bPlayer\s*(\d+)\b/gi), match => Number(match[1]));
      const actor = /^(?:\s*(?:please|actually|instead|then|and)\b[,:]?\s*)*\s*Player\s*(\d+)/i.exec(clause);
      const firstPerson = /\bI(?:'ll| will| am| want to| can| should| plan to)\b/i.test(clause);
      if (firstPerson && instruction.speakerId !== speaker.id && /claim.*seer/i.test(clause)
        && !/do not|don't|stop|cancel|no longer/i.test(clause) && plan.role === 'seer') {
        plan = { role: 'support', hasInstructions: true };
      }
      if (actor && Number(actor[1]) !== speaker.id || firstPerson && instruction.speakerId !== speaker.id) continue;
      let role: Responsibility | undefined;
      if (/under the radar|stay (?:low|quiet)|keep (?:quiet|a low profile)|低调|倒钩/i.test(clause)) role = 'quiet';
      else if (/(?:claim|pretend|pose).*seer|预言家|悍跳/i.test(clause)) role = /do not|don't|stop|cancel|no longer|不要|别/i.test(clause) ? 'support' : 'seer';
      else if (/\bbus\b|distance|疏远/i.test(clause)) role = 'distance';
      else if (/lead.*(?:push|discussion)|defend|aggressive|冲锋|保护队友/i.test(clause)) role = 'lead';
      else if (/backup|support|independent|补位|配合/i.test(clause)) role = 'support';
      if (!role) continue;
      const target = ids.find(id => id !== speaker.id && players.some(player => player.id === id
        && (role !== 'distance' && role !== 'lead' || player.role === 'Werewolf')));
      plan = { role, targetId: target, hasInstructions: true };
    }
  }
  return plan;
};

const latestNightSuggestion = (history: WolfChatMessage[], players: Player[]): Player | undefined => {
  for (const instruction of humanWolfInstructions(history, players).slice().reverse()) {
    for (const clause of instruction.message.split(/[.;!?。！？\n]/).reverse()) {
      if (!/kill|night target|tonight|刀|击杀/i.test(clause)) continue;
      const ids = Array.from(clause.matchAll(/\bPlayer\s*(\d+)\b/gi), match => Number(match[1]));
      if (/do not|don't|cancel|不要|别/i.test(clause) && ids.length < 2) return undefined;
      const proposed = ids.slice().reverse().map(id => players.find(player => player.id === id && player.isAlive)).find(Boolean);
      if (proposed) return proposed;
    }
  }
};

export const wolfNightFallback = (
  speaker: Player, players: Player[], history: WolfChatMessage[], language: DisplayLanguage,
  confirmedTargetId?: number | null,
): string => {
  const plan = wolfPlanFor(speaker, players, history);
  const target = players.find(player => player.id === confirmedTargetId && player.isAlive);
  const human = players.find(player => player.isHuman && player.role === 'Werewolf');
  const humanPlan = human ? wolfPlanFor(human, players, history) : undefined;
  const proposed = latestNightSuggestion(history, players);
  if (language === 'zh') {
    const roles: Record<Responsibility, string> = {
      seer: '我负责明天悍跳预言家，先把查验说法想清楚。风险是引来真预言家的注意，其他人不要照搬我的措辞。',
      lead: '我负责带节奏，用公开发言里的理由保护队友。不要一起硬保同一个人，免得暴露联系。',
      distance: '我会和队友保持距离，只针对公开发言提出质疑。压力不能过头，避免真的把队友推出去。',
      quiet: '我会低调发言，只说一两处公开信息里的疑点。这样能减少关注，但不能一直沉默。',
      support: plan.hasInstructions ? '我收到你的安排，会根据最新分工配合。白天各自用不同的公开理由，避免显得过于一致。' : '我们先明确明天谁带节奏，其他人分开回应。不要一起说同一套理由，免得暴露联系。',
    };
    return `${roles[plan.role]}${target ? `今晚的击杀已确认是${target.id}号。` : proposed ? `我收到刀${proposed.id}号的建议，但还是以你的最终确认为准。` : ''}`;
  }
  const roles: Record<Responsibility, string> = {
    seer: "I'll handle the Seer claim tomorrow and keep my check story consistent. That can draw the real Seer's attention, so cover me without copying my wording.",
    lead: "I'll lead the push and defend our teammates with specific public evidence. We should avoid all defending the same person at once, which could expose our links.",
    distance: `I'll keep my distance${plan.targetId ? ` from Player ${plan.targetId}` : ' from our teammates'} and challenge weak public reasoning. We need enough pressure to look independent without getting a teammate eliminated.`,
    quiet: "I'll stay under the radar and make brief, evidence-based comments. Keeping a low profile helps, but complete silence would attract suspicion.",
    support: plan.hasInstructions
      ? "I've read your instructions and will support the latest division of responsibilities. I'll use my own public reasoning so our coordination does not look rehearsed."
      : "Let's divide tomorrow's responsibilities and give each other room to respond. Matching every argument would make our coordination too obvious.",
  };
  const humanSupport: Partial<Record<Responsibility, string>> = {
    seer: "You can take the Seer claim; I'll keep my public story separate. Multiple Seer claims from our team would make the plan much harder to defend.",
    lead: "You lead the push; I'll support the public points I can defend independently. Repeating every accusation would make us look linked.",
    distance: "I'll respond to distancing with my own public reasoning and avoid exposing our arrangement. Keep the pressure measured so we do not lose a teammate unnecessarily.",
    quiet: "I'll avoid drawing attention back to you while you keep a low profile. We still need independent public observations so neither of us looks absent.",
  };
  const goodTarget = players.find(player => player.isAlive && player.role !== 'Werewolf');
  const line = plan.role === 'support' && proposed && !target
    ? `I understand your suggestion to target Player ${proposed.id} tonight; the final choice is still yours. We should weigh removing that player's influence against making our daytime connections too obvious.`
    : plan.role === 'support' && plan.hasInstructions && humanPlan
    ? humanSupport[humanPlan.role] || roles.support
    : !target && !plan.hasInstructions && plan.role === 'support' && goodTarget
      ? `We could consider Player ${goodTarget.id} as a night target while we divide tomorrow's responsibilities. We should avoid matching every argument, which would make us look linked.`
      : roles[plan.role];
  return `${line}${target ? ` The confirmed night target remains Player ${target.id}.` : proposed && plan.role !== 'support' ? ` Your proposed night target is Player ${proposed.id}, pending your confirmation.` : ''}`;
};

/** Public phrasing derived from a private plan; never quote the private chat. */
export const wolfDayFallback = (
  speaker: Player, players: Player[], history: WolfChatMessage[], language: DisplayLanguage,
): string | null => {
  const plan = wolfPlanFor(speaker, players, history);
  if (!plan.hasInstructions) return null;
  const target = players.find(player => player.id === plan.targetId && player.isAlive && player.id !== speaker.id)
    ?? players.find(player => player.isAlive && player.id !== speaker.id
      && (plan.role === 'distance' || plan.role === 'lead' ? player.role === 'Werewolf' : player.role !== 'Werewolf'));
  const seat = target ? `Player ${target.id}` : 'each player';
  if (language === 'zh') {
    if (plan.role === 'seer') return '我跳预言家，但先把今天的发言和票型对清楚，再决定重点质疑谁。大家逐个说清自己的判断依据，不要跟着别人走。';
    if (plan.role === 'distance') return `${target ? `${target.id}号` : '每个人'}都需要解释自己的发言和投票是否一致。我会根据公开信息判断，不会无条件站边。`;
    if (plan.role === 'lead') return '先把质疑建立在具体发言上，不能因为有人被带节奏就认定他有问题。我要听完整解释，再比较票型和立场变化。';
    return `${target ? `${target.id}号` : '每个人'}的判断依据还需要说清楚。我先听完大家的发言，再核对公开票型。`;
  }
  if (plan.role === 'seer') return `I am claiming Seer, and I want ${seat} to explain their position before we settle today's vote. Compare the claims carefully instead of following the loudest voice.`;
  if (plan.role === 'distance') return `${seat} needs to explain whether their public votes match their reasoning. I will judge that explanation on its merits rather than give anyone an automatic pass.`;
  if (plan.role === 'lead') return `The pressure on ${seat} needs to rest on a specific contradiction, not repetition. Give that explanation a fair hearing before treating an accusation as settled.`;
  return `I want to hear ${seat} explain the reasoning behind their position. I'll compare that with the public vote record before drawing a conclusion.`;
};
