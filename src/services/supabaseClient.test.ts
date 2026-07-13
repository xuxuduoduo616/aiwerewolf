import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../types';

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

type QueryResult<T> = Promise<{ data: T; error: { message?: string } | null }>;

const loadService = async () => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  return import('./supabaseClient');
};

describe('supabaseClient', () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifies an email OTP, upserts the profile, and maps recent records', async () => {
    const profileRow = {
      id: 'user-1',
      email: 'player@example.com',
      display_name: 'player',
      created_at: '2026-07-12T10:00:00.000Z',
    };
    const recordRows = [
      {
        id: 'record-1',
        user_id: 'user-1',
        board_id: '9p-standard',
        role: Role.SEER,
        result: 'WIN',
        rounds: 4,
        summary: 'Found two wolves before the final vote.',
        created_at: '2026-07-12T11:00:00.000Z',
      },
    ];
    const profileSingle = vi.fn<() => QueryResult<typeof profileRow>>()
      .mockResolvedValue({ data: profileRow, error: null });
    const profileSelect = vi.fn(() => ({ single: profileSingle }));
    const profileUpsert = vi.fn(() => ({ select: profileSelect }));
    const recordLimit = vi.fn<() => QueryResult<typeof recordRows>>()
      .mockResolvedValue({ data: recordRows, error: null });
    const recordOrder = vi.fn(() => ({ limit: recordLimit }));
    const recordEq = vi.fn(() => ({ order: recordOrder }));
    const recordSelect = vi.fn(() => ({ eq: recordEq }));
    const from = vi.fn((table: string) => {
      if (table === 'profiles') {
        return { upsert: profileUpsert };
      }
      if (table === 'game_records') {
        return { select: recordSelect };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token',
        },
        user: {
          id: 'user-1',
          email: 'player@example.com',
        },
      },
      error: null,
    });
    createClientMock.mockReturnValue({ auth: { verifyOtp }, from });

    const { verifyEmailOtp } = await loadService();
    const result = await verifyEmailOtp('player@example.com', '123456');

    expect(createClientMock).toHaveBeenCalledWith('https://example.supabase.co', 'test-anon-key');
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'player@example.com',
      token: '123456',
      type: 'email',
    });
    expect(profileUpsert).toHaveBeenCalledWith(
      {
        id: 'user-1',
        email: 'player@example.com',
        display_name: 'player',
      },
      { onConflict: 'id' },
    );
    expect(recordEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(recordOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(recordLimit).toHaveBeenCalledWith(20);
    expect(result).toEqual({
      session: {
        accessToken: 'fresh-access-token',
        refreshToken: 'fresh-refresh-token',
        user: { id: 'user-1', email: 'player@example.com' },
      },
      profile: {
        id: 'user-1',
        email: 'player@example.com',
        displayName: 'player',
        createdAt: '2026-07-12T10:00:00.000Z',
      },
      records: [
        {
          id: 'record-1',
          userId: 'user-1',
          boardId: '9p-standard',
          role: Role.SEER,
          result: 'WIN',
          rounds: 4,
          summary: 'Found two wolves before the final vote.',
          createdAt: '2026-07-12T11:00:00.000Z',
        },
      ],
    });
  });

  it('surfaces the Supabase OTP verification error without making table calls', async () => {
    const from = vi.fn();
    const verifyOtp = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Token has expired or is invalid' },
    });
    createClientMock.mockReturnValue({ auth: { verifyOtp }, from });

    const { verifyEmailOtp } = await loadService();

    await expect(verifyEmailOtp('player@example.com', '000000'))
      .rejects.toThrow('Token has expired or is invalid');
    expect(from).not.toHaveBeenCalled();
  });
});
