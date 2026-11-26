import { describe, expect, it } from 'vitest';
import { conciseWolfText, wolfDayFallback, wolfNightFallback, wolfPlanFor } from './wolfStrategy';
import { makeAuditRoster } from '../diagnostics/fixtures';
import type { WolfChatMessage } from '../types';

const players = makeAuditRoster().map(player => ({ ...player, isHuman: player.id === 2 }));
const say = (message: string): WolfChatMessage => ({ id: message, round: 1, speakerId: 2, message, strategyTag: '补位' });

describe('complete wolf sentences', () => {
  it('preserves a complete message longer than the old 120 character cap', () => {
    const text = "I will support the Seer claim with a separate line of public reasoning so the village does not immediately connect our positions. We should leave room to change course if the real Seer challenges that story.";
    expect(text.length).toBeGreaterThan(120);
    expect(conciseWolfText(text)).toBe(text);
  });
  it('rejects unfinished and oversized sentences instead of inventing their endings', () => {
    expect(conciseWolfText('Our plan is ready. Tomorrow I will follow the other playe')).toBeNull();
    expect(conciseWolfText(`${'word '.repeat(100)}.`)).toBeNull();
  });
  it('rejects excess output whole and preserves abbreviations and decimals without clipping', () => {
    expect(conciseWolfText('One point. A second point. Third point. Fourth point.')).toBeNull();
    const text = 'I will cover you. Keep our votes separate. Mr. Player 5 needs pressure tomorrow.';
    expect(conciseWolfText(text)).toBe(text);
    expect(conciseWolfText('The timer is at 1.5 minutes. Let us agree on our roles.')).toBe('The timer is at 1.5 minutes. Let us agree on our roles.');
  });
});

describe('private plan continuity without changing actions', () => {
  it('recognizes named seat assignments and the latest revision', () => {
    const history = [say('Player 3, please claim Seer. Player 4, stay under the radar.'), say('Actually Player 3 should stay low. Player 4, please claim Seer.')];
    expect(wolfPlanFor(players[2], players, history).role).toBe('quiet');
    expect(wolfPlanFor(players[3], players, history).role).toBe('seer');
    expect(wolfDayFallback(players[2], players, history, 'en')).not.toContain('claiming Seer');
    expect(wolfDayFallback(players[3], players, history, 'en')).toContain('claiming Seer');
  });
  it('revises old claims using the actual lead-discussion and backup wording', () => {
    const history = [say('Player 3, please claim Seer. Player 4, claim Seer.'), say('I will stay under the radar. Player 3, lead the discussion while Player 4 handles backup.')];
    expect(wolfPlanFor(players[2], players, history).role).toBe('lead');
    expect(wolfPlanFor(players[3], players, history).role).toBe('support');
  });
  it('does not make a second teammate claim Seer when the human takes that job', () => {
    const history = [say('I will claim Seer. Stay under the radar.')];
    expect(wolfDayFallback(players[2], players, history, 'en')).not.toContain('claiming Seer');
    expect(wolfNightFallback(players[2], players, [say('I will claim Seer.')], 'en')).toContain('You can take the Seer claim');
    expect(wolfPlanFor(players[2], players, [say('Player 3, please claim Seer.'), say('I will claim Seer instead.')]).role).toBe('support');
  });
  it('acknowledges a legal suggested night kill while keeping confirmation authoritative', () => {
    const history = [say('I suggest we kill Player 5 tonight.')];
    expect(wolfNightFallback(players[2], players, history, 'en')).toContain('suggestion to target Player 5');
    expect(wolfNightFallback(players[2], players, history, 'en', 6)).toContain('confirmed night target remains Player 6');
    expect(wolfNightFallback(players[2], players, [say('I suggest we kill Player 3 tonight.')], 'en')).toContain('suggestion to target Player 3');
    for (const confirmed of [2, 3]) {
      const reply = wolfNightFallback(players[2], players, history, 'en', confirmed);
      expect(reply).toContain(`confirmed night target remains Player ${confirmed}`);
      expect(reply).not.toContain('target Player 5');
    }
    expect(wolfNightFallback(players[2], players, [say('Do not make a second Seer claim. I suggest we kill Player 5 tonight.')], 'en')).toContain('suggestion to target Player 5');
  });
  it('does not bus a non-wolf or reveal private instructions in public fallback', () => {
    const history = [say('Player 3, bus Player 5. Secret code pineapple.')];
    expect(wolfPlanFor(players[2], players, history).targetId).toBeUndefined();
    const speech = wolfDayFallback(players[2], players, history, 'en');
    expect(speech).not.toContain('Player 5');
    expect(speech).not.toMatch(/pineapple|teammate|private|night/i);
  });
});
