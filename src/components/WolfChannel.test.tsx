import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WolfChannel from './WolfChannel';
import type { WolfChatMessage } from '../types';

describe('English wolf-chat presentation', () => {
  it('renders internal strategy enums as English labels', () => {
    const tags: WolfChatMessage['strategyTag'][] = ['刀口', '悍跳', '冲锋', '倒钩', '补位'];
    const html = renderToStaticMarkup(<WolfChannel isVisible wolfChat={tags.map((strategyTag, i) => ({
      id: String(i), round: 1, speakerId: 2, strategyTag, message: 'Let us target Player 5 tonight.',
    }))} />);
    expect(html).not.toMatch(/[\p{Script=Han}]/u);
    for (const label of ['Night target', 'Fake claim', 'Team push', 'Blend in', 'Support']) expect(html).toContain(label);
  });
});
