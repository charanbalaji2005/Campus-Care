'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Turnstile } from '@/components/turnstile';
import { AppHandoff } from '@/components/app-handoff';
import { api, ApiError } from '@/lib/api';

/** The email is only marked verified when the server consumes the single-use token (POST), not when this page opens. */
export default function VerifyEmailPage() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = React.useState<'idle' | 'working' | 'verified' | 'already' | 'expired' | 'invalid'>('idle');
  const [email, setEmail] = React.useState('');
  const [tsToken, setTsToken] = React.useState<string>();
  const [resent, setResent] = React.useState(false);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!token || started.current) { if (!token) setState('invalid'); return; }
    started.current = true;
    setState('working');
    api.post<{ result: string }>('/auth/verify-email', { token })
      .then((r) => setState(r.result === 'already_verified' ? 'already' : 'verified'))
      .catch((err) => setState(err instanceof ApiError && err.code === 'expired_token' ? 'expired' : 'invalid'));
  }, [token]);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/auth/resend-verification', { email, turnstileToken: tsToken }).catch(() => undefined);
    setResent(true);
  }

  return (
    <AuthShell title="Email verification">
      <div className="card p-8 text-center">
        {(state === 'idle' || state === 'working') && <><Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-600" /><p className="mt-4 text-sm">Verifying your email…</p></>}
        {(state === 'verified' || state === 'already') && (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" />
            <h2 className="mt-4 text-lg font-semibold">{state === 'verified' ? 'Your email is verified' : 'Already verified'}</h2>
            <p className="mt-1 text-sm text-ink-soft">Your account is active. Sign in with the CampusCare app.</p>
            <div className="mt-6 text-left"><AppHandoff path="/login" message="Open the app and sign in with your university email and password." /></div>
          </>
        )}
        {(state === 'expired' || state === 'invalid') && (
          <>
            <XCircle className="mx-auto h-12 w-12 text-rose-600" />
            <h2 className="mt-4 text-lg font-semibold">{state === 'expired' ? 'This link has expired' : 'This link is invalid or already used'}</h2>
            {resent ? (
              <p className="mt-3 text-sm text-ink">If your account still needs verification, a new link is on its way.</p>
            ) : (
              <form onSubmit={resend} className="mt-6 space-y-3 text-left">
                <Field id="email" label="Send a new link to"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                <Turnstile form="resendVerification" onToken={setTsToken} />
                <Button type="submit" className="w-full">Resend verification email</Button>
              </form>
            )}
          </>
        )}
      </div>
    </AuthShell>
  );
}
