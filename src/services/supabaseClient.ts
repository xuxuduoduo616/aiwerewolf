import { GameRecord, SupabaseSession, UserProfile } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);

const requireConfig = () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return { supabaseUrl, supabaseAnonKey };
};

const authHeaders = (token?: string) => {
  const { supabaseAnonKey } = requireConfig();
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${token || supabaseAnonKey}`,
    'Content-Type': 'application/json',
  };
};

export const requestEmailOtp = async (email: string) => {
  const { supabaseUrl } = requireConfig();
  const res = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      create_user: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to send verification code.');
  }
};

export const verifyEmailOtp = async (email: string, token: string): Promise<SupabaseSession> => {
  const { supabaseUrl } = requireConfig();
  const res = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      token,
      type: 'email',
    }),
  });

  const json = await res.json();
  if (!res.ok || !json.access_token || !json.user) {
    throw new Error(json.error_description || json.msg || 'Invalid verification code.');
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    user: {
      id: json.user.id,
      email: json.user.email,
    },
  };
};

export const upsertProfile = async (session: SupabaseSession, displayName: string) => {
  const { supabaseUrl } = requireConfig();
  const profile = {
    id: session.user.id,
    email: session.user.email || '',
    display_name: displayName,
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      ...authHeaders(session.accessToken),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(profile),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || 'Failed to save profile.');
  }

  const row = Array.isArray(json) ? json[0] : json;
  return toProfile(row);
};

export const fetchGameRecords = async (session: SupabaseSession): Promise<GameRecord[]> => {
  const { supabaseUrl } = requireConfig();
  const params = new URLSearchParams({
    user_id: `eq.${session.user.id}`,
    order: 'created_at.desc',
    limit: '20',
  });

  const res = await fetch(`${supabaseUrl}/rest/v1/game_records?${params.toString()}`, {
    headers: authHeaders(session.accessToken),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || 'Failed to load game records.');
  }

  return Array.isArray(json) ? json.map(toGameRecord) : [];
};

export const saveGameRecord = async (
  session: SupabaseSession,
  record: Omit<GameRecord, 'id' | 'createdAt'>
) => {
  const { supabaseUrl } = requireConfig();
  const res = await fetch(`${supabaseUrl}/rest/v1/game_records`, {
    method: 'POST',
    headers: {
      ...authHeaders(session.accessToken),
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      user_id: record.userId,
      board_id: record.boardId,
      role: record.role,
      result: record.result,
      rounds: record.rounds,
      summary: record.summary,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message || 'Failed to save game record.');
  }

  const row = Array.isArray(json) ? json[0] : json;
  return toGameRecord(row);
};

const toProfile = (row: any): UserProfile => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name || row.email?.split('@')[0] || 'Player',
  createdAt: row.created_at || new Date().toISOString(),
});

const toGameRecord = (row: any): GameRecord => ({
  id: row.id,
  userId: row.user_id,
  boardId: row.board_id,
  role: row.role,
  result: row.result,
  rounds: row.rounds,
  summary: row.summary,
  createdAt: row.created_at || new Date().toISOString(),
});
