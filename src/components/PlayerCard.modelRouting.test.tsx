import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerCard } from './PlayerCard';
import { makeAuditRoster } from '../diagnostics/fixtures';

describe('seat model attribution', () => {
  it('provides full assigned and actual accessible names rather than a random style', () => {
    const player = { ...makeAuditRoster()[1], aiAssignedModel: 'gemini-3.6-flash' as const, aiDialogueSource: { model: 'gemini-2.5-flash' as const, fallback: true } };
    const html = renderToStaticMarkup(<PlayerCard player={player} isMe={false} revealRole={false} onClick={() => undefined} />);
    expect(html).toContain('aria-label="Gemini 2.5 Flash"');
    expect(html).toContain('title="Gemini 2.5 Flash"');
    expect(html).not.toContain('>GPT-4o<');
  });
  it('shows legacy fixtures neutrally before trustworthy routing exists', () => {
    const html = renderToStaticMarkup(<PlayerCard player={makeAuditRoster()[1]} isMe={false} revealRole={false} onClick={() => undefined} />);
    expect(html).toContain('aria-label="AI player"');
  });
});
