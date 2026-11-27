import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GamePhase, Role } from '../types';
import { PlayerKnowledgeBadge, WitchVictimNotice } from './PlayerKnowledgeBadge';

const props = {
  playerId: 4,
  viewer: { role: Role.WITCH, isAlive: true },
  phase: GamePhase.DAY_DISCUSSION,
  nightState: { wolfKillId: 9, witchPoisonId: null, witchSaved: false },
  seerCheck: { targetId: 4, isGood: true },
};
const badge = (overrides: Partial<React.ComponentProps<typeof PlayerKnowledgeBadge>> = {}) =>
  renderToStaticMarkup(<PlayerKnowledgeBadge {...props} {...overrides} />);

describe('role-private seat knowledge', () => {
  it.each([true, false])('never gives the Witch an AI Seer result (isGood=%s)', isGood => {
    expect(badge({ seerCheck: { targetId: 4, isGood } })).toBe('');
    const target = badge({ playerId: 9, seerCheck: { targetId: 9, isGood } });
    expect(target).toContain('Attacked');
    expect(target).not.toMatch(/Known Good|Confirmed Wolf|Seer check/);
  });

  it.each([Role.VILLAGER, Role.WEREWOLF, Role.HUNTER, Role.IDIOT])('hides private badge data from %s', role => {
    expect(badge({ viewer: { role, isAlive: true } })).toBe('');
    expect(badge({ playerId: 9, viewer: { role, isAlive: true } })).toBe('');
  });

  it('retains the human Seer check without displaying Witch victim knowledge', () => {
    const viewer = { role: Role.SEER, isAlive: true };
    expect(badge({ viewer })).toContain('Known Good');
    expect(badge({ viewer, seerCheck: { targetId: 4, isGood: false } })).toContain('Confirmed Wolf');
    expect(badge({ viewer, playerId: 9 })).toBe('');
    expect(badge({ viewer, seerCheck: null })).toBe('');
  });

  it('persists all previously checked seats across multiple nights for the human Seer', () => {
    const seerChecks = { 2: false, 3: false, 5: true };
    const latestCheck = { targetId: 5, isGood: true };
    const aliveSeer = { role: Role.SEER, isAlive: true };
    const deadSeer = { role: Role.SEER, isAlive: false };

    // Night 1 check (Seat 2 = wolf) and Night 2 check (Seat 3 = wolf) stay visible after Night 3 check (Seat 5 = good)
    expect(badge({ viewer: aliveSeer, playerId: 2, seerCheck: latestCheck, seerChecks })).toContain('Confirmed Wolf');
    expect(badge({ viewer: aliveSeer, playerId: 3, seerCheck: latestCheck, seerChecks })).toContain('Confirmed Wolf');
    expect(badge({ viewer: aliveSeer, playerId: 5, seerCheck: latestCheck, seerChecks })).toContain('Known Good');
    expect(badge({ viewer: aliveSeer, playerId: 6, seerCheck: latestCheck, seerChecks })).toBe('');

    // Checked badges persist for the human Seer even after elimination or at GAME_OVER
    expect(badge({ viewer: deadSeer, playerId: 2, phase: GamePhase.DAY_VOTING, seerCheck: latestCheck, seerChecks })).toContain('Confirmed Wolf');
    expect(badge({ viewer: deadSeer, playerId: 5, phase: GamePhase.GAME_OVER, seerCheck: latestCheck, seerChecks })).toContain('Known Good');

    // Non-Seer roles never see cumulative Seer checks
    expect(badge({ viewer: { role: Role.VILLAGER, isAlive: true }, playerId: 2, seerCheck: latestCheck, seerChecks })).toBe('');
    expect(badge({ viewer: { role: Role.WITCH, isAlive: true }, playerId: 2, seerCheck: latestCheck, seerChecks })).toBe('');
  });

  it('distinguishes the current Wolf Target, the attacked player and a saved player', () => {
    expect(badge({ playerId: 9, phase: GamePhase.NIGHT_WITCH })).toContain('Wolf Target');
    expect(badge({ playerId: 9 })).toContain('Attacked');
    const saved = badge({ playerId: 9, nightState: { ...props.nightState, witchSaved: true } });
    expect(saved).toContain('Saved');
    expect(saved).toContain('alignment is unknown');
    expect(saved).not.toMatch(/Known Good|Confirmed Wolf/);
  });

  it.each([GamePhase.NIGHT_START, GamePhase.NIGHT_WEREWOLVES, GamePhase.NIGHT_SEER])('does not reveal the victim early during %s', phase => {
    expect(badge({ playerId: 9, phase })).toBe('');
    expect(renderToStaticMarkup(<WitchVictimNotice {...props} phase={phase} />)).toBe('');
  });

  it('does not reveal future attacks to a dead Witch or invent a target on an empty night', () => {
    expect(badge({ playerId: 9, viewer: { role: Role.WITCH, isAlive: false } })).toBe('');
    expect(badge({ playerId: 9, nightState: { ...props.nightState, wolfKillId: null } })).toBe('');
    expect(badge({ viewer: undefined })).toBe('');
  });

  it('keeps the role notice consistent with the victim and antidote state', () => {
    expect(renderToStaticMarkup(<WitchVictimNotice {...props} />)).toContain('Player 9 was attacked');
    const saved = renderToStaticMarkup(<WitchVictimNotice {...props} nightState={{ ...props.nightState, witchSaved: true }} />);
    expect(saved).toContain('You saved Player 9');
    expect(saved).not.toContain('Player 4');
  });

  it('hides Wolf Target badge and WitchVictimNotice once antidote is spent on a subsequent night', () => {
    expect(badge({ playerId: 9, phase: GamePhase.NIGHT_WITCH, canSeeWitchVictim: false })).toBe('');
    expect(badge({ playerId: 9, phase: GamePhase.DAY_DISCUSSION, canSeeWitchVictim: false })).toBe('');
    expect(
      renderToStaticMarkup(
        <WitchVictimNotice {...props} phase={GamePhase.NIGHT_WITCH} canSeeWitchVictim={false} />,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <WitchVictimNotice {...props} phase={GamePhase.DAY_DISCUSSION} canSeeWitchVictim={false} />,
      ),
    ).toBe('');

    // When canSeeWitchVictim is true (antidote available or used tonight), notice and badge remain visible
    expect(badge({ playerId: 9, phase: GamePhase.NIGHT_WITCH, canSeeWitchVictim: true })).toContain('Wolf Target');
    expect(
      renderToStaticMarkup(
        <WitchVictimNotice
          {...props}
          phase={GamePhase.DAY_DISCUSSION}
          nightState={{ ...props.nightState, witchSaved: true }}
          canSeeWitchVictim={true}
        />,
      ),
    ).toContain('You saved Player 9');
  });
});
