import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, KeyRound, Loader2, Moon, Play, Shield, Trophy } from 'lucide-react';
import type { AuthState } from '../hooks/useAuth';
import type { GameRecord } from '../types';
import TurnstileWidget from './TurnstileWidget';

interface Props {
  auth: AuthState;
  onReady: (records: GameRecord[]) => void;
  onGuest: () => void;
}

const LoginView: React.FC<Props> = ({ auth, onReady, onGuest }) => {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRevision, setCaptchaRevision] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  const signup = auth.authMode === 'SIGNUP';
  const verifying = auth.authStep === 'VERIFY';
  const needsIdentity = signup || auth.needsIdentity;
  const codeLogin = auth.loginMethod === 'CODE';
  const resendWait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (auth.authErrorField) formRef.current?.querySelector<HTMLInputElement>(`#auth-${auth.authErrorField}`)?.focus();
  }, [auth.authError, auth.authErrorField]);
  useEffect(() => {
    if (!resendAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const resetCaptcha = () => { setCaptchaToken(null); setCaptchaRevision(value => value + 1); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (auth.isAuthLoading || (!verifying && !captchaToken)) return;
    if (verifying) { await auth.handleVerifyOtp(onReady); return; }
    try {
      if (signup) await auth.handleSignUp(onReady, captchaToken!);
      else if (codeLogin) await auth.handleSendOtp(captchaToken!);
      else await auth.handlePasswordLogin(onReady, captchaToken!);
      setResendAt(Date.now() + 60_000); setNow(Date.now());
    } finally { resetCaptcha(); }
  };
  const resend = async () => {
    if (!captchaToken || resendWait || auth.isAuthLoading) return;
    try {
      await auth.handleSendOtp(captchaToken);
      setResendAt(Date.now() + 60_000); setNow(Date.now());
    } finally { resetCaptcha(); }
  };
  const inputClass = 'auth-input';
  const describedBy = (field: string, help?: string) =>
    [help, auth.authErrorField === field ? 'auth-error' : null].filter(Boolean).join(' ') || undefined;

  return (
    <main className="login-page sketch-scene flex font-sans text-zinc-200">
      <div className="auth-layout">
        <header className="auth-brand">
          <Moon aria-hidden="true" size={27} />
          <div><h1 className="login-title cinzel">AI WEREWOLF</h1><p>Shadows of the Village</p></div>
        </header>
        <div className="auth-columns parchment-border">
          <section className="guest-welcome" aria-labelledby="guest-heading">
            <span className="auth-eyebrow">Trust your instincts. Question everyone.</span>
            <h2 id="guest-heading" className="cinzel">Night falls.<br />Close your eyes.</h2>
            <p className="guest-intro">Step into a village of AI players. Read their stories, find the werewolves, and make your case.</p>
            <div className="guest-trial-card">
              <div className="guest-trial-label"><Play size={18} aria-hidden="true" /><h3>Guest Trial</h3><span>No account needed</span></div>
              <p>Explore the full single-player game. Choose Beginner for a guided first match.</p>
              <button type="button" className="guest-play-button" onClick={onGuest} disabled={auth.isAuthLoading}>
                Play as Guest <ArrowRight size={18} aria-hidden="true" />
              </button>
              <p className="guest-record-note">Guest matches are not saved. Create an account to keep your record.</p>
            </div>
            <div className="guest-features"><span>9 or 12 players</span><span>3 difficulty levels</span><span>You + AI players</span></div>
          </section>

          <section className="account-panel" aria-labelledby="account-heading">
            <div className="auth-tabs" aria-label="Account access">
              <button type="button" aria-pressed={!signup} disabled={auth.isAuthLoading} onClick={() => auth.setAuthMode('LOGIN')}>Log in</button>
              <button type="button" aria-pressed={signup} disabled={auth.isAuthLoading} onClick={() => auth.setAuthMode('SIGNUP')}>Create account</button>
            </div>
            <h2 id="account-heading">{signup ? 'Make your mark.' : 'Welcome back.'}</h2>
            <p className="account-description"><Trophy size={15} aria-hidden="true" />{signup ? 'Save your matches and follow your progress.' : 'Log in to keep your match history and stats.'}</p>
            {!signup && !verifying && (
              <div className="login-methods" aria-label="Login method">
                <button type="button" aria-pressed={!codeLogin} disabled={auth.isAuthLoading} onClick={() => auth.setLoginMethod('PASSWORD')}>Password</button>
                <button type="button" aria-pressed={codeLogin} disabled={auth.isAuthLoading} onClick={() => auth.setLoginMethod('CODE')}>Verification code</button>
              </div>
            )}
            <form ref={formRef} onSubmit={submit} aria-busy={auth.isAuthLoading}>
              <fieldset disabled={auth.isAuthLoading} className="auth-fields">
                <div><label htmlFor="auth-email">Email</label>
                  <input className={inputClass} id="auth-email" type="email" autoComplete="email" required disabled={verifying} value={auth.authEmail} onChange={event => auth.setAuthEmail(event.target.value)} placeholder="you@example.com" aria-invalid={auth.authErrorField === 'email'} aria-describedby={describedBy('email')} /></div>
                {needsIdentity && <>
                  <div><label htmlFor="auth-username">Username</label>
                    <input className={inputClass} id="auth-username" autoComplete="username" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_]+" value={auth.authUsername} onChange={event => auth.setAuthUsername(event.target.value)} placeholder="your_username" aria-invalid={auth.authErrorField === 'username'} aria-describedby={describedBy('username', 'auth-username-help')} />
                    <p id="auth-username-help" className="auth-field-help">3–40 letters, numbers, or underscores. Stored in lowercase.</p></div>
                  <div><label htmlFor="auth-nickname">Nickname <span>(optional)</span></label>
                    <input className={inputClass} id="auth-nickname" autoComplete="nickname" maxLength={80} value={auth.authNickname} onChange={event => auth.setAuthNickname(event.target.value)} placeholder="Defaults to Username" aria-invalid={auth.authErrorField === 'nickname'} aria-describedby={describedBy('nickname')} /></div>
                </>}
                {!verifying && (signup || !codeLogin) && <div>
                  <label htmlFor="auth-password">Password</label>
                  <div className="auth-password-wrap">
                    <input className={inputClass} id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : undefined} value={auth.authPassword} onChange={event => auth.setAuthPassword(event.target.value)} placeholder={signup ? 'At least 8 characters' : 'Your password'} aria-invalid={auth.authErrorField === 'password'} aria-describedby={describedBy('password')} />
                    <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
                  </div>
                </div>}
                {verifying && <div>
                  {auth.isIdentityCompletionPending ? <p className="auth-verified-note">Email verified. Complete your account to enter; no new code is needed.</p> : <>
                    <label htmlFor="auth-code">Verification code</label>
                    <input className={inputClass} id="auth-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,10}" maxLength={10} value={auth.authCode} onChange={event => auth.setAuthCode(event.target.value)} placeholder="Code from your email" aria-invalid={auth.authErrorField === 'code'} aria-describedby={describedBy('code', 'auth-code-help')} />
                    <p id="auth-code-help" className="auth-field-help">Check your inbox and spam folder. Enter the latest code.</p>
                  </>}
                </div>}
              </fieldset>
              {auth.authError && <p id="auth-error" role="alert" className="auth-error">{auth.authError}</p>}
              <div className="turnstile-container">
                <TurnstileWidget
                  key={captchaRevision}
                  siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                  onVerify={setCaptchaToken}
                  onError={() => setCaptchaToken(null)}
                  onExpired={() => setCaptchaToken(null)}
                />
              </div>
              {!captchaToken && <p className="auth-captcha-note" role="status">Account verification may take a few seconds. Please wait before submitting. Guest Trial does not require verification.</p>}
              <button className="account-submit" type="submit" disabled={auth.isAuthLoading || (!verifying && !captchaToken)}>
                {auth.isAuthLoading ? <Loader2 className="animate-spin" size={17} aria-hidden="true" /> : <Shield size={17} aria-hidden="true" />}
                {verifying ? (auth.isIdentityCompletionPending ? 'Save and enter' : 'Verify and log in') : signup ? 'Create account' : codeLogin ? 'Send verification code' : 'Log in'}
              </button>
            </form>
            {verifying ? <div className="auth-secondary-actions">
              <button type="button" disabled={auth.isAuthLoading} onClick={auth.handleChangeEmail}>Back</button>
              {!auth.isIdentityCompletionPending && <button type="button" disabled={auth.isAuthLoading || !captchaToken || resendWait > 0} onClick={resend}>{resendWait > 0 ? `Resend in ${resendWait}s` : 'Resend code'}</button>}
            </div> : !signup && <button type="button" className="auth-code-help-button" disabled={auth.isAuthLoading} onClick={() => auth.setLoginMethod('CODE')}><KeyRound size={14} aria-hidden="true" />No password or forgot it? Use an email code.</button>}
            <p className="account-footer">{signup ? 'Verify your email, then return with your password or an email code.' : 'New to the village? Create an account or try a game as a guest.'}</p>
          </section>
        </div>
        <footer className="auth-page-footer">A game of deduction, deception, and the stories we choose to believe.</footer>
      </div>
    </main>
  );
};

export default LoginView;
