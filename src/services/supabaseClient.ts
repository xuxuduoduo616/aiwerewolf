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

let _client: SupabaseClient | null = null;

const getClient = (): SupabaseClient => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase 未配置：请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。');
  }
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _client;
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
): Promise<SupabaseSession> => {
  const { data, error } = await getClient().auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error || !data.session || !data.user) {
    throw new Error(error?.message || '验证码无效或已过期。');
  }
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: {
      id: data.user.id,
      email: data.user.email,
    },
  };
};

// ─── Profiles ────────────────────────────────────────────────────────────────

export const upsertProfile = async (
  session: SupabaseSession,
  displayName: string,
): Promise<UserProfile> => {
  const client = getClient();
  // Set the session so RLS applies
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
