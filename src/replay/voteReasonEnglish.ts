// Replay votes retain the original decision text, including in older saves.
// Only the Vote reasons report uses these English renderings.
const fixedReasons = new Map([
  ['(低难度)随机选择', 'Chose a target at random on the lower difficulty setting.'],
  ['(难度容错)狼队保护队友随机选择', 'Chose a non-wolf at random to protect the pack during a difficulty-based mistake.'],
  ['(难度容错)次优候选选择', 'Chose at random among the leading suspects, allowing a less likely candidate at this difficulty.'],
  ['无可投票目标', 'There was no eligible target to vote for.'],
  ['跟投最多票目标', 'Followed the vote for the target with the most votes.'],
  ['fallback投票', 'Voted for a random eligible target as a fallback.'],
]);

const seatReasons: readonly [RegExp, string][] = [
  [/^投可疑度最高的\s*Seat (\d+)$/, 'Voted for Seat $1, the most suspicious player.'],
  [/^狼队协同冲票\s*Seat (\d+)$/, 'Joined the pack in voting for Seat $1.'],
  [/^狼队分散推抗推目标\s*Seat (\d+)$/, "Voted for Seat $1 to spread the pack's votes across targets."],
  [/^狼队推抗推高威胁目标\s*Seat (\d+)$/, 'Pushed to exile Seat $1, a threat to the pack.'],
  [/^策略倒钩保身份\s*\(投已暴露队友\s*Seat (\d+)\)$/, 'Voted against an exposed teammate, Seat $1, to protect my cover.'],
];

const hasNonLatinLetter = (text: string): boolean =>
  /(?=\p{L})\P{Script=Latin}/u.test(text);

export function englishVoteReason(reason: string): string {
  if (!hasNonLatinLetter(reason)) return reason;

  // Normalize only for template matching. English free text retains its
  // original names, punctuation and numbers.
  const normalized = reason.normalize('NFKC').replace(/(?:\b(?:Seat|Player)\s*)?(\d+)\s*号(?:玩家)?/gi, 'Seat $1');
  const fixed = fixedReasons.get(normalized);
  if (fixed) return fixed;
  for (const [pattern, translation] of seatReasons) {
    if (pattern.test(normalized)) return normalized.replace(pattern, translation);
  }
  if (!hasNonLatinLetter(normalized)) return normalized;
  return 'English translation unavailable for this recorded reason.';
}
