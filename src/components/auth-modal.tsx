'use client';

import { useEffect, useRef, useState } from 'react';
import { api, apiGet } from '@/lib/client/api';
import type { Quota } from '@/lib/types';
import styles from './auth-modal.module.css';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        action: string;
        size?: 'normal' | 'flexible' | 'compact';
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: () => void;
      }) => string;
      reset: (id: string) => void;
      remove?: (id: string) => void;
    };
  }
}

export type Me = { email: string | null; quota: Quota };

export function AuthModal({ siteKey, turnstileEnabled, reason, onDone, onClose }: {
  siteKey: string;
  turnstileEnabled: boolean;
  reason: string;
  onDone: (me: Me) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (mode !== 'register' || !turnstileEnabled || !siteKey || !box.current || !window.turnstile) return;
    widgetId.current = window.turnstile.render(box.current, {
      sitekey: siteKey,
      action: 'register',
      size: 'compact',
      callback: (t) => setToken(t),
      'expired-callback': () => setToken(''),
      'error-callback': () => setToken(''),
    });
    return () => {
      if (widgetId.current !== null) window.turnstile?.remove?.(widgetId.current);
      widgetId.current = null;
      setToken('');
    };
  }, [mode, turnstileEnabled, siteKey]);

  async function submit() {
    if (!email.trim() || !password) {
      setError('Enter your email and a password.');
      return;
    }
    if (mode === 'register' && turnstileEnabled && !token) {
      setError('Complete the quick verification to create your account.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const me = await api<Me>(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        email: email.trim(),
        password,
        ...(mode === 'register' ? { turnstileToken: turnstileEnabled ? token : undefined } : {}),
      });
      onDone(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      if (mode === 'register' && widgetId.current !== null) {
        window.turnstile?.reset(widgetId.current);
        setToken('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close sign in">×</button>
        <h2 id="auth-title">{mode === 'register' ? 'Create your free account' : 'Welcome back'}</h2>
        {reason && <p className={styles.reason}>{reason}</p>}
        <p className={styles.quota}>Registered sellers get 3 shoots and 3 animations every day, free.</p>
        <div className={styles.tabs} role="tablist">
          {(['register', 'login'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? styles.activeTab : ''} onClick={() => { setMode(m); setError(''); }}>
              {m === 'register' ? 'Create account' : 'Sign in'}
            </button>
          ))}
        </div>
        <label className={styles.field}>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} placeholder="you@example.com" />
        </label>
        <label className={styles.field}>
          Password{mode === 'register' && <span className={styles.hint}> (8+ characters)</span>}
          <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} minLength={mode === 'register' ? 8 : undefined} />
        </label>
        {mode === 'register' && turnstileEnabled && siteKey && <div ref={box} className={styles.widget} />}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void submit()}>
          {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}

export async function fetchMe(): Promise<Me | null> {
  try {
    return await apiGet<Me>('/api/auth/me');
  } catch {
    return null;
  }
}

export function quotaText(me: Me | null): string {
  if (!me) return '';
  const q = me.quota;
  if (!q.registered) return `Free trial: ${q.shootsLeft} of ${q.shootsLimit} shoots · ${q.animsLeft} of ${q.animsLimit} animations left`;
  return `Today: ${q.shootsLeft} of ${q.shootsLimit} shoots · ${q.animsLeft} of ${q.animsLimit} animations left`;
}
