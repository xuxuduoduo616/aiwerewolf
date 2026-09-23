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
    createClientMock.mockReturnValue({ auth: { setSession }, from });

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
    createClientMock.mockReturnValue({ auth: { setSession }, from: () => ({ select: existingSelect, upsert }) });

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
