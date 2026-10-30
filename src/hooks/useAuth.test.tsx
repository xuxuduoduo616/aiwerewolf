import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../types';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effectCursor: 0,
  effectsRun: new Set<number>(),
}));

vi.mock('react', () => ({
  useRef: <T,>(initial: T) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index] as { current: T };
  },
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    const setValue = (next: T | ((previous: T) => T)) => {
      const previous = hooks.values[index] as T;
      hooks.values[index] = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
    };
    return [hooks.values[index] as T, setValue] as const;
  },
  useEffect: (effect: () => void | (() => void)) => {
    const index = hooks.effectCursor++;
    if (!hooks.effectsRun.has(index)) {
      hooks.effectsRun.add(index);
      effect();
    }
  },
}));

const service = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => true),
  requestEmailOtp: vi.fn(),
  subscribeToAuthRefresh: vi.fn(),
  clearClientSession: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInWithPassword: vi.fn(),
  resendSignupCode: vi.fn(),
  restoreAuthSession: vi.fn(),
  ProfileIncompleteError: class extends Error {},
  verifyEmailOtp: vi.fn(),
  claimProfile: vi.fn(),
  fetchProfile: vi.fn(),
  fetchGameRecords: vi.fn(),
}));

vi.mock('../services/supabaseClient', () => service);

import useAuth, { type AuthState } from './useAuth';

const session = {
  accessToken: 'access', refreshToken: 'refresh',
  user: { id: 'account-a', email: 'player@example.com' },
};
const profile: UserProfile = {
  id: 'account-a', email: 'player@example.com', username: 'available_name',
  nickname: 'Available Name', displayName: 'Available Name', createdAt: '2026-08-28T00:00:00.000Z',
};

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: key => values.get(key) ?? null,
  key: index => [...values.keys()][index] ?? null,
  removeItem: key => { values.delete(key); },
  setItem: (key, value) => { values.set(key, value); },
};

const renderHook = (): AuthState => {
  hooks.cursor = 0;
  hooks.effectCursor = 0;
  return useAuth();
};

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.effectCursor = 0;
  hooks.effectsRun.clear();
  values.clear();
  vi.stubGlobal('localStorage', storage);
  Object.values(service).forEach(mock => { if (vi.isMockFunction(mock)) mock.mockReset(); });
  service.isSupabaseConfigured.mockReturnValue(true);
  service.requestEmailOtp.mockResolvedValue(undefined);
  service.signUpWithPassword.mockResolvedValue(null);
  service.signInWithPassword.mockResolvedValue(session);
  service.restoreAuthSession.mockResolvedValue(session);
  service.verifyEmailOtp.mockResolvedValue(session);
  service.claimProfile.mockResolvedValue(profile);
  service.fetchProfile.mockResolvedValue(profile);
  service.fetchGameRecords.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe('useAuth state machine', () => {
  it('rejects a legacy auth cache that has no Username instead of authenticating', () => {
    storage.setItem('werewolf_auth', JSON.stringify({
      accessToken: 'legacy', refreshToken: 'legacy', userId: 'account-a',
      email: 'player@example.com', displayName: 'player', expiresAt: Date.now() + 60_000,
    }));
    let auth = renderHook();
    auth = renderHook();
    expect(auth.isAuthenticated).toBe(false);
    expect(service.fetchProfile).not.toHaveBeenCalled();
    expect(storage.getItem('werewolf_auth')).toBeNull();
  });

  it('cannot enter VERIFY before a valid Username and successful code request', async () => {
    let auth = renderHook();
    auth.setAuthMode('SIGNUP');
    auth.setAuthPassword('test-password');
    auth.setAuthEmail('player@example.com');
    auth.setAuthUsername('ab');
    auth = renderHook();
    await auth.handleSignUp(vi.fn());
    auth = renderHook();
    expect(auth.authStep).toBe('EMAIL');
    expect(auth.authError).toContain('3-40');
    expect(auth.authErrorField).toBe('username');
    expect(service.signUpWithPassword).not.toHaveBeenCalled();

    auth.setAuthUsername('Player_One');
    auth = renderHook();
    await auth.handleSignUp(vi.fn());
    auth = renderHook();
    expect(auth.authStep).toBe('VERIFY');
    expect(service.signUpWithPassword).toHaveBeenCalledTimes(1);
  });

  it('retains the verified session for duplicate Username retry without verifying OTP twice', async () => {
    service.claimProfile
      .mockRejectedValueOnce(new Error('That Username is unavailable. Choose another Username.'))
      .mockResolvedValueOnce(profile);
    const onRecords = vi.fn();
    let auth = renderHook();
    auth.setAuthMode('SIGNUP');
    auth.setAuthPassword('test-password');
    auth.setAuthEmail('player@example.com');
    auth.setAuthUsername('Taken_Name');
    auth = renderHook();
    await auth.handleSignUp(vi.fn());
    auth = renderHook();
    auth.setAuthCode('123456');
    auth = renderHook();
    await auth.handleVerifyOtp(onRecords);
    auth = renderHook();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.isIdentityCompletionPending).toBe(true);
    expect(auth.authErrorField).toBe('username');

    auth.setAuthUsername('Available_Name');
    auth = renderHook();
    await auth.handleVerifyOtp(onRecords);
    auth = renderHook();
    expect(service.verifyEmailOtp).toHaveBeenCalledTimes(1);
    expect(service.claimProfile).toHaveBeenCalledTimes(2);
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.profile?.username).toBe('available_name');
    expect(onRecords).toHaveBeenCalledTimes(1);
  });

  it('Change email clears pending verified state and consumed code', async () => {
    service.claimProfile.mockRejectedValueOnce(new Error('That Username is unavailable. Choose another Username.'));
    let auth = renderHook();
    auth.setAuthMode('SIGNUP');
    auth.setAuthPassword('test-password');
    auth.setAuthEmail('player@example.com');
    auth.setAuthUsername('taken_name');
    auth = renderHook();
    await auth.handleSignUp(vi.fn());
    auth = renderHook();
    auth.setAuthCode('123456');
    auth = renderHook();
    await auth.handleVerifyOtp(vi.fn());
    auth = renderHook();
    expect(auth.isIdentityCompletionPending).toBe(true);
    auth.handleChangeEmail();
    auth = renderHook();
    expect(auth.authStep).toBe('EMAIL');
    expect(auth.authCode).toBe('');
    expect(auth.isIdentityCompletionPending).toBe(false);
  });

  it('restores the same browser-profile Guest ID after leaving for auth', () => {
    let auth = renderHook();
    let first = '';
    auth.handleGuest(identity => { first = identity.id; });
    auth = renderHook();
    expect(auth.isGuest).toBe(true);
    auth.leaveGuestForAuth();
    auth = renderHook();
    expect(auth.isAuthenticated).toBe(false);
    let restored = '';
    auth.handleGuest(identity => { restored = identity.id; });
    expect(restored).toBe(first);
  });

  it('does not leak account A identity or network state through guest into account B', async () => {
    const profileA: UserProfile = {
      ...profile,
      id: 'account-a',
      email: 'a@example.com',
      username: 'account_a',
      nickname: 'Account A',
      displayName: 'Account A',
    };
    const profileB: UserProfile = {
      ...profile,
      id: 'account-b',
      email: 'b@example.com',
      username: 'account_b',
      nickname: 'Account B',
      displayName: 'Account B',
    };
    const sessionA = { ...session, user: { id: 'account-a', email: 'a@example.com' } };
    const sessionB = { ...session, user: { id: 'account-b', email: 'b@example.com' } };
    service.verifyEmailOtp.mockResolvedValueOnce(sessionA).mockResolvedValueOnce(sessionB);
    service.claimProfile.mockResolvedValueOnce(profileA).mockResolvedValueOnce(profileB);

    let auth = renderHook();
    auth.setAuthMode('SIGNUP');
    auth.setAuthPassword('test-password');
    auth.setAuthEmail('a@example.com');
    auth.setAuthUsername('account_a');
    auth = renderHook();
    await auth.handleSignUp(vi.fn());
    auth = renderHook();
    auth.setAuthCode('111111');
    auth = renderHook();
    await auth.handleVerifyOtp(vi.fn());
    auth = renderHook();
    expect(auth.profile?.username).toBe('account_a');

    const accountRequestsBeforeGuest = service.fetchGameRecords.mock.calls.length;
    let guestId = '';
    auth.handleGuest(identity => { guestId = identity.id; });
    auth = renderHook();
    expect(auth.isGuest).toBe(true);
    expect(auth.session).toBeNull();
    expect(auth.profile).toBeNull();
    expect(service.fetchGameRecords).toHaveBeenCalledTimes(accountRequestsBeforeGuest);

    auth.leaveGuestForAuth();
    auth = renderHook();
    auth.setAuthMode('SIGNUP');
    auth.setAuthPassword('test-password');
    auth.setAuthEmail('b@example.com');
    auth.setAuthUsername('account_b');
    auth = renderHook();
    await auth.handleSignUp(vi.fn());
    auth = renderHook();
    auth.setAuthCode('222222');
    auth = renderHook();
    await auth.handleVerifyOtp(vi.fn());
    auth = renderHook();

    expect(auth.isGuest).toBe(false);
    expect(auth.session?.user.id).toBe('account-b');
    expect(auth.profile?.username).toBe('account_b');
    expect(auth.profile?.nickname).toBe('Account B');
    expect(JSON.stringify(service.claimProfile.mock.calls)).not.toContain(guestId);
    expect(service.fetchGameRecords.mock.calls.map(([requested]) => requested.user.id)).toEqual(['account-a', 'account-b']);
  });
});

describe('password and code account access', () => {
  it('logs in with a password without asking for or rewriting a Username', async () => {
    let auth = renderHook();
    auth.setAuthEmail('player@example.com'); auth.setAuthPassword('test-password'); auth = renderHook();
    const ready = vi.fn();
    await auth.handlePasswordLogin(ready, 'captcha'); auth = renderHook();
    expect(service.signInWithPassword).toHaveBeenCalledWith('player@example.com', 'test-password', 'captcha');
    expect(service.claimProfile).not.toHaveBeenCalled();
    expect(auth.isAuthenticated).toBe(true); expect(auth.authPassword).toBe('');
    expect(ready).toHaveBeenCalledWith([]);
    expect(storage.getItem('werewolf_auth')).not.toContain('test-password');
  });

  it('logs an existing user in with a code and no identity inputs', async () => {
    let auth = renderHook(); auth.setLoginMethod('CODE'); auth.setAuthEmail('player@example.com'); auth = renderHook();
    await auth.handleSendOtp('captcha'); auth = renderHook();
    expect(service.requestEmailOtp).toHaveBeenCalledWith('player@example.com', 'captcha');
    auth.setAuthCode('123456'); auth = renderHook();
    await auth.handleVerifyOtp(vi.fn()); auth = renderHook();
    expect(auth.isAuthenticated).toBe(true); expect(service.claimProfile).not.toHaveBeenCalled();
  });

  it('requires a signup password and never sends it as profile metadata', async () => {
    let auth = renderHook(); auth.setAuthMode('SIGNUP'); auth.setAuthEmail('player@example.com');
    auth.setAuthUsername('new_player'); auth.setAuthPassword('short'); auth = renderHook();
    await auth.handleSignUp(vi.fn(), 'captcha'); auth = renderHook();
    expect(auth.authErrorField).toBe('password'); expect(service.signUpWithPassword).not.toHaveBeenCalled();
    auth.setAuthPassword('test-password'); auth = renderHook(); await auth.handleSignUp(vi.fn(), 'captcha'); auth = renderHook();
    expect(auth.authStep).toBe('VERIFY'); expect(auth.isAuthenticated).toBe(false);
    expect(auth.authPassword).toBe(''); expect(service.claimProfile).not.toHaveBeenCalled();
    expect(storage.getItem('werewolf_auth')).toBeNull();
    await auth.handleSendOtp('fresh-captcha');
    expect(service.resendSignupCode).toHaveBeenCalledWith('player@example.com', 'fresh-captcha');
    expect(service.requestEmailOtp).not.toHaveBeenCalled();
  });

  it('supports signup when the provider immediately returns a session', async () => {
    service.signUpWithPassword.mockResolvedValueOnce(session);
    let auth = renderHook(); auth.setAuthMode('SIGNUP'); auth.setAuthEmail('player@example.com');
    auth.setAuthUsername('new_player'); auth.setAuthPassword('test-password'); auth = renderHook();
    await auth.handleSignUp(vi.fn()); auth = renderHook();
    expect(auth.isAuthenticated).toBe(true); expect(service.verifyEmailOtp).not.toHaveBeenCalled();
    expect(service.claimProfile).toHaveBeenCalledWith(session, 'new_player', 'new_player');
  });

  it('keeps a verified login retryable when record loading fails', async () => {
    service.fetchGameRecords.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    let auth = renderHook(); auth.setAuthEmail('player@example.com'); auth.setAuthCode('123456'); auth = renderHook();
    await auth.handleVerifyOtp(vi.fn()); auth = renderHook();
    expect(auth.isAuthenticated).toBe(false); expect(auth.authError).toContain('Guest Trial');
    await auth.handleVerifyOtp(vi.fn()); auth = renderHook();
    expect(service.verifyEmailOtp).toHaveBeenCalledOnce(); expect(auth.isAuthenticated).toBe(true);
    expect(service.claimProfile).not.toHaveBeenCalled();
  });

  it('finishes a missing profile only after authentication', async () => {
    service.fetchProfile.mockRejectedValueOnce(new service.ProfileIncompleteError());
    let auth = renderHook(); auth.setAuthEmail('player@example.com'); auth.setAuthPassword('test-password'); auth = renderHook();
    await auth.handlePasswordLogin(vi.fn()); auth = renderHook();
    expect(auth.needsIdentity).toBe(true); expect(auth.isAuthenticated).toBe(false);
    auth.setAuthUsername('new_player'); auth = renderHook(); await auth.handleVerifyOtp(vi.fn()); auth = renderHook();
    expect(auth.isAuthenticated).toBe(true); expect(service.signInWithPassword).toHaveBeenCalledOnce();
    expect(service.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('does not authenticate on invalid credentials and clears passwords when switching methods', async () => {
    service.signInWithPassword.mockRejectedValueOnce(new Error('Invalid login credentials'));
    let auth = renderHook(); auth.setAuthEmail('player@example.com'); auth.setAuthPassword('bad-password'); auth = renderHook();
    await auth.handlePasswordLogin(vi.fn()); auth = renderHook();
    expect(auth.isAuthenticated).toBe(false); expect(auth.authError).toContain('verification code');
    expect(service.fetchProfile).not.toHaveBeenCalled();
    auth.setLoginMethod('CODE'); auth = renderHook(); expect(auth.authPassword).toBe('');
  });

  it('does not load account records after entering guest mode while the profile is loading', async () => {
    let resolveProfile!: (value: UserProfile) => void;
    service.fetchProfile.mockReturnValueOnce(new Promise(done => { resolveProfile = done; }));
    let auth = renderHook();
    auth.setAuthEmail('player@example.com'); auth.setAuthPassword('test-password'); auth = renderHook();
    const ready = vi.fn(); const pending = auth.handlePasswordLogin(ready);
    await Promise.resolve();
    expect(service.fetchProfile).toHaveBeenCalledOnce();
    auth.handleGuest(vi.fn());
    resolveProfile(profile); await pending; auth = renderHook();
    expect(auth.isGuest).toBe(true); expect(auth.session).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    expect(service.fetchGameRecords).not.toHaveBeenCalled();
    expect(storage.getItem('werewolf_auth')).toBeNull();
  });

  it('deduplicates submissions and ignores an in-flight account login after entering guest mode', async () => {
    let resolve!: (value: typeof session) => void;
    service.signInWithPassword.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let auth = renderHook(); auth.setAuthEmail('player@example.com'); auth.setAuthPassword('test-password'); auth = renderHook();
    const ready = vi.fn(); const pending = auth.handlePasswordLogin(ready);
    await auth.handlePasswordLogin(ready); expect(service.signInWithPassword).toHaveBeenCalledOnce();
    auth.handleGuest(vi.fn()); resolve(session); await pending; auth = renderHook();
    expect(auth.isGuest).toBe(true); expect(auth.session).toBeNull(); expect(ready).not.toHaveBeenCalled();
    expect(service.clearClientSession).toHaveBeenCalledOnce(); expect(storage.getItem('werewolf_auth')).toBeNull();
  });
});
