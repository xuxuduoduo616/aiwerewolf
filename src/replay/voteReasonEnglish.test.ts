import { describe, expect, it } from 'vitest';
import { englishVoteReason } from './voteReasonEnglish';

describe('English vote reasons', () => {
  it.each([
    ['（低难度）随机选择', 'Chose a target at random on the lower difficulty setting.'],
    ['（难度容错）狼队保护队友随机选择', 'Chose a non-wolf at random to protect the pack during a difficulty-based mistake.'],
    ['（难度容错）次优候选选择', 'Chose at random among the leading suspects, allowing a less likely candidate at this difficulty.'],
    ['跟投最多票目标', 'Followed the vote for the target with the most votes.'],
    ['无可投票目标', 'There was no eligible target to vote for.'],
    ['fallback投票', 'Voted for a random eligible target as a fallback.'],
    ['投可疑度最高的 12号', 'Voted for Seat 12, the most suspicious player.'],
    ['狼队协同冲票 4号', 'Joined the pack in voting for Seat 4.'],
    ['狼队分散推抗推目标 10号', "Voted for Seat 10 to spread the pack's votes across targets."],
    ['狼队推抗推高威胁目标 8号', 'Pushed to exile Seat 8, a threat to the pack.'],
    ['策略倒钩保身份（投已暴露队友 11号）', 'Voted against an exposed teammate, Seat 11, to protect my cover.'],
    ['I followed Zoë after １０号 voted for Player 4号 in round 2.', 'I followed Zoë after Seat 10 voted for Seat 4 in round 2.'],
  ])('renders %s with its original rationale and referents', (reason, expected) => {
    expect(englishVoteReason(reason)).toBe(expected);
  });

  it.each([
    'Cast a tactical self-vote after a direct request this round.',
    'This seat cannot vote.',
    'random fallback',
    'Zoë thought Seat 4 had a 65% chance of being a wolf.',
    'No reason recorded.',
  ])('preserves the English reason %s', reason => {
    expect(englishVoteReason(reason)).toBe(reason);
  });

  it.each(['不跟投最多票目标', 'Seat 2 avoided 3号，之后发生了别的事。', '理由は不明です', 'Неизвестная причина'])(
    'marks untranslatable free text without guessing a tactic',
    reason => expect(englishVoteReason(reason)).toBe('English translation unavailable for this recorded reason.'),
  );
});
