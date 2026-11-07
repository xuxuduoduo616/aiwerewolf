import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Role, type Player } from '../types';
import { SKIN_CATALOG } from '../economy/catalog';
import { PlayerCard } from './PlayerCard';
import SkinArtwork from './SkinArtwork';

const player: Player = {
  id: 1, name: 'Fixture Human', role: Role.SEER, camp: 'VILLAGE', isAlive: true,
  canVote: true, isRevealed: false, avatarUrl: '/fixture-avatar.svg', aiPersonality: '',
  traits: [], aiModelLabel: 'Local AI', isHuman: true, publicClaims: [], privateKnowledge: [], suspicionMap: {},
};
const markup = (props: Partial<React.ComponentProps<typeof PlayerCard>> = {}) => renderToStaticMarkup(
  <PlayerCard player={player} isMe revealRole={false} onClick={() => {}} {...props} />,
);
const parts = (html: string) => [...html.matchAll(/data-equipment="([^"]+)"/g)].map(match => match[1]);

describe('human seat skin presentation', () => {
  it.each(SKIN_CATALOG)('shares $id geometry with the store and retains the 56/64px boundary', product => {
    for (const compact of [true, false]) {
      const html = markup({ equippedSkin: product, compact });
      expect(parts(html)).toEqual(parts(renderToStaticMarkup(<SkinArtwork product={product} />)));
      expect(html).toContain(compact ? 'w-14 h-14' : 'w-16 h-16');
      expect(html).toContain(`Fixture Human wearing ${product.name}`);
      expect(html).not.toContain('<img');
      expect(html).toContain('Seer');
    }
  });
  it('preserves the default image for AI, absent and unknown equipment', () => {
    for (const props of [{}, { equippedSkin: SKIN_CATALOG[0], isMe: false }, { equippedSkin: { ...SKIN_CATALOG[0], id: 'unknown' } }]) {
      const html = markup(props);
      expect(html).toContain('src="/fixture-avatar.svg"');
      expect(html).not.toContain('wuxia-character-avatar');
    }
    expect(markup({ isMe: false, equippedSkin: SKIN_CATALOG[0] })).not.toContain('Seer');
  });
  it.each([9, 12])('preserves badges, selected/speaking/finished/dead states in a %i-seat board', count => {
    const html = renderToStaticMarkup(<>{Array.from({ length: count }, (_, index) => <PlayerCard key={index}
      player={{ ...player, id: index + 1, isAlive: index !== 4, canVote: index !== 5 }}
      isMe={index === 0} equippedSkin={SKIN_CATALOG[0]} revealRole={false} onClick={() => {}}
      isSelected={index === 0} isSpeaking={index === 1} hasSpoken={index === 2}
      isWolfTeammate={index === 3} customBadge={index === 0 ? <span>Known Good</span> : undefined}
    />)}</>);
    expect(html.match(/wuxia-character-avatar/g)).toHaveLength(1);
    for (const state of ['speaking-ring', 'Finished speaking', 'Werewolf teammate', 'Known Good', 'No Vote', 'OUT', 'border-zinc-100 bg-zinc-800']) expect(html).toContain(state);
  });
  it('keeps all status overlays when the equipped human is speaking or dead', () => {
    expect(markup({ equippedSkin: SKIN_CATALOG[6], isSpeaking: true })).toContain('speaking-ring');
    expect(markup({ equippedSkin: SKIN_CATALOG[6], hasSpoken: true })).toContain('Finished speaking');
    expect(markup({ equippedSkin: SKIN_CATALOG[6], player: { ...player, isAlive: false } })).toContain('OUT');
  });
  it('wires resolved equipment only to the actual human seat in App', () => {
    const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('useEquippedSkinProduct(economy, auth.isGuest ? guestPrincipalId : auth.session?.user.id ?? null)');
    expect(source).toContain('equippedSkin={player.id === MY_PLAYER_ID ? equippedSkinProduct : null}');
  });
});
