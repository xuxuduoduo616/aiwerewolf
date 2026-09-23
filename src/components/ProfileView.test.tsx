import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProfileView from './ProfileView';

describe('ProfileView public identity', () => {
  it('shows the real guest principal and a non-blocking sign-in CTA', () => {
    const html = renderToStaticMarkup(
      <ProfileView
        identityName="Guest 11111111"
        identityHandle="guest:11111111-1111-4111-8111-111111111111"
        isGuest
        onSignIn={vi.fn()}
      />,
    );
    expect(html).toContain('Guest 11111111');
    expect(html).toContain('guest:11111111-1111-4111-8111-111111111111');
    expect(html).toContain('Sign in or create account');
    expect(html).not.toContain('1000242');
  });

  it('shows account Nickname and @username without exposing the auth UUID', () => {
    const html = renderToStaticMarkup(
      <ProfileView
        identityName="Village Traveler"
        identityHandle="@player_one"
        isGuest={false}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    expect(html).toContain('Village Traveler');
    expect(html).toContain('@player_one');
    expect(html).not.toContain('Sign in or create account');
    expect(html).toContain('Sign out');
    expect(html).not.toContain('user-1');
  });
});
