import { useEffect, useState } from 'react';
import type { GameRecord, SupabaseSession, UserProfile } from '../types';
import {
  fetchGameRecords,
  isSupabaseConfigured,
  requestEmailOtp,
  upsertProfile,
  verifyEmailOtp,
} from '../services/supabaseClient';

const AUTH_STORAGE_KEY = 'werewolf_auth';
const AUTH_EXPIRY_DAYS = 30;

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  displayName: string;
  expiresAt: number; // timestamp
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

const saveAuthToStorage = (session: SupabaseSession, profile: UserProfile) => {
  const data: StoredAuth = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || '',
    userId: session.user.id,
    email: profile.email,
    displayName: profile.displayName,
    expiresAt: Date.now() + AUTH_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  };
  try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data)); } catch {}
};

const loadAuthFromStorage = (): StoredAuth | null => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data: StoredAuth = JSON.parse(raw);
    if (Date.now() > data.expiresAt) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
};

const clearAuthStorage = () => {
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback;

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface AuthState {
  authEmail: string;
  setAuthEmail: (v: string) => void;
  authName: string;
  setAuthName: (v: string) => void;
  authCode: string;
  setAuthCode: (v: string) => void;
  authStep: 'EMAIL' | 'VERIFY';
  setAuthStep: (v: 'EMAIL' | 'VERIFY') => void;
  authError: string;
  isAuthLoading: boolean;
  session: SupabaseSession | null;
  profile: UserProfile | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  isRestoringSession: boolean;  // true = checking localStorage, don't show login UI yet
  handleSendOtp: () => Promise<void>;
  handleVerifyOtp: (onRecords: (records: GameRecord[]) => void) => Promise<void>;
  handleGuest: (loadLocal: () => void) => void;
  logoutAuth: () => void;
}

const useAuth = (): AuthState => {
  const [authEmail, setAuthEmail] = useState('');
  const [authName, setAuthName] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authStep, setAuthStep] = useState<'EMAIL' | 'VERIFY'>('EMAIL');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(isSupabaseConfigured());

  // Boot: try to restore saved session
  useEffect(() => {
    const stored = loadAuthFromStorage();
    if (!stored) { setIsRestoringSession(false); return; }

    const restoredSession: SupabaseSession = {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      user: { id: stored.userId, email: stored.email },
    };
    const restoredProfile: UserProfile = {
      id: stored.userId,
      email: stored.email,
      displayName: stored.displayName,
      createdAt: '',
    };

    // Verify the token is still valid by trying to fetch records
    fetchGameRecords(restoredSession)
      .then(records => {
        setSession(restoredSession);
        setProfile(restoredProfile);
        // Cue the app that records arrive with a small delay so the caller sees
        // the session first then the records
        setIsRestoringSession(false);
        return records;
      })
      .catch(() => {
        clearAuthStorage();
        setIsRestoringSession(false);
      });
  }, []);

  const isAuthenticated = Boolean(session || isGuest);

  const handleSendOtp = async () => {
    const email = authEmail.trim();
    if (!email) { setAuthError('请输入邮箱。'); return; }
    if (!isSupabaseConfigured()) {
      setAuthError('Supabase 环境变量未配置。');
      return;
    }
    setIsAuthLoading(true);
    setAuthError('');
    try {
      await requestEmailOtp(email);
      setAuthStep('VERIFY');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, '验证码发送失败。'));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (onRecords: (records: GameRecord[]) => void) => {
    if (!authCode.trim()) { setAuthError('请输入邮箱验证码。'); return; }
    setIsAuthLoading(true);
    setAuthError('');
    try {
      const result = await verifyEmailOtp(authEmail.trim(), authCode.trim());
      setSession(result.session);
      setProfile(result.profile);
      setIsGuest(false);
      saveAuthToStorage(result.session, result.profile);  // ← persist 30 days
      onRecords(result.records);
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, '登录失败。'));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleGuest = (loadLocal: () => void) => {
    setIsGuest(true);
    setSession(null);
    setProfile(null);
    setAuthError('');
    loadLocal();
  };

  const logoutAuth = () => {
    setSession(null);
    setProfile(null);
    setIsGuest(false);
    clearAuthStorage();
  };

  return {
    authEmail, setAuthEmail,
    authName, setAuthName,
    authCode, setAuthCode,
    authStep, setAuthStep,
    authError,
    isAuthLoading,
    session, profile, isGuest,
    isAuthenticated,
    isRestoringSession,
    handleSendOtp,
    handleVerifyOtp,
    handleGuest,
    logoutAuth,
  };
};

export default useAuth;
