import { useState } from 'react';
import {
  SupabaseSession,
  UserProfile,
} from '../types';
import {
  fetchGameRecords,
  isSupabaseConfigured,
  requestEmailOtp,
  upsertProfile,
  verifyEmailOtp,
} from '../services/supabaseClient';

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
  handleSendOtp: () => Promise<void>;
  handleVerifyOtp: (onSuccess: (records: any[]) => void) => Promise<void>;
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

  const isAuthenticated = Boolean(session || isGuest);

  const handleSendOtp = async () => {
    const email = authEmail.trim();
    if (!email) { setAuthError('请输入邮箱。'); return; }
    if (!isSupabaseConfigured()) {
      setAuthError('Supabase 环境变量未配置：请先使用 Guest 试玩。');
      return;
    }
    setIsAuthLoading(true);
    setAuthError('');
    try {
      await requestEmailOtp(email);
      setAuthStep('VERIFY');
    } catch (error: any) {
      setAuthError(error.message || '验证码发送失败。');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (onSuccess: (records: any[]) => void) => {
    if (!authCode.trim()) { setAuthError('请输入邮箱验证码。'); return; }
    setIsAuthLoading(true);
    setAuthError('');
    try {
      const nextSession = await verifyEmailOtp(authEmail.trim(), authCode.trim());
      const displayName = authName.trim() || nextSession.user.email?.split('@')[0] || 'Player';
      const nextProfile = await upsertProfile(nextSession, displayName);
      setSession(nextSession);
      setProfile(nextProfile);
      setIsGuest(false);
      const nextRecords = await fetchGameRecords(nextSession);
      onSuccess(nextRecords);
    } catch (error: any) {
      setAuthError(error.message || '登录失败。');
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

  // Only resets auth state; caller is responsible for resetting game state
  const logoutAuth = () => {
    setSession(null);
    setProfile(null);
    setIsGuest(false);
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
    handleSendOtp,
    handleVerifyOtp,
    handleGuest,
    logoutAuth,
  };
};

export default useAuth;
