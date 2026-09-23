import { useEffect, useState } from 'react';
import type { GameRecord, SupabaseSession, UserProfile } from '../types';
import {
  claimProfile,
  fetchGameRecords,
  fetchProfile,
  isSupabaseConfigured,
  requestEmailOtp,
  verifyEmailOtp,
} from '../services/supabaseClient';
import {
  loadOrCreateGuestIdentity,
  normalizeNickname,
  validateUsername,
  type GuestIdentity,
} from '../identity/publicIdentity';

const AUTH_STORAGE_KEY = 'werewolf_auth';
const AUTH_STORAGE_VERSION = 2 as const;
const AUTH_EXPIRY_DAYS = 30;

interface StoredAuthV2 {
  version: typeof AUTH_STORAGE_VERSION;
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  username: string;
  nickname: string;
  expiresAt: number;
}

const saveAuthToStorage = (session: SupabaseSession, profile: UserProfile) => {
  const data: StoredAuthV2 = {
    version: AUTH_STORAGE_VERSION,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || '',
    userId: session.user.id,
    email: profile.email,
    username: profile.username,
    nickname: profile.nickname,
    expiresAt: Date.now() + AUTH_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  };
  try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data)); } catch {}
};

const loadAuthFromStorage = (): StoredAuthV2 | null => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredAuthV2>;
    const username = validateUsername(typeof data.username === 'string' ? data.username : '');
    const nickname = normalizeNickname(typeof data.nickname === 'string' ? data.nickname : '', username.value);
    if (
      data.version !== AUTH_STORAGE_VERSION
      || typeof data.accessToken !== 'string'
      || typeof data.refreshToken !== 'string'
      || typeof data.userId !== 'string'
      || typeof data.email !== 'string'
      || typeof data.expiresAt !== 'number'
      || !username.valid
      || !nickname.valid
      || Date.now() > data.expiresAt
    ) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return data as StoredAuthV2;
  } catch {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
    return null;
  }
};

const clearAuthStorage = () => {
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
};

const getBrowserStorage = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message || fallback : fallback;

class IdentityInputError extends Error {
  constructor(public readonly field: 'username' | 'nickname', message: string) {
    super(message);
  }
}

export interface AuthState {
  authEmail: string;
  setAuthEmail: (v: string) => void;
  authUsername: string;
  setAuthUsername: (v: string) => void;
  authNickname: string;
  setAuthNickname: (v: string) => void;
  authCode: string;
  setAuthCode: (v: string) => void;
  authStep: 'EMAIL' | 'VERIFY';
  authError: string;
  authErrorField: 'email' | 'username' | 'nickname' | 'code' | null;
  isAuthLoading: boolean;
  isIdentityCompletionPending: boolean;
  session: SupabaseSession | null;
  profile: UserProfile | null;
  guestIdentity: GuestIdentity | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  isRestoringSession: boolean;
  handleSendOtp: () => Promise<void>;
  handleVerifyOtp: (onRecords: (records: GameRecord[]) => void) => Promise<void>;
  handleChangeEmail: () => void;
  handleGuest: (onReady: (identity: GuestIdentity) => void) => void;
  leaveGuestForAuth: () => void;
  logoutAuth: () => void;
}

const useAuth = (): AuthState => {
  const [authEmail, setAuthEmail] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authNickname, setAuthNickname] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [authStep, setAuthStep] = useState<'EMAIL' | 'VERIFY'>('EMAIL');
  const [authError, setAuthError] = useState('');
  const [authErrorField, setAuthErrorField] = useState<AuthState['authErrorField']>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [pendingVerifiedSession, setPendingVerifiedSession] = useState<SupabaseSession | null>(null);
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [guestIdentity, setGuestIdentity] = useState<GuestIdentity | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(isSupabaseConfigured());

  useEffect(() => {
    const stored = loadAuthFromStorage();
    if (!stored) { setIsRestoringSession(false); return; }
    const restoredSession: SupabaseSession = {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      user: { id: stored.userId, email: stored.email },
    };
    Promise.all([fetchProfile(restoredSession), fetchGameRecords(restoredSession)])
      .then(([freshProfile]) => {
        setSession(restoredSession);
        setProfile(freshProfile);
        saveAuthToStorage(restoredSession, freshProfile);
        setIsRestoringSession(false);
      })
      .catch(() => {
        clearAuthStorage();
        setIsRestoringSession(false);
      });
  }, []);

  const isAuthenticated = Boolean((session && profile) || (isGuest && guestIdentity));

  const validatedIdentity = () => {
    const username = validateUsername(authUsername);
    if (!username.valid) throw new IdentityInputError('username', username.error);
    const nickname = normalizeNickname(authNickname, username.value);
    if (!nickname.valid) throw new IdentityInputError('nickname', nickname.error);
    return { username: username.value, nickname: nickname.value };
  };

  const handleSendOtp = async () => {
    const email = authEmail.trim();
    if (!email) { setAuthError('Enter your email address.'); setAuthErrorField('email'); return; }
    try {
      const identity = validatedIdentity();
      setAuthUsername(identity.username);
      setAuthNickname(authNickname.trim());
    } catch (error) {
      setAuthError(getErrorMessage(error, 'Enter a valid Username.'));
      setAuthErrorField(error instanceof IdentityInputError ? error.field : 'username');
      return;
    }
    if (!isSupabaseConfigured()) {
      setAuthError('Supabase environment variables are not configured.');
      setAuthErrorField('email');
      return;
    }
    setIsAuthLoading(true);
    setAuthError('');
    setAuthErrorField(null);
    try {
      await requestEmailOtp(email);
      setAuthStep('VERIFY');
    } catch (error: unknown) {
      setAuthError(getErrorMessage(error, 'Could not send the verification code.'));
      setAuthErrorField('email');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (onRecords: (records: GameRecord[]) => void) => {
    if (!pendingVerifiedSession && !authCode.trim()) {
      setAuthError('Enter the email verification code.');
      setAuthErrorField('code');
      return;
    }
    let identity: ReturnType<typeof validatedIdentity>;
    try {
      identity = validatedIdentity();
    } catch (error) {
      setAuthError(getErrorMessage(error, 'Enter a valid public identity.'));
      setAuthErrorField(error instanceof IdentityInputError ? error.field : 'username');
      return;
    }

    setIsAuthLoading(true);
    setAuthError('');
    setAuthErrorField(null);
    let verifiedForRetry = pendingVerifiedSession;
    try {
      const verified = pendingVerifiedSession
        ?? await verifyEmailOtp(authEmail.trim(), authCode.trim());
      verifiedForRetry = verified;
      if (!pendingVerifiedSession) setPendingVerifiedSession(verified);
      const nextProfile = await claimProfile(verified, identity.username, identity.nickname);
      const records = await fetchGameRecords(verified);
      setSession(verified);
      setProfile(nextProfile);
      setIsGuest(false);
      setGuestIdentity(null);
      setPendingVerifiedSession(null);
      saveAuthToStorage(verified, nextProfile);
      onRecords(records);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Login failed.');
      setAuthError(message);
      setAuthErrorField(verifiedForRetry ? 'username' : 'code');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleChangeEmail = () => {
    setPendingVerifiedSession(null);
    setAuthCode('');
    setAuthError('');
    setAuthErrorField(null);
    setAuthStep('EMAIL');
  };

  const handleGuest = (onReady: (identity: GuestIdentity) => void) => {
    const identity = loadOrCreateGuestIdentity(getBrowserStorage());
    if (!identity) {
      setAuthError('A Guest ID could not be created in this browser.');
      setAuthErrorField(null);
      return;
    }
    setGuestIdentity(identity);
    setIsGuest(true);
    setSession(null);
    setProfile(null);
    setPendingVerifiedSession(null);
    setAuthError(identity.persistent ? '' : 'Guest ID is available for this tab only because local storage is unavailable.');
    setAuthErrorField(null);
    onReady(identity);
  };

  const leaveGuestForAuth = () => {
    setIsGuest(false);
    setGuestIdentity(null);
    setSession(null);
    setProfile(null);
    setAuthError('');
    setAuthErrorField(null);
    setAuthCode('');
    setAuthStep('EMAIL');
  };

  const logoutAuth = () => {
    setSession(null);
    setProfile(null);
    setIsGuest(false);
    setGuestIdentity(null);
    setPendingVerifiedSession(null);
    setAuthCode('');
    setAuthError('');
    setAuthErrorField(null);
    setAuthStep('EMAIL');
    clearAuthStorage();
  };

  return {
    authEmail, setAuthEmail,
    authUsername, setAuthUsername,
    authNickname, setAuthNickname,
    authCode, setAuthCode,
    authStep,
    authError,
    authErrorField,
    isAuthLoading,
    isIdentityCompletionPending: Boolean(pendingVerifiedSession),
    session, profile, guestIdentity, isGuest,
    isAuthenticated,
    isRestoringSession,
    handleSendOtp,
    handleVerifyOtp,
    handleChangeEmail,
    handleGuest,
    leaveGuestForAuth,
    logoutAuth,
  };
};

export default useAuth;
