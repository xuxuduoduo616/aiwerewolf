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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);

const getClient = (): SupabaseClient => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase 未配置：请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。');
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};

// ─── Auth ────────────────────────────────────────────────────────────────────

export const requestEmailOtp = async (email: string): Promise<void> => {
  const { error } = await getClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(error.message || '验证码发送失败。');
};

export const verifyEmailOtp = async (
  email: string,
  token: string,
): Promise<{
  session: SupabaseSession;
  profile: UserProfile;
  records: GameRecord[];
}> => {
  const client = getClient();

  // Step 1: Verify the OTP code — returns a valid session
  const { data, error } = await client.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error || !data.session || !data.user) {
    throw new Error(error?.message || '验证码无效或已过期。');
  }

  const accessToken = data.session.access_token;
  const refreshToken = data.session.refresh_token || '';
  const userId = data.user.id;
  const userEmail = data.user.email || email;
  const displayName = userEmail.split('@')[0] || 'Player';

  // Step 2: Upsert profile using the freshly verified token
  const { data: profileData, error: profileErr } = await client
    .from('profiles')
    .upsert(
      {
        id: userId,
        email: userEmail,
        display_name: displayName,
      },
      { onConflict: 'id' },
    )
    .select()
    .single();

  if (profileErr) throw new Error(profileErr.message || '档案保存失败。');

  // Step 3: Fetch records using the same token
  const { data: recordData, error: recordErr } = await client
    .from('game_records')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (recordErr) throw new Error(recordErr.message || '战绩加载失败。');

  return {
    session: {
      accessToken,
      refreshToken,
      user: { id: userId, email: userEmail },
    },
    profile: toProfile(profileData),
    records: (recordData || []).map(toGameRecord),
  };
};

// ─── Profiles ────────────────────────────────────────────────────────────────

export const upsertProfile = async (
  session: SupabaseSession,
  displayName: string,
): Promise<UserProfile> => {
  const client = getClient();
  await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken || '',
  });

  const { data, error } = await client
    .from('profiles')
    .upsert(
      {
        id: session.user.id,
        email: session.user.email || '',
        display_name: displayName,
      },
      { onConflict: 'id' },
    )
    .select()
    .single();

  if (error) throw new Error(error.message || '档案保存失败。');
  return toProfile(data);
};

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

  if (error) throw new Error(error.message || '战绩加载失败。');
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

  if (error) throw new Error(error.message || '战绩保存失败。');
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

  if (error) throw new Error(error.message || '钱包数据加载失败。');

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

  if (error) throw new Error(error.message || '钱包保存失败。');
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

const toProfile = (row: Record<string, unknown>): UserProfile => ({
  id: row.id as string,
  email: row.email as string,
  displayName: (row.display_name as string) || (row.email as string)?.split('@')[0] || 'Player',
  createdAt: (row.created_at as string) || new Date().toISOString(),
});

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
