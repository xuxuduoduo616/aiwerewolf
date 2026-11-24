/**
 * Layer 1 — Bilingual Clause-Level Speech Evidence Parser
 *
 * Pure deterministic TypeScript (zero LLM calls). Extracts structured claims
 * and public role claims from Chinese and English daytime speeches while
 * handling:
 *  - Multi-target clause separation (e.g. "我信3号，7号才是狼")
 *  - Negation reversal ("3号不是狼", "Player 3 is not a wolf", "我不信3号")
 *  - Quotation, attribution, and hypothetical suppression ("如果3号是狼", "5号说3号是狼")
 *  - Substring-trap avoidance ("信息", "假设", "villager")
 *  - Self-mention exclusion and within-speech deduplication
 */

import { Role, type Player } from '../types';

export type SpeechClaimPolarity = 'accuse' | 'defend' | 'check-wolf' | 'check-good';

export interface SpeechClaim {
  speakerId: number;
  targetId: number;
  polarity: SpeechClaimPolarity;
  confidence: number;
  clause: string;
  tag: string;
  round?: number;
  eventId?: string;
}

export interface ParsedRoleClaim {
  speakerId: number;
  claimedRole: Role;
  confidence: number;
  clause: string;
  round?: number;
  eventId?: string;
}

export interface ParseSpeechOptions {
  round?: number;
  eventId?: string;
}

export interface ParsedSpeechEvidence {
  claims: SpeechClaim[];
  roleClaims: ParsedRoleClaim[];
  suppressedClauses: string[];
}

interface ClauseSegment {
  text: string;
  afterContrastive: boolean;
}

// ─── Clause Splitting ────────────────────────────────────────────────────────

const PRIMARY_SPLIT_RE = /[，,。.;；!！?？\n—–]+/;
const CONTRASTIVE_SPLIT_RE =
  /(?:但是|然而|不过|可是|反观|同时|而且|并且|但|\b(?:but|however|while|yet|whereas|meanwhile|although|though)\b)/gi;

const PLAYER_MENTION_TEST_RE =
  /(?:\d+\s*号|\b(?:player|seat)\s*\d+\b|(?:^|[\s,(（\[])#\d+\b)/i;

const ANY_POLARITY_CUE_RE =
  /(?:不是|不像|不信|不相信|别投|不要投|是狼|像狼|狼人|狼坑|查杀|铁狼|投\s*\d|投他|投她|出\s*\d|出他|出她|推\s*\d|抗推|怀疑|可疑|漏洞|撒谎|骗|假预|悍跳|相信|我信(?!息)|信任|保\s*\d|保他|保她|金水|银水|像好人|是好人|铁好人|可信|\b(?:wolf|werewolf|suspect|suspicious|lying|liar|vote|voting|push|exile|guilty|fake\s+seer|trust|clear|cleared|good|innocent|defend|vouch|villager|distrust)\b)/i;

const splitEnglishAnd = (text: string): string[] => {
  const parts: string[] = [];
  const andRe = /\band\b/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = andRe.exec(text)) !== null) {
    const left = text.slice(lastIndex, match.index).trim();
    const right = text.slice(match.index + match[0].length).trim();
    if (
      left &&
      right &&
      PLAYER_MENTION_TEST_RE.test(left) &&
      ANY_POLARITY_CUE_RE.test(left) &&
      PLAYER_MENTION_TEST_RE.test(right) &&
      ANY_POLARITY_CUE_RE.test(right)
    ) {
      parts.push(left);
      lastIndex = match.index + match[0].length;
    }
  }
  const tail = text.slice(lastIndex).trim();
  if (tail) parts.push(tail);
  return parts.length > 0 ? parts : [text];
};

const splitInlineChineseContrast = (text: string): string[] => {
  // Split compound unpunctuated Chinese like "我信3号不信7号" or "我保3号投7号"
  // ONLY when both sides carry a player mention and a polarity cue so phrases
  // like "7号才是狼" or "我觉得2号是狼" are never broken apart.
  const parts = text
    .split(/(?=(?:不信(?!息)|不相信|而不是|投\s*\d+\s*号|出\s*\d+\s*号|推\s*\d+\s*号))/)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [text];
  const validSplit = parts.every(
    part => PLAYER_MENTION_TEST_RE.test(part) && ANY_POLARITY_CUE_RE.test(part),
  );
  return validSplit ? parts : [text];
};

const splitIntoClauses = (speech: string): ClauseSegment[] => {
  const primaryChunks = speech
    .split(PRIMARY_SPLIT_RE)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  const segments: ClauseSegment[] = [];
  for (const chunk of primaryChunks) {
    CONTRASTIVE_SPLIT_RE.lastIndex = 0;
    let lastIndex = 0;
    let sawContrastive = false;
    let match: RegExpExecArray | null;
    while ((match = CONTRASTIVE_SPLIT_RE.exec(chunk)) !== null) {
      const before = chunk.slice(lastIndex, match.index).trim();
      if (before) {
        for (const sub of splitEnglishAnd(before).flatMap(splitInlineChineseContrast)) {
          segments.push({ text: sub, afterContrastive: sawContrastive });
          sawContrastive = false;
        }
      }
      sawContrastive = true;
      lastIndex = match.index + match[0].length;
    }
    const tail = chunk.slice(lastIndex).trim();
    if (tail) {
      for (const sub of splitEnglishAnd(tail).flatMap(splitInlineChineseContrast)) {
        segments.push({ text: sub, afterContrastive: sawContrastive });
        sawContrastive = false;
      }
    }
  }
  return segments;
};

// ─── Mention Extraction ──────────────────────────────────────────────────────

const extractTargetMentions = (
  clause: string,
  speakerId: number,
  validPlayerIds: ReadonlySet<number>,
): number[] => {
  const found: Array<{ index: number; id: number }> = [];
  const patterns: RegExp[] = [
    /(\d+)\s*号/g,
    /\b(?:player|seat)\s*(\d+)\b/gi,
    /(?:^|[\s,(（\[])#(\d+)\b/g,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(clause)) !== null) {
      const id = Number.parseInt(match[1], 10);
      if (Number.isInteger(id) && validPlayerIds.has(id) && id !== speakerId) {
        found.push({ index: match.index, id });
      }
    }
  }
  found.sort((a, b) => a.index - b.index);
  const deduped: number[] = [];
  for (const item of found) {
    if (!deduped.includes(item.id)) deduped.push(item.id);
  }
  return deduped;
};

// ─── Suppression: Hypothetical / Quotation / Attribution ─────────────────────

const HYPOTHETICAL_RE =
  /(?:如果说|如果|假如说|假如|假设|要是|万一|倘若|假定|\b(?:what\s+if|if|suppose|supposing|assuming|assume|hypothetically)\b)/i;

const HYPOTHETICAL_CONTINUATION_RE =
  /^\s*(?:那|那么|就|我就|就会|才|会|\b(?:then|we\s+would|i\s+would|they\s+would|he\s+would|she\s+would)\b)/i;

const ATTRIBUTION_RE =
  /(?:(?:刚才|刚刚|之前|前面|上轮|上一轮)?有人(?:说|讲|觉得|认为|怀疑|指控|投|保|踩|提到|聊到)|\d+\s*号\s*(?:刚才|刚刚|之前)?(?:说|讲|声称|认为|觉得|怀疑|指控|提到|聊到)|(?:他|她|对方|别人)\s*(?:刚才|刚刚|之前)?(?:说|讲|声称|觉得|认为|怀疑|指控)|(?:引用|转述|原话)|\b(?:player|seat)\s*\d+\s+(?:said|says|claimed|claims|argued|accused|called|suggested|thought|thinks)\b|\b(?:someone|somebody|he|she|they)\s+(?:said|says|claimed|claims|quoted|suggested|argued|called)\b|\b(?:quoted|quoting|according\s+to)\b)/i;

// ─── Role Claims ─────────────────────────────────────────────────────────────

const ROLE_CLAIM_PATTERNS: ReadonlyArray<{ role: Role; positive: RegExp; negated: RegExp }> = [
  {
    role: Role.SEER,
    positive: /(?:我是(?:真)?预言家|我跳预言家|我起跳预言家|本人预言家|\b(?:i\s+am|i'm|claiming)\s+(?:the\s+|a\s+)?(?:real\s+|true\s+)?seer\b)/i,
    negated: /(?:我不是预言家|我没跳预言家|\b(?:i\s+am\s+not|i'm\s+not|not\s+claiming)\s+(?:the\s+|a\s+)?seer\b)/i,
  },
  {
    role: Role.WITCH,
    positive: /(?:我是女巫|我跳女巫|\b(?:i\s+am|i'm|claiming)\s+(?:the\s+|a\s+)?witch\b)/i,
    negated: /(?:我不是女巫|\b(?:i\s+am\s+not|i'm\s+not)\s+(?:the\s+|a\s+)?witch\b)/i,
  },
  {
    role: Role.HUNTER,
    positive: /(?:我是猎人|我跳猎人|\b(?:i\s+am|i'm|claiming)\s+(?:the\s+|a\s+)?hunter\b)/i,
    negated: /(?:我不是猎人|\b(?:i\s+am\s+not|i'm\s+not)\s+(?:the\s+|a\s+)?hunter\b)/i,
  },
  {
    role: Role.IDIOT,
    positive: /(?:我是白痴|我跳白痴|\b(?:i\s+am|i'm|claiming)\s+(?:the\s+|a\s+)?idiot\b)/i,
    negated: /(?:我不是白痴|\b(?:i\s+am\s+not|i'm\s+not)\s+(?:the\s+|a\s+)?idiot\b)/i,
  },
  {
    role: Role.VILLAGER,
    positive: /(?:我是(?:纯|铁)?(?:平民|村民)|\b(?:i\s+am|i'm)\s+(?:a\s+)?villager\b)/i,
    negated: /(?:我不是(?:平民|村民)|\b(?:i\s+am\s+not|i'm\s+not)\s+(?:a\s+)?villager\b)/i,
  },
];

// ─── Polarity & Negation Patterns ────────────────────────────────────────────

const PROCEDURAL_NEUTRAL_RE =
  /(?:\bbefore\s+(?:we\s+)?vot(?:e|ing)\b|先听[^，,。]*?再(?:决定|投|投票|站边)|再决定(?:投票|票型|站边))/gi;

const NEGATED_ACCUSATION_RE =
  /(?:不是\s*(?:狼|狼人|铁狼|坏人|假预言家|查杀)|不像\s*(?:狼|狼人|坏人)|不(?:觉得|认为)[^，,。]{0,12}?(?:是狼|像狼|狼人|可疑|撒谎|骗人)|(?:别|不要|千万别|先别|不用|不应该|不建议)\s*(?:投|出|推|怀疑|踩)|不(?:可疑|像狼)|没(?:什么|啥)?(?:可疑|漏洞)|\b(?:is\s+not|isn't|are\s+not|aren't|not|no|never)\s+(?:a\s+|the\s+)?(?:wolf|werewolf|mafia|suspicious|guilty|lying|a\s+liar|fake\s+seer)\b|\b(?:don't|do\s+not|shouldn't|should\s+not|wouldn't|would\s+not|never)\s+(?:vote(?:\s+for)?|exile|push|suspect|accuse|lynch)\b|\b(?:doesn't|does\s+not)\s+(?:look|seem|sound)\s+(?:like\s+a\s+)?(?:wolf|werewolf|suspicious|guilty)\b)/i;

const NEGATED_DEFENSE_RE =
  /(?:不(?:相信|信任|信(?!息)|保|认下|站边)|不是\s*(?:好人|金水|银水|真?预言家|平民|村民)|不像\s*(?:好人|预言家|平民|村民)|没(?:办法|法)?(?:相信|信任|信(?!息)|保)|\b(?:don't|do\s+not|cannot|can't|won't|will\s+not|never)\s+(?:trust|believe|clear|defend|back|vouch\s+for)\b|\b(?:is\s+not|isn't|not)\s+(?:good|innocent|clear(?:ed)?|a\s+villager|the\s+(?:real\s+|true\s+)?seer|trustworthy)\b|\b(?:distrust|untrustworthy)\b)/i;

const CHECK_VERB_RE =
  /(?:昨晚验|昨夜验|验了|查验了|查了|发了|给\s*\d+\s*号\s*发|\b(?:checked|inspected|scanned)\b)/i;

const CHECK_WOLF_EXPLICIT_RE = /(?:查杀|\bhard\s+check\b)/i;
const CHECK_GOOD_EXPLICIT_RE = /(?:金水|\bconfirmed\s+good\b)/i;
const SILVER_WATER_RE = /(?:银水|\bsaved\s+by\s+(?:the\s+)?witch\b)/i;

const POSITIVE_ACCUSE_STRONG_RE =
  /(?:是狼|铁狼|定狼|狼人|狼坑|悍跳|假预言家|假预|假跳|投\s*\d+\s*号|投他|投她|投这|出\s*\d+\s*号|出他|出她|推\s*\d+\s*号|推他|推她|票\s*\d+\s*号|票他|票她|全票出|今天出|今天投|先投|建议投|倾向于投|\b(?:wolf|werewolf|wolves|mafia|guilty|liar|lying|fake\s+seer|vote(?:\s+for)?|voting(?:\s+for)?|exile|lynch|eliminate)\b)/i;

const POSITIVE_ACCUSE_STANDARD_RE =
  /(?:像狼|狼面|抗推|怀疑|可疑|漏洞|逻辑断点|前后矛盾|前后不一致|表水太虚|带节奏|撒谎|骗人|在骗|踩\s*\d+\s*号|踩他|踩她|\b(?:suspect(?:ing|s)?|suspicious|accuse|accusing|push(?:ing)?(?:\s+on)?|contradict(?:s|ing)?|holes?\s+in\s+that\s+logic|logic\s+breaks?\s+down|mislynch|hollow)\b)/i;

const POSITIVE_DEFEND_RE =
  /(?:相信|信任|我信(?!息)|很信(?!息)|比较信(?!息)|信(?!息)(?=\s*\d+\s*号|\s*他|\s*她)|保\s*\d+\s*号|保他|保她|力保|认下|站边\s*\d+\s*号|站\s*\d+\s*号|是好人|像好人|铁好人|偏白|好人面|可信|清白|真预言家|真预|\b(?:trust(?:ing|s|worthy)?|believe|vouch(?:ing)?(?:\s+for)?|defend(?:ing)?|back(?:ing)?|clear(?:ed)?|innocent|clean|real\s+seer|true\s+seer)\b|\b(?:is|are|looks?|seems?)\s+(?:(?:very|really|definitely|clearly|probably|quite)\s+)?(?:a\s+)?(?:good|villager)\b)/i;

const ANAPHORA_RE =
  /(?:投他|投她|出他|出她|推他|推她|保他|保她|信他|信她|踩他|踩她|他不是|她不是|他是|她是|他像|她像|他可疑|她可疑|那个位置|这个位置|这个人|这人|\b(?:him|her|them|that\s+seat|voting\s+there|there)\b)/i;

const CHECK_RESULT_ONLY_RE =
  /(?:查杀|金水|是狼|狼人|是好人|好人|\b(?:wolf|werewolf|good|villager|innocent|hard\s+check)\b)/i;

const polarityDirection = (polarity: SpeechClaimPolarity): 'hostile' | 'supportive' =>
  polarity === 'accuse' || polarity === 'check-wolf' ? 'hostile' : 'supportive';

const polarityPriority = (polarity: SpeechClaimPolarity): number => {
  if (polarity === 'check-wolf' || polarity === 'check-good') return 2;
  return 1;
};

interface ClassifiedClause {
  polarity: SpeechClaimPolarity;
  confidence: number;
  tag: string;
}

const classifyClause = (clause: string, inCheckContext: boolean): ClassifiedClause | null => {
  const cleaned = clause.replace(PROCEDURAL_NEUTRAL_RE, ' ');

  // Priority 1: Negated accusation -> weak defense
  if (NEGATED_ACCUSATION_RE.test(cleaned)) {
    return { polarity: 'defend', confidence: 0.55, tag: 'negated-accusation' };
  }

  // Priority 2: Negated defense -> weak accusation
  if (NEGATED_DEFENSE_RE.test(cleaned)) {
    return { polarity: 'accuse', confidence: 0.65, tag: 'negated-defense' };
  }

  // Priority 3: Explicit check-wolf / check-good (slang or check-verb context)
  if (CHECK_WOLF_EXPLICIT_RE.test(cleaned)) {
    return { polarity: 'check-wolf', confidence: 0.90, tag: 'check-wolf' };
  }
  if (CHECK_GOOD_EXPLICIT_RE.test(cleaned)) {
    return { polarity: 'check-good', confidence: 0.90, tag: 'check-good' };
  }

  const hasCheckVerb = CHECK_VERB_RE.test(cleaned);
  if (hasCheckVerb || inCheckContext) {
    if (/(?:是狼|狼人|坏人|\b(?:wolf|werewolf|evil|bad)\b)/i.test(cleaned)) {
      return { polarity: 'check-wolf', confidence: 0.90, tag: 'check-wolf' };
    }
    if (/(?:是好人|好人|平民|村民|\b(?:good|villager|innocent|clear(?:ed)?)\b)/i.test(cleaned)) {
      return { polarity: 'check-good', confidence: 0.90, tag: 'check-good' };
    }
  }

  // Priority 4: Silver water (strong witch-save defense)
  if (SILVER_WATER_RE.test(cleaned)) {
    return { polarity: 'defend', confidence: 0.85, tag: 'silver-water' };
  }

  // Priority 5: Positive accusation
  if (POSITIVE_ACCUSE_STRONG_RE.test(cleaned)) {
    return { polarity: 'accuse', confidence: 0.85, tag: 'accusation' };
  }
  if (POSITIVE_ACCUSE_STANDARD_RE.test(cleaned)) {
    return { polarity: 'accuse', confidence: 0.80, tag: 'accusation' };
  }

  // Priority 6: Positive defense
  if (POSITIVE_DEFEND_RE.test(cleaned)) {
    return { polarity: 'defend', confidence: 0.75, tag: 'defense' };
  }

  return null;
};

/**
 * Parse a daytime speech into structured per-target claims and public role claims.
 */
export const parseSpeechEvidence = (
  speech: string,
  speakerId: number,
  allPlayers: readonly Player[],
  options: ParseSpeechOptions = {},
): ParsedSpeechEvidence => {
  const validPlayerIds = new Set(allPlayers.map(player => player.id));
  const segments = splitIntoClauses(speech);
  const suppressedClauses: string[] = [];
  const rawClaims: SpeechClaim[] = [];
  const roleClaimsByRole = new Map<Role, ParsedRoleClaim>();

  let prevWasHypothetical = false;
  let lastReferencedTargetId: number | null = null;
  let lastCheckedTargetId: number | null = null;

  for (const segment of segments) {
    const clause = segment.text;
    const isHypothetical = HYPOTHETICAL_RE.test(clause);
    const isHypotheticalContinuation =
      prevWasHypothetical && !segment.afterContrastive && HYPOTHETICAL_CONTINUATION_RE.test(clause);
    const isAttribution = ATTRIBUTION_RE.test(clause);

    const explicitTargets = extractTargetMentions(clause, speakerId, validPlayerIds);

    if (isHypothetical || isHypotheticalContinuation) {
      suppressedClauses.push(clause);
      prevWasHypothetical = true;
      lastCheckedTargetId = null;
      continue;
    }

    prevWasHypothetical = false;

    if (isAttribution) {
      suppressedClauses.push(clause);
      // Remember attributed target only for contrastive rebuttals using pronouns
      // (e.g. "刚才有人说2号是狼，但我觉得他不是狼").
      if (explicitTargets.length === 1) {
        lastReferencedTargetId = explicitTargets[0];
      }
      lastCheckedTargetId = null;
      continue;
    }

    // Extract self role claims on active clauses
    for (const pattern of ROLE_CLAIM_PATTERNS) {
      if (pattern.positive.test(clause) && !pattern.negated.test(clause)) {
        const existing = roleClaimsByRole.get(pattern.role);
        if (!existing) {
          roleClaimsByRole.set(pattern.role, {
            speakerId,
            claimedRole: pattern.role,
            confidence: pattern.role === Role.SEER ? 0.95 : 0.85,
            clause,
            ...(options.round !== undefined ? { round: options.round } : {}),
            ...(options.eventId !== undefined ? { eventId: options.eventId } : {}),
          });
        }
      }
    }

    const hasCheckVerb = CHECK_VERB_RE.test(clause);
    let targets = explicitTargets;
    let inCheckContext = false;

    if (targets.length > 0) {
      if (targets.length === 1) {
        lastReferencedTargetId = targets[0];
      } else {
        lastReferencedTargetId = null;
      }
      if (hasCheckVerb && targets.length === 1) {
        lastCheckedTargetId = targets[0];
        inCheckContext = true;
      } else {
        lastCheckedTargetId = null;
      }
    } else if (lastCheckedTargetId !== null && CHECK_RESULT_ONLY_RE.test(clause)) {
      targets = [lastCheckedTargetId];
      inCheckContext = true;
      lastCheckedTargetId = null;
    } else if (lastReferencedTargetId !== null && ANAPHORA_RE.test(clause)) {
      targets = [lastReferencedTargetId];
    } else {
      lastCheckedTargetId = null;
    }

    if (targets.length === 0) continue;

    const classification = classifyClause(clause, inCheckContext);
    if (!classification || classification.confidence <= 0) continue;

    for (const targetId of targets) {
      if (targetId === speakerId) continue;
      rawClaims.push({
        speakerId,
        targetId,
        polarity: classification.polarity,
        confidence: classification.confidence,
        clause,
        tag: classification.tag,
        ...(options.round !== undefined ? { round: options.round } : {}),
        ...(options.eventId !== undefined ? { eventId: options.eventId } : {}),
      });
    }
  }

  // Deduplicate within one speech per (targetId, direction) so repeating
  // "Player 3" multiple times in one speech produces at most 1 claim per
  // target direction (with check-wolf/check-good taking precedence over
  // plain accuse/defend, and higher confidence winning ties).
  const dedupedByTargetDir = new Map<string, SpeechClaim>();
  for (const claim of rawClaims) {
    const key = `${claim.targetId}:${polarityDirection(claim.polarity)}`;
    const existing = dedupedByTargetDir.get(key);
    if (
      !existing ||
      polarityPriority(claim.polarity) > polarityPriority(existing.polarity) ||
      (polarityPriority(claim.polarity) === polarityPriority(existing.polarity) &&
        claim.confidence > existing.confidence)
    ) {
      dedupedByTargetDir.set(key, claim);
    }
  }

  return {
    claims: [...dedupedByTargetDir.values()],
    roleClaims: [...roleClaimsByRole.values()],
    suppressedClauses,
  };
};
