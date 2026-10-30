import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../hooks/useAuth';
import LoginView from './LoginView';

const render = (overrides: Partial<AuthState> = {}) => {
  const auth = {
    authMode: 'LOGIN', loginMethod: 'PASSWORD', authStep: 'EMAIL',
    authEmail: '', authUsername: '', authNickname: '', authCode: '', authPassword: '',
    authError: '', authErrorField: null, isAuthLoading: false,
    isIdentityCompletionPending: false, needsIdentity: false, ...overrides,
  } as AuthState;
  return renderToStaticMarkup(<LoginView auth={auth} onReady={vi.fn()} onGuest={vi.fn()} />);
};

describe('account entry form paths', () => {
  it('puts guest play before account forms and explains unsaved matches', () => {
    const html = render();
    expect(html.indexOf('Play as Guest')).toBeLessThan(html.indexOf('<form'));
    expect(html).toContain('Guest matches are not saved.');
  });
  it('allows guest entry without a CAPTCHA token while keeping account submission protected', () => {
    const html = render();
    const guestButton = html.match(/<button[^>]*class="guest-play-button"[^>]*>/)?.[0];
    const accountButton = html.match(/<button[^>]*class="account-submit"[^>]*>/)?.[0];
    expect(guestButton).toBeDefined();
    expect(guestButton).not.toContain('disabled');
    expect(accountButton).toContain('disabled');
    const guestPanel = html.slice(html.indexOf('<section class="guest-welcome"'), html.indexOf('<section class="account-panel"'));
    expect(guestPanel).not.toContain('turnstile-container');
    expect(html.indexOf('turnstile-container')).toBeGreaterThan(html.indexOf('<form'));
  });
  it('asks returning password users only for email and password', () => {
    const html = render();
    expect(html).toContain('id="auth-password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toContain('id="auth-username"');
    expect(html).not.toContain('id="auth-nickname"');
  });
  it('requires a new password and Username at registration', () => {
    const html = render({ authMode: 'SIGNUP' });
    expect(html).toContain('id="auth-username"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('minLength="8"');
  });
  it('does not ask code users for a password and supports one-time-code autofill', () => {
    const html = render({ loginMethod: 'CODE', authStep: 'VERIFY' });
    expect(html).not.toContain('id="auth-password"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('pattern="[0-9]{6,10}"');
  });
});
