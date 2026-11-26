import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '../types';
import { SHOWCASE_ROLES } from '../services/roleShowcaseConfig';
import RoleBadgeIcon from './RoleBadgeIcon';
import RoleIdentityBadge from './RoleIdentityBadge';
import RoleShowcaseModal from './RoleShowcaseModal';
import NightSkillEffectOverlay from './NightSkillEffectOverlay';

const transitionsCss = readFileSync(new URL('../styles/transitions.css', import.meta.url), 'utf8');
const responsiveCss = readFileSync(new URL('../styles/game-responsive.css', import.meta.url), 'utf8');
const economyCss = readFileSync(new URL('../styles/economy.css', import.meta.url), 'utf8');
const gameScreenSource = readFileSync(new URL('../screens/GameScreen.tsx', import.meta.url), 'utf8');

describe('RoleShowcaseModal, RoleIdentityBadge & NightSkillEffectOverlay', () => {
  it('renders RoleShowcaseModal initial mode with E2E selectors and tagged bilingual copy', () => {
    const markupEn = renderToStaticMarkup(
      <RoleShowcaseModal
        mode="initial"
        role={Role.WITCH}
        boardName="9-Player Standard"
        language="en"
        players={[{ role: Role.WITCH }]}
        isMuted={false}
        ttsEnabled
        audioVolume={1}
        onDone={vi.fn()}
      />,
    );

    expect(markupEn).toContain('class="match-intro role-showcase-dialog');
    expect(markupEn).toContain('aria-modal="true"');
    expect(markupEn).toContain('aria-label="Match starting"');
    expect(markupEn).toContain('aria-label="Skip match intro"');
    expect(markupEn).toContain('<video class="role-showcase-media" src="./assets/roles/witch/entrance.mp4"');
    expect(markupEn).toContain('poster="./assets/roles/witch/portrait.webp"');
    expect(markupEn).toContain('<img class="role-showcase-still" src="./assets/roles/witch/portrait.webp" alt="" aria-hidden="true"');
    expect(markupEn).toContain('data-ui-copy-category="AI_OR_PLAYER_SPEECH_OR_CHAT"');
    expect(markupEn).toContain('One drop mends the soul; another seals the night.');

    const markupZh = renderToStaticMarkup(
      <RoleShowcaseModal
        mode="replay"
        role={Role.SEER}
        boardName="9-Player Standard"
        language="zh"
        players={[{ role: Role.SEER }]}
        isMuted={false}
        ttsEnabled
        audioVolume={1}
        onDone={vi.fn()}
      />,
    );

    expect(markupZh).toContain('aria-label="Seer role showcase"');
    expect(markupZh).toContain('aria-label="Close role showcase"');
    expect(markupZh).toContain('水墨孤月之下，真假终见分晓。');
  });

  it('renders RoleIdentityBadge and distinct RoleBadgeIcon SVGs for all 6 roles', () => {
    for (const role of SHOWCASE_ROLES) {
      const iconMarkup = renderToStaticMarkup(<RoleBadgeIcon role={role} />);
      expect(iconMarkup).toContain(`data-role-icon="${role}"`);
      if (role === Role.WEREWOLF) {
        expect(iconMarkup).toContain('M4.5 3L9.5 8L12 7.5L14.5 8L19.5 3V11.5L21 13.5L17.5 15.5L15 19L12 21L9 19L6.5 15.5L3 13.5L4.5 11.5Z');
        expect(iconMarkup).toContain('M7.2 11.5L9.8 12.7');
        expect(iconMarkup).toContain('M10 18.5L10.6 20');
      }

      const badgeMarkup = renderToStaticMarkup(
        <RoleIdentityBadge role={role} language="zh" onOpenReplay={vi.fn()} />,
      );
      expect(badgeMarkup).toContain('class="role-identity-badge"');
      expect(badgeMarkup).toContain('data-ui-copy-category="AI_OR_PLAYER_SPEECH_OR_CHAT"');
      expect(badgeMarkup).toContain(`aria-label="View ${role} role showcase"`);
    }
  });

  it('renders NightSkillEffectOverlay with motion asset for active skills and static fallback for WITCH_HOLD', () => {
    expect(renderToStaticMarkup(<NightSkillEffectOverlay cue={null} onDismiss={vi.fn()} />)).toBe('');

    const seerMarkup = renderToStaticMarkup(
      <NightSkillEffectOverlay
        cue={{ id: 'c1', kind: 'SEER_CHECK', actorId: 1, targetId: 4, round: 1 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(seerMarkup).toContain('data-skill-kind="SEER_CHECK"');
    expect(seerMarkup).toContain('src="./assets/skills/seer-check.mp4"');
    expect(seerMarkup).toContain('Seer Check');
    expect(seerMarkup).toContain('Player 4');

    const holdMarkup = renderToStaticMarkup(
      <NightSkillEffectOverlay
        cue={{ id: 'c2', kind: 'WITCH_HOLD', actorId: 1, targetId: null, round: 1 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(holdMarkup).toContain('data-skill-kind="WITCH_HOLD"');
    expect(holdMarkup).not.toContain('<video');
    expect(holdMarkup).toContain('night-skill-static-emblem');
    expect(holdMarkup).toContain('Potion Held');
  });

  it('defines non-blocking skill overlay, still crossfade layer, 44px badge, center-20% portrait crop, mobile bottom dock, and toast clearance in CSS', () => {
    expect(transitionsCss).toContain('object-position: center 20%;');
    expect(transitionsCss).toMatch(/\.role-showcase-still\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?pointer-events:\s*none;[\s\S]*?transition:\s*opacity 180ms ease-out;/);
    expect(transitionsCss).toMatch(/\.role-showcase-still\.is-visible\s*\{\s*opacity:\s*1;/);
    expect(transitionsCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.role-showcase-still\s*\{\s*transition:\s*none;\s*\}/);
    expect(transitionsCss).toMatch(/\.night-skill-overlay\s*\{[\s\S]*?pointer-events:\s*none;/);
    expect(transitionsCss).toContain('@media (max-width: 640px)');
    expect(responsiveCss).toMatch(/\.role-identity-badge\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?min-height:\s*44px;/);
    expect(responsiveCss).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.game-room-role-dock\s*\{\s*display:\s*contents;/);
    expect(responsiveCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.game-room\.sketch-scene::before,\s*\.game-room\.sketch-scene::after\s*\{\s*position:\s*fixed;\s*inset:\s*0;/);
    expect(responsiveCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.game-room-layout\s*\{[\s\S]*?overflow-x:\s*clip;/);
    expect(responsiveCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.game-room\.sketch-scene:has\(~ \.game-room-role-dock\)/);
    expect(responsiveCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.game-room-role-dock\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;/);
    expect(responsiveCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.game-room-role-dock \.role-identity-badge\s*\{[\s\S]*?position:\s*static;/);
    expect(economyCss).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.economy-global-feedback--game\s*\{[\s\S]*?calc\(100vw - 190px\)/);
    expect(economyCss).toMatch(/@media \(max-width: 1023px\)\s*\{[\s\S]*?\.economy-global-feedback--game\s*\{[\s\S]*?calc\(68px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(gameScreenSource).toContain('className="game-room-role-dock" role="region" aria-label="Player role badge"');
  });
});
