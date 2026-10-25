'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, MailCheck, XCircle } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/primitives';
import { AppHandoff } from '@/components/app-handoff';
import { ResendVerification } from '@/components/resend-verification';
import { api, ApiError } from '@/lib/api';

type State = 'checking' | 'ready' | 'working' | 'verified' | 'already' | 'expired' | 'invalid' | 'error';

/**
 * Landing page for verification links. Opening it never verifies anything: the page only checks the
 * link (read-only) and waits for the person to press "Verify my email", which POSTs the token. Email
 * security scanners that open links therefore cannot use the token up.
 */
export default function VerifyEmailPage() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = React.useState<State>('checking');
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    if (!token) { setState('invalid'); return; }
    let cancelled = false;
    api.post<{ state: 'valid' | 'expired' | 'invalid' | 'already_verified' }>('/auth/verify-email/check', { token })
      .then((r) => { if (!cancelled) setState(r.state === 'valid' ? 'ready' : r.state === 'already_verified' ? 'already' : r.state); })
      .catch(() => { if (!cancelled) setState('ready'); }); // let the explicit POST give the authoritative answer
    return () => { cancelled = true; };
  }, [token]);

  async function verify() {
    if (state === 'working') return; // no duplicate submits
    setState('working');
    setError(undefined);
    try {
      const r = await api.post<{ result: string }>('/auth/verify-email', { token });
      setState(r.result === 'already_verified' ? 'already' : 'verified');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'expired_token') setState('expired');
      else if (err instanceof ApiError && err.code === 'invalid_token') setState('invalid');
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
            <Button type="button" size="lg" className="mt-6 w-full" onClick={verify} loading={state === 'working'} disabled={state === 'working'}>Verify my email</Button>
          </>
        )}
        {(state === 'verified' || state === 'already') && (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">{state === 'verified' ? 'Your email is verified' : 'Already verified'}</h2>
            <p className="mt-1 text-sm text-ink-soft">Your account is active. Sign in with the CampusCare app.</p>
            <div className="mt-6 text-left"><AppHandoff path="/login" message="Open the app and sign in with your university email and password." /></div>
          </>
        )}
        {(state === 'expired' || state === 'invalid') && (
          <>
            <XCircle className="mx-auto h-12 w-12 text-rose-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">{state === 'expired' ? 'This link has expired' : 'This link is invalid or was replaced by a newer one'}</h2>
            <p className="mt-1 text-sm text-ink-soft">Request a new link below. Only the most recent link works.</p>
            <div className="mt-6"><ResendVerification /></div>
          </>
        )}
      </div>
    </AuthShell>
  );
}
