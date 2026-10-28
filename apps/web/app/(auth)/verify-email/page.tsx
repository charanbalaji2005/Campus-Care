'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MailCheck } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/primitives';
import { AppHandoff } from '@/components/app-handoff';
import { api, ApiError } from '@/lib/api';
import { rememberOutcome, verificationErrorPath } from '@/lib/auth-flow';

type State = 'checking' | 'ready' | 'working';

/**
 * Landing page for verification links when the CampusCare app did not open them. Opening it never
 * verifies anything: the page only checks the link (read-only) and waits for the person to press
 * "Verify my email" (here or in the app), which POSTs the token. Email security scanners that open
 * links therefore cannot use the token up. Results go to /verification-success or
 * /verification-error; nothing here leads to the Super Admin sign-in or console.
 */
export default function VerifyEmailPage() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = React.useState<State>('checking');
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    if (!token) { router.replace(verificationErrorPath('invalid')); return; }
    let cancelled = false;
    api.post<{ state: 'valid' | 'expired' | 'invalid' | 'already_verified' }>('/auth/verify-email/check', { token })
      .then((r) => {
        if (cancelled) return;
        if (r.state === 'valid') setState('ready');
        else if (r.state === 'already_verified') { rememberOutcome('already_verified'); router.replace('/verification-success'); }
        else router.replace(verificationErrorPath(r.state === 'expired' ? 'expired' : 'invalid'));
      })
      .catch(() => { if (!cancelled) setState('ready'); }); // let the explicit POST give the authoritative answer
    return () => { cancelled = true; };
  }, [token, router]);

  async function verify() {
    if (state === 'working') return; // no duplicate submits
    setState('working');
    setError(undefined);
    try {
      const r = await api.post<{ result: string }>('/auth/verify-email', { token });
      // Success is shown only now, after the server confirmed it.
      rememberOutcome(r.result === 'already_verified' ? 'already_verified' : 'verified');
      router.replace('/verification-success');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'expired_token') router.replace(verificationErrorPath('expired'));
      else if (err instanceof ApiError && err.code === 'invalid_token') router.replace(verificationErrorPath('invalid'));
      else { setError(err instanceof ApiError ? err.message : 'We could not reach the server. Try again.'); setState('ready'); }
    }
  }

  return (
    <AuthShell title="Email verification">
      <div className="card p-8 text-center" aria-live="polite">
        {state === 'checking' && <><Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-600" aria-hidden /><p className="mt-4 text-sm">Checking your link…</p></>}
        {(state === 'ready' || state === 'working') && (
          <>
            <MailCheck className="mx-auto h-12 w-12 text-brand-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Confirm your email address</h2>
            <p className="mt-1 text-sm text-ink-soft">Press the button to finish verifying your CampusCare account.</p>
            {error && <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p>}
            <div className="mt-6 text-left">
              <AppHandoff
                path={`/verify-email?token=${encodeURIComponent(token)}`}
                title="Verify in the CampusCare app"
                message="The app opens on its verification screen. No app on this device? Verify here instead."
              />
            </div>
            <Button type="button" size="lg" variant="outline" className="mt-4 w-full" onClick={verify} loading={state === 'working'} disabled={state === 'working'}>Verify my email here</Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
