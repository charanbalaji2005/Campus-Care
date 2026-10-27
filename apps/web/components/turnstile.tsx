'use client';

import * as React from 'react';
import { usePublicSettings } from '@/lib/hooks';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

type FormKey = 'register' | 'login' | 'forgotPassword' | 'resetPassword' | 'resendVerification' | 'incidentSubmit' | 'communityPost';
type Status = 'verifying' | 'ready' | 'refreshing' | 'interactive' | 'failed';

/** Cloudflare tokens live 300 s; leave room for the request to reach Siteverify. */
const TOKEN_MAX_AGE_MS = 270_000;
const WAIT_LIMIT_MS = 60_000;

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile failed to load')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Development-only timings. Never logs the token. */
function debug(form: string, msg: string) {
  if (process.env.NODE_ENV !== 'production') console.debug(`[turnstile:${form}] ${msg}`);
}

export interface TurnstileHandle {
  /** Tokens are single use: call after every submission attempt. */
  reset: () => void;
  /**
   * The current token, waiting only while verification is still running (it starts as soon as the
   * form renders, so it is usually ready by the time the person submits). Resolves undefined when
   * Turnstile is off for this form; rejects with a user-facing message if verification fails.
   */
  getToken: () => Promise<string | undefined>;
}

/**
 * Cloudflare Turnstile widget (Managed, "interaction-only": invisible unless Cloudflare needs the
 * person to interact). It renders with the form and verifies in the background. The token is sent
 * with the form and verified on the server (Siteverify). If the Super Admin disabled Turnstile for
 * this form, nothing renders.
 */
export const Turnstile = React.forwardRef<TurnstileHandle, { form: FormKey; onToken: (token: string | undefined) => void }>(function Turnstile({ form, onToken }, ref) {
  const { data: settings } = usePublicSettings();
  const el = React.useRef<HTMLDivElement>(null);
  const widgetId = React.useRef<string | undefined>(undefined);
  const [status, setStatus] = React.useState<Status>('verifying');
  const [failure, setFailure] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const siteKey = settings?.turnstile.siteKey ?? '';
  const enabled = Boolean(settings?.turnstile.enabled && siteKey && settings.turnstile.forms[form]);
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;
  const tokenCb = React.useRef(onToken);
  tokenCb.current = onToken;
  const token = React.useRef<{ value: string; at: number } | null>(null);
  const waiters = React.useRef<Array<{ resolve: (t: string) => void; reject: (e: Error) => void }>>([]);
  const startedAt = React.useRef(0);

  const setToken = React.useCallback((value: string | undefined) => {
    token.current = value ? { value, at: Date.now() } : null;
    tokenCb.current(value);
  }, []);

  const restart = React.useCallback(() => {
    setToken(undefined);
    setStatus('refreshing');
    startedAt.current = performance.now();
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [setToken]);

  React.useImperativeHandle(ref, () => ({
    reset: restart,
    getToken: () => {
      if (!enabledRef.current) return Promise.resolve(undefined);
      const t = token.current;
      if (t && Date.now() - t.at < TOKEN_MAX_AGE_MS) {
        debug(form, `submit: token was ready (${Math.round((Date.now() - t.at) / 1000)}s old)`);
        return Promise.resolve(t.value);
      }
      if (t) restart(); // too old to trust
      debug(form, 'submit: waiting for token');
      const waitStart = performance.now();
      return new Promise<string>((resolve, reject) => {
        const entry = {
          resolve: (v: string) => { clearTimeout(timer); debug(form, `waited ${Math.round(performance.now() - waitStart)}ms for token`); resolve(v); },
          reject: (e: Error) => { clearTimeout(timer); reject(e); },
        };
        const timer = setTimeout(() => {
          waiters.current = waiters.current.filter((w) => w !== entry);
          reject(new Error('The security check is taking too long. Check your connection and try again.'));
        }, WAIT_LIMIT_MS);
        waiters.current.push(entry);
      });
    },
  }), [form, restart]);

  React.useEffect(() => {
    if (!enabled || !el.current) return;
    let cancelled = false;
    const fail = (message: string) => {
      setToken(undefined);
      setFailure(message);
      setStatus('failed');
      const pending = waiters.current;
      waiters.current = [];
      pending.forEach((w) => w.reject(new Error(message)));
    };
    startedAt.current = performance.now();
    setStatus('verifying');
    loadScript()
      .then(() => {
        if (cancelled || !el.current || !window.turnstile) return;
        debug(form, `widget ready after ${Math.round(performance.now() - startedAt.current)}ms`);
        widgetId.current = window.turnstile.render(el.current, {
          sitekey: siteKey,
          action: form,
          theme: 'light',
          appearance: 'interaction-only',
          'refresh-expired': 'auto',
          callback: (t: string) => {
            debug(form, `token after ${Math.round(performance.now() - startedAt.current)}ms`);
            setToken(t);
            setStatus('ready');
            const pending = waiters.current;
            waiters.current = [];
            pending.forEach((w) => w.resolve(t));
          },
          'expired-callback': () => { setToken(undefined); setStatus('refreshing'); },
          'before-interactive-callback': () => { setStatus('interactive'); debug(form, 'interactive challenge shown'); },
          'after-interactive-callback': () => setStatus('verifying'),
          'error-callback': (code: string) => {
            debug(form, `error ${code}`);
            fail('Human verification failed. Please try again.');
          },
        });
      })
      .catch(() => fail('Human verification couldn’t load. Check your connection or disable content blockers, then reload.'));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = undefined;
    };
    // siteKey (a string), not the settings object, so a settings refetch never recreates the widget.
  }, [enabled, form, siteKey, setToken, attempt]);

  if (!enabled) return null;
  const label: Record<Status, string> = {
    verifying: 'Verifying security…',
    ready: 'Security check complete.',
    refreshing: 'Refreshing security check…',
    interactive: 'Please complete the security check.',
    failed: failure,
  };
  return (
    <div>
      <div ref={el} className="min-h-[1px]" />
      <p className={`text-xs ${status === 'failed' ? 'text-rose-700' : 'text-ink-soft'}`} role={status === 'failed' ? 'alert' : 'status'} aria-live="polite">
        {label[status]}
        {status === 'failed' && <> <button type="button" onClick={() => (widgetId.current ? restart() : setAttempt((a) => a + 1))} className="font-semibold underline">Retry</button></>}
      </p>
    </div>
  );
});
