import { useEffect, useRef, useState } from 'react';
import type { GameRecord, SupabaseSession, UserProfile } from '../types';
import {
  claimProfile,
  fetchGameRecords,
  fetchProfile,
  isSupabaseConfigured,
  requestEmailOtp,
  signUpWithPassword,
  signInWithPassword,
  resendSignupCode,
  restoreAuthSession,
  ProfileIncompleteError,
  subscribeToAuthRefresh,
  clearClientSession,
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

export const getAuthErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : fallback;
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out/i.test(message)) {
    return 'Unable to reach the account service. Check your connection and try again. You can still use Guest Trial.';
  }
  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect. You can also log in with a verification code.';
  if (/email not confirmed/i.test(message)) return 'Please verify your email first. Select Verification code to request a new code.';
  if (/rate limit|too many requests|security purposes/i.test(message)) return 'Too many attempts. Please wait a minute before trying again.';
  return message || fallback;
};

class IdentityInputError extends Error {
  constructor(public readonly field: 'username' | 'nickname', message: string) { super(message); }
}

type AuthMode = 'LOGIN' | 'SIGNUP';
type LoginMethod = 'PASSWORD' | 'CODE';
type AuthField = 'email' | 'username' | 'nickname' | 'code' | 'password';

export interface AuthState {
  authEmail: string; setAuthEmail: (v: string) => void;
  authUsername: string; setAuthUsername: (v: string) => void;
  authNickname: string; setAuthNickname: (v: string) => void;
  authCode: string; setAuthCode: (v: string) => void;
  authPassword: string; setAuthPassword: (v: string) => void;
  authMode: AuthMode; setAuthMode: (v: AuthMode) => void;
  loginMethod: LoginMethod; setLoginMethod: (v: LoginMethod) => void;
  authStep: 'EMAIL' | 'VERIFY';
  authError: string;
  authErrorField: AuthField | null;
  isAuthLoading: boolean;
  isIdentityCompletionPending: boolean;
  needsIdentity: boolean;
  session: SupabaseSession | null;
  profile: UserProfile | null;
  guestIdentity: GuestIdentity | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  isRestoringSession: boolean;
  handleSendOtp: (captchaToken?: string) => Promise<void>;
  handleSignUp: (onRecords: (records: GameRecord[]) => void, captchaToken?: string) => Promise<void>;
  handlePasswordLogin: (onRecords: (records: GameRecord[]) => void, captchaToken?: string) => Promise<void>;
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
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setMode] = useState<AuthMode>('LOGIN');
  const [loginMethod, setMethod] = useState<LoginMethod>('PASSWORD');
  const [authStep, setAuthStep] = useState<'EMAIL' | 'VERIFY'>('EMAIL');
  const [authError, setAuthError] = useState('');
  const [authErrorField, setAuthErrorField] = useState<AuthField | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [pendingVerifiedSession, setPendingVerifiedSession] = useState<SupabaseSession | null>(null);
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [guestIdentity, setGuestIdentity] = useState<GuestIdentity | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState(isSupabaseConfigured());
  const revision = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    const stored = loadAuthFromStorage();
    if (!stored) { setIsRestoringSession(false); return; }
    const restoredSession: SupabaseSession = {
      accessToken: stored.accessToken, refreshToken: stored.refreshToken,
      user: { id: stored.userId, email: stored.email },
    };
    restoreAuthSession(restoredSession).then(async freshSession => {
      const freshProfile = await fetchProfile(freshSession);
      if (!active) return;
      setSession(freshSession);
      setProfile(freshProfile);
      saveAuthToStorage(freshSession, freshProfile);
    }).catch(() => { if (active) clearAuthStorage(); })
      .finally(() => { if (active) setIsRestoringSession(false); });
    return () => { active = false; revision.current++; };
  }, []);

  useEffect(() => {
    if (!session || !profile) return;
    const authRevision = revision.current;
    return subscribeToAuthRefresh(freshSession => {
      if (revision.current !== authRevision || freshSession.user.id !== profile.id) return;
      setSession(freshSession);
      saveAuthToStorage(freshSession, profile);
    });
  }, [session?.user.id, profile]);

  const resetFlow = () => {
    revision.current++;
    busy.current = false;
    setIsAuthLoading(false);
    setPendingVerifiedSession(null); setNeedsIdentity(false);
    setAuthPassword('');
    setAuthCode('');
    setAuthError('');
    setAuthErrorField(null);
    setAuthStep('EMAIL');
  };
  const setAuthMode = (mode: AuthMode) => { resetFlow(); setMode(mode); };
  const setLoginMethod = (method: LoginMethod) => { resetFlow(); setMethod(method); };

  const validatedIdentity = () => {
    const username = validateUsername(authUsername);
    if (!username.valid) throw new IdentityInputError('username', username.error);
    const nickname = normalizeNickname(authNickname, username.value);
    if (!nickname.valid) throw new IdentityInputError('nickname', nickname.error);
    return { username: username.value, nickname: nickname.value };
  };

  const validateEmail = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail.trim())) {
      setAuthError('Enter a valid email address.'); setAuthErrorField('email'); return false;
    }
    if (!isSupabaseConfigured()) {
      setAuthError('Account access is temporarily unavailable. Please use Guest Trial.'); setAuthErrorField('email'); return false;
    }
    return true;
  };

  const run = async (field: AuthField, operation: (current: () => boolean) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    const requestRevision = ++revision.current;
    const current = () => revision.current === requestRevision;
    setIsAuthLoading(true); setAuthError(''); setAuthErrorField(null);
    try { await operation(current); }
    catch (error) {
      if (current()) {
        setAuthError(getAuthErrorMessage(error, 'Unable to log in. Please try again.'));
        setAuthErrorField(error instanceof IdentityInputError ? error.field : /Username/.test(getAuthErrorMessage(error, '')) ? 'username' : field);
      }
    } finally {
      if (current()) { busy.current = false; setIsAuthLoading(false); }
    }
  };

  const finish = async (
    verified: SupabaseSession, onRecords: (records: GameRecord[]) => void,
    current: () => boolean, identity?: ReturnType<typeof validatedIdentity>,
  ) => {
    let nextProfile: UserProfile;
    // A successful login must not require or overwrite an existing public identity.
    try { nextProfile = identity ? await claimProfile(verified, identity.username, identity.nickname) : await fetchProfile(verified); }
    catch (error) {
      if (!current()) return;
      if (error instanceof ProfileIncompleteError) {
        setPendingVerifiedSession(verified); setNeedsIdentity(true); setAuthStep('VERIFY');
        throw new IdentityInputError('username', 'Email verified. Choose a Username to finish setting up your account.');
      }
      throw error;
    }
    if (!current()) return;
    const records = await fetchGameRecords(verified);
    if (!current()) return;
    setSession(verified); setProfile(nextProfile); setIsGuest(false); setGuestIdentity(null);
    setPendingVerifiedSession(null); setAuthPassword(''); setAuthCode('');
    saveAuthToStorage(verified, nextProfile);
    onRecords(records);
  };

  const handleSendOtp = async (captchaToken?: string) => {
    if (!validateEmail()) return;
    await run('email', async current => {
      if (authMode === 'SIGNUP') await resendSignupCode(authEmail.trim(), captchaToken);
      else await requestEmailOtp(authEmail.trim(), captchaToken);
      if (current()) { setAuthStep('VERIFY'); setAuthCode(''); }
    });
  };

  const handleSignUp = async (onRecords: (records: GameRecord[]) => void, captchaToken?: string) => {
    if (!validateEmail()) return;
    await run('password', async current => {
      const identity = validatedIdentity();
      if (authPassword.length < 8) { setAuthErrorField('password'); throw new Error('Use at least 8 characters for your password.'); }
      const verified = await signUpWithPassword(authEmail.trim(), authPassword, captchaToken);
      if (!current()) return;
      setAuthPassword(''); setAuthStep('VERIFY');
      if (verified) {
        setPendingVerifiedSession(verified);
        await finish(verified, onRecords, current, identity);
      }
    });
  };

  const handlePasswordLogin = async (onRecords: (records: GameRecord[]) => void, captchaToken?: string) => {
    if (!validateEmail()) return;
    if (!authPassword) { setAuthError('Enter your password.'); setAuthErrorField('password'); return; }
    await run('password', async current => {
      const verified = await signInWithPassword(authEmail.trim(), authPassword, captchaToken);
      if (!current()) return;
      setAuthPassword(''); setPendingVerifiedSession(verified); setAuthStep('VERIFY');
      await finish(verified, onRecords, current);
    });
  };

  const handleVerifyOtp = async (onRecords: (records: GameRecord[]) => void) => {
    if (!pendingVerifiedSession && !/^\d{6,10}$/.test(authCode.trim())) {
      setAuthError('Enter the verification code from your email.'); setAuthErrorField('code'); return;
    }
    await run(pendingVerifiedSession ? 'username' : 'code', async current => {
      const identity = authMode === 'SIGNUP' || needsIdentity ? validatedIdentity() : undefined;
      const verified = pendingVerifiedSession ?? await verifyEmailOtp(authEmail.trim(), authCode.trim());
      if (!current()) return;
      setPendingVerifiedSession(verified);
      try { await finish(verified, onRecords, current, identity); }
      catch (error) {
        if (identity && current()) throw new IdentityInputError('username', getAuthErrorMessage(error, 'Could not complete your profile.'));
        throw error;
      }
    });
  };

  const handleGuest = (onReady: (identity: GuestIdentity) => void) => {
    const identity = loadOrCreateGuestIdentity(getBrowserStorage());
    if (!identity) { setAuthError('A Guest ID could not be created in this browser.'); setAuthErrorField(null); return; }
    resetFlow(); clearAuthStorage(); clearClientSession();
    setGuestIdentity(identity); setIsGuest(true); setSession(null); setProfile(null);
    onReady(identity);
  };
  const leaveGuestForAuth = () => {
    resetFlow(); setMode('LOGIN'); setIsGuest(false); setGuestIdentity(null); setSession(null); setProfile(null);
  };
  const logoutAuth = () => { leaveGuestForAuth(); clearAuthStorage(); clearClientSession(); };

  return {
    authEmail, setAuthEmail, authUsername, setAuthUsername, authNickname, setAuthNickname,
    authCode, setAuthCode, authPassword, setAuthPassword, authMode, setAuthMode, loginMethod, setLoginMethod,
    authStep, authError, authErrorField, isAuthLoading,
    isIdentityCompletionPending: Boolean(pendingVerifiedSession), needsIdentity,
    session, profile, guestIdentity, isGuest,
    isAuthenticated: Boolean((session && profile) || (isGuest && guestIdentity)), isRestoringSession,
    handleSendOtp, handleSignUp, handlePasswordLogin, handleVerifyOtp,
    handleChangeEmail: resetFlow, handleGuest, leaveGuestForAuth, logoutAuth,
  };
};

export default useAuth;
