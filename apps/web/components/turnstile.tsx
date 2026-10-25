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

export interface TurnstileHandle {
  /** Tokens are single use: call after every submission attempt. */
  reset: () => void;
}

/**
 * Cloudflare Turnstile widget. The token is sent with the form and verified on the server
 * (Siteverify). If the Super Admin disabled Turnstile for this form, nothing renders.
 */
export const Turnstile = React.forwardRef<TurnstileHandle, { form: FormKey; onToken: (token: string | undefined) => void }>(function Turnstile({ form, onToken }, ref) {
  const { data: settings } = usePublicSettings();
  const el = React.useRef<HTMLDivElement>(null);
  const widgetId = React.useRef<string | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);
  const enabled = Boolean(settings?.turnstile.enabled && settings.turnstile.siteKey && settings.turnstile.forms[form]);
  const tokenCb = React.useRef(onToken);
  tokenCb.current = onToken;

  React.useImperativeHandle(ref, () => ({
    reset: () => {
      tokenCb.current(undefined);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  React.useEffect(() => {
    if (!enabled || !el.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !el.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(el.current, {
          sitekey: settings!.turnstile.siteKey,
          action: form,
          theme: 'light',
          appearance: 'interaction-only',
          callback: (t: string) => tokenCb.current(t),
          'expired-callback': () => tokenCb.current(undefined),
          'error-callback': () => { tokenCb.current(undefined); setFailed(true); },
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
  }, [enabled, form, settings]);

  if (!enabled) return null;
  return (
    <div>
      <div ref={el} className="min-h-[1px]" />
      {failed && <p className="text-xs text-rose-700" role="alert">Human verification couldn’t load. Check your connection or disable content blockers, then reload.</p>}
    </div>
  );
});
