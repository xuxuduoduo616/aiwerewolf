import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { claimLobbyActivity, createDefaultLobbyFeatureState, saveLobbyFeatureState } from '../lobbyFeatures';
import { useLobbyFeatures } from './useLobbyFeatures';

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

const HookProbe: React.FC<{ userId?: string | null; storage: Storage | null }> = ({ userId, storage }) => {
  const { storageKey, state } = useLobbyFeatures(userId, storage);
  return React.createElement(
    'output',
    { 'data-storage-key': storageKey },
    `${state.claimedActivityIds.join(',') || 'none'}|${state.factionContributions.gpt}`,
  );
};

describe('useLobbyFeatures', () => {
  it('hydrates the requested identity from versioned local state', () => {
    const storage = createMemoryStorage();
    const state = claimLobbyActivity(createDefaultLobbyFeatureState(), 'daily-roll-call');
    saveLobbyFeatureState('user-1', state, storage);

    const html = renderToStaticMarkup(React.createElement(HookProbe, { userId: 'user-1', storage }));
    expect(html).toContain('data-storage-key="aiwerewolf:lobby-features:v1:user-1"');
    expect(html).toContain('daily-roll-call|0');
  });

  it('does not expose another user state', () => {
    const storage = createMemoryStorage();
    const state = claimLobbyActivity(createDefaultLobbyFeatureState(), 'private-claim');
    saveLobbyFeatureState('user-1', state, storage);

    const html = renderToStaticMarkup(React.createElement(HookProbe, { userId: 'user-2', storage }));
    expect(html).toContain('aiwerewolf:lobby-features:v1:user-2');
    expect(html).toContain('none|0');
    expect(html).not.toContain('private-claim');
  });

  it('renders deterministic defaults without browser storage', () => {
    const html = renderToStaticMarkup(React.createElement(HookProbe, { userId: null, storage: null }));
    expect(html).toContain('aiwerewolf:lobby-features:v1:guest');
    expect(html).toContain('none|0');
  });
});
