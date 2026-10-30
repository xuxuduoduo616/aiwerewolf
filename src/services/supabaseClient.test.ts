import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

const loadService = async () => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  return import('./supabaseClient');
};

const session = {
  accessToken: 'fresh-access-token',
  refreshToken: 'fresh-refresh-token',
  user: { id: 'user-1', email: 'player@example.com' },
};

describe('supabaseClient identity contract', () => {
  beforeEach(() => createClientMock.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it('verifies an email OTP without claiming a profile in the same operation', async () => {
    const from = vi.fn();
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: session.accessToken, refresh_token: session.refreshToken },
        user: { id: session.user.id, email: session.user.email },
      },
      error: null,
    });
    createClientMock.mockReturnValue({ auth: { verifyOtp }, from });

    const { verifyEmailOtp } = await loadService();
    await expect(verifyEmailOtp('player@example.com', '123456')).resolves.toEqual(session);
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'player@example.com', token: '123456', type: 'email' });
    expect(from).not.toHaveBeenCalled();
  });

  it('claims canonical Username and Nickname after the verified session exists', async () => {
    const profileRow = {
      id: 'user-1', email: 'player@example.com', username: 'player_one',
      display_name: 'Village Traveler', created_at: '2026-08-28T00:00:00.000Z',
    };
    const setSession = vi.fn().mockResolvedValue({ data: {}, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const existingSelect = vi.fn(() => ({ eq }));
    const single = vi.fn().mockResolvedValue({ data: profileRow, error: null });
    const upsertSelect = vi.fn(() => ({ single }));
    const upsert = vi.fn(() => ({ select: upsertSelect }));
    const from = vi.fn(() => ({ select: existingSelect, upsert }));
    createClientMock.mockReturnValue({ auth: { setSession, getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }, from });

    const { claimProfile } = await loadService();
    await expect(claimProfile(session, ' Player_ONE ', ' Village Traveler ')).resolves.toEqual({
      id: 'user-1', email: 'player@example.com', username: 'player_one',
      nickname: 'Village Traveler', displayName: 'Village Traveler',
      createdAt: '2026-08-28T00:00:00.000Z',
    });
    expect(upsert).toHaveBeenCalledWith({
      id: 'user-1', email: 'player@example.com', username: 'player_one', display_name: 'Village Traveler',
    }, { onConflict: 'id' });
  });

  it('maps a case-equivalent unique violation to an actionable Username error', async () => {
    const setSession = vi.fn().mockResolvedValue({ data: {}, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const existingSelect = vi.fn(() => ({ eq: () => ({ maybeSingle }) }));
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    const upsert = vi.fn(() => ({ select: () => ({ single }) }));
    createClientMock.mockReturnValue({ auth: { setSession, getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }, from: () => ({ select: existingSelect, upsert }) });

    const { claimProfile } = await loadService();
    await expect(claimProfile(session, 'Taken_Name', '')).rejects.toThrow('That Username is unavailable');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ username: 'taken_name', display_name: 'taken_name' }), { onConflict: 'id' });
  });

  it('keeps invalid or expired OTP errors in the verification operation', async () => {
    const from = vi.fn();
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Token has expired or is invalid' },
    });
    createClientMock.mockReturnValue({ auth: { verifyOtp }, from });
    const { verifyEmailOtp } = await loadService();
    await expect(verifyEmailOtp('player@example.com', '000000')).rejects.toThrow('Token has expired or is invalid');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('Supabase password and OTP transport', () => {
  beforeEach(() => createClientMock.mockReset());
  afterEach(() => vi.unstubAllEnvs());
  const sdkSession = { access_token: session.accessToken, refresh_token: session.refreshToken, user: session.user };

  it('disables implicit registration on the login code path and sends CAPTCHA', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    createClientMock.mockReturnValue({ auth: { signInWithOtp } });
    const service = await loadService(); await service.requestEmailOtp('player@example.com', 'captcha');
    expect(signInWithOtp).toHaveBeenCalledWith({ email: 'player@example.com', options: { shouldCreateUser: false, captchaToken: 'captcha' } });
  });
  it('uses password auth without storing passwords in profiles or metadata', async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: sdkSession }, error: null });
    const from = vi.fn(); createClientMock.mockReturnValue({ auth: { signUp, signInWithPassword }, from });
    const service = await loadService();
    await expect(service.signUpWithPassword('player@example.com', 'test-password', 'captcha')).resolves.toBeNull();
    expect(signUp).toHaveBeenCalledWith({ email: 'player@example.com', password: 'test-password', options: { captchaToken: 'captcha' } });
    await expect(service.signInWithPassword('player@example.com', 'test-password', 'captcha')).resolves.toEqual(session);
    expect(from).not.toHaveBeenCalled(); expect(createClientMock).toHaveBeenCalledOnce();
    expect(createClientMock.mock.calls[0][2].auth.persistSession).toBe(false);
  });
  it('resends the correct signup email type and restores refreshed credentials', async () => {
    const resend = vi.fn().mockResolvedValue({ error: null });
    const setSession = vi.fn().mockResolvedValue({ data: { session: sdkSession }, error: null });
    createClientMock.mockReturnValue({ auth: { resend, setSession } });
    const service = await loadService(); await service.resendSignupCode('player@example.com', 'captcha');
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'player@example.com', options: { captchaToken: 'captcha' } });
    await expect(service.restoreAuthSession(session)).resolves.toEqual(session);
  });
  it('rejects failed session activation before reading or writing records', async () => {
    const from = vi.fn();
    const setSession = vi.fn().mockResolvedValue({ error: { message: 'Expired session' } });
    const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
    createClientMock.mockReturnValue({ auth: { getSession, setSession }, from });
    const service = await loadService(); await expect(service.fetchGameRecords(session)).rejects.toThrow('Expired session');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('bounded account network requests', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('aborts a stalled request so account failure cannot indefinitely block Guest Trial', async () => {
    vi.useFakeTimers();
    const transport = vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', transport);
    const { fetchAccountRequest } = await loadService();
    const result = fetchAccountRequest('https://example.supabase.co/auth/v1/token');
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
    expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

describe('cached session ownership', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('does not restore an old account over the newly signed-in account', async () => {
    const setSession = vi.fn(); const from = vi.fn();
    const getSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'another-account' } } } });
    createClientMock.mockReturnValue({ auth: { getSession, setSession }, from });
    const service = await loadService();
    await expect(service.fetchGameRecords(session)).rejects.toThrow('account changed');
    expect(setSession).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
});
