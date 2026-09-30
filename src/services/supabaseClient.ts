/**
 * Supabase client — uses official @supabase/supabase-js SDK v2.
 * Supports both legacy anon key (eyJ...) and new publishable key (sb_publishable_...).
 *
 * Env vars required:
 *   VITE_SUPABASE_URL  — e.g. https://xxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY — anon/publishable key
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { GameRecord, SupabaseSession, UserProfile } from '../types';
import { normalizeNickname, validateUsername } from '../identity/publicIdentity';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);

const getClient = (): SupabaseClient => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};

// ─── Auth ────────────────────────────────────────────────────────────────────

export const requestEmailOtp = async (email: string): Promise<void> => {
  const { error } = await getClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(error.message || 'Could not send the verification code.');
};

export const verifyEmailOtp = async (
  email: string,
  token: string,
): Promise<SupabaseSession> => {
  const client = getClient();

  // Step 1: Verify the OTP code — returns a valid session
  const { data, error } = await client.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error || !data.session || !data.user) {
    throw new Error(error?.message || 'The verification code is invalid or expired.');
  }

  const accessToken = data.session.access_token;
  const refreshToken = data.session.refresh_token || '';
  const userId = data.user.id;
  const userEmail = data.user.email || email;
  return {
    accessToken,
    refreshToken,
    user: { id: userId, email: userEmail },
  };
};

// ─── Profiles ────────────────────────────────────────────────────────────────

export class UsernameUnavailableError extends Error {
  constructor() {
    super('That Username is unavailable. Choose another Username.');
    this.name = 'UsernameUnavailableError';
  }
}

const activateSession = async (client: SupabaseClient, session: SupabaseSession): Promise<void> => {
  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken || '',
  });
  if (error) throw new Error(error.message || 'Could not restore the authenticated session.');
};

export const fetchProfile = async (session: SupabaseSession): Promise<UserProfile> => {
  const client = getClient();
  await activateSession(client, session);
  const { data, error } = await client
    .from('profiles')
    .select('id, email, username, display_name, created_at')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not load the profile.');
  if (!data) throw new Error('Complete your Username before entering the lobby.');
  return toProfile(data);
};

export const claimProfile = async (
  session: SupabaseSession,
  usernameInput: string,
  nicknameInput: string,
): Promise<UserProfile> => {
  const username = validateUsername(usernameInput);
  if (!username.valid) throw new Error(username.error);
  const nickname = normalizeNickname(nicknameInput, username.value);
  if (!nickname.valid) throw new Error(nickname.error);

  const client = getClient();
  await activateSession(client, session);

  const { data: existing, error: existingError } = await client
    .from('profiles')
    .select('id, email, username, display_name, created_at')
    .eq('id', session.user.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message || 'Could not load the profile.');
  if (existing) return toProfile(existing);

  const { data, error } = await client
    .from('profiles')
    .upsert(
      {
        id: session.user.id,
        email: session.user.email || '',
        username: username.value,
        display_name: nickname.value,
      },
      { onConflict: 'id' },
    )
    .select()
    .single();

  if (error?.code === '23505') throw new UsernameUnavailableError();
  if (error) throw new Error(error.message || 'Could not save the profile.');
  return toProfile(data);
};

/** @deprecated Use claimProfile so Username and Nickname are persisted atomically. */
export const upsertProfile = claimProfile;

// ─── Game records ─────────────────────────────────────────────────────────────

export const fetchGameRecords = async (
  session: SupabaseSession,
): Promise<GameRecord[]> => {
  const client = getClient();
  await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken || '',
  });

  const { data, error } = await client
    .from('game_records')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message || 'Could not load game records.');
  return (data || []).map(toGameRecord);
};

export const saveGameRecord = async (
  session: SupabaseSession,
  record: Omit<GameRecord, 'id' | 'createdAt'>,
): Promise<GameRecord> => {
  const client = getClient();
  await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken || '',
  });

  const { data, error } = await client
    .from('game_records')
    .insert({
      user_id: record.userId,
      board_id: record.boardId,
      role: record.role,
      result: record.result,
      rounds: record.rounds,
      summary: record.summary,
    })
    .select()
    .single();

  if (error) throw new Error(error.message || 'Could not save the game record.');
  return toGameRecord(data);
};

// ─── Wallet / user_coins ──────────────────────────────────────────────────────

export interface UserCoins {
  coins: number;
  coupons: number;
  crystals: number;
  totalPurchasedCoins: number;
}

export const fetchUserCoins = async (
  session: SupabaseSession,
): Promise<UserCoins> => {
  const client = getClient();
  await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken || '',
  });

  const { data, error } = await client
    .from('user_coins')
    .select('coins, coupons, crystals, total_purchased_coins')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Could not load wallet data.');

  return {
    coins: (data?.coins as number) ?? 0,
    coupons: (data?.coupons as number) ?? 0,
    crystals: (data?.crystals as number) ?? 0,
    totalPurchasedCoins: (data?.total_purchased_coins as number) ?? 0,
  };
};

export const upsertUserCoins = async (
  session: SupabaseSession,
  coins: UserCoins,
): Promise<void> => {
  const client = getClient();
  await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken || '',
  });

  const { error } = await client
    .from('user_coins')
    .upsert(
      {
        user_id: session.user.id,
        coins: coins.coins,
        coupons: coins.coupons,
        crystals: coins.crystals,
        total_purchased_coins: coins.totalPurchasedCoins,
      },
      { onConflict: 'user_id' },
    );

  if (error) throw new Error(error.message || 'Could not save wallet data.');
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

const toProfile = (row: Record<string, unknown>): UserProfile => ({
  ...mapProfileIdentity(row),
  id: row.id as string,
  email: row.email as string,
  createdAt: (row.created_at as string) || new Date().toISOString(),
});

const mapProfileIdentity = (row: Record<string, unknown>): Pick<UserProfile, 'username' | 'nickname' | 'displayName'> => {
  const username = validateUsername(typeof row.username === 'string' ? row.username : '');
  if (!username.valid) throw new Error('Profile identity is incomplete. Complete your Username before entering the lobby.');
  const nickname = normalizeNickname(typeof row.display_name === 'string' ? row.display_name : '', username.value);
  if (!nickname.valid) throw new Error('Profile identity is incomplete. Complete your Nickname before entering the lobby.');
  return { username: username.value, nickname: nickname.value, displayName: nickname.value };
};

const toGameRecord = (row: Record<string, unknown>): GameRecord => ({
  id: row.id as string,
  userId: row.user_id as string,
  boardId: row.board_id as GameRecord['boardId'],
  role: row.role as GameRecord['role'],
  result: row.result as 'WIN' | 'LOSE',
  rounds: row.rounds as number,
  summary: row.summary as string,
  createdAt: (row.created_at as string) || new Date().toISOString(),
});
