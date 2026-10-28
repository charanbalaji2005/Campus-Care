'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { CODE_LENGTH, MethodChoice, OtpInput, Step, type EmailMethod } from '@/components/email-code';
import { api, ApiError } from '@/lib/api';
import { useCooldown } from '@/lib/auth-links';
import { rememberOutcome } from '@/lib/auth-flow';

/**
 * Ask for a new verification code or link, with a cooldown and duplicate-submit protection, and enter a
 * code here. The server answers the same way whether or not the address has an account; when email
 * cannot be sent at all it returns email_unavailable, which is shown as an error (never as "sent").
 * The account counts as verified only after the server accepted the code (or link).
 */
export function ResendVerification({ initialEmail = '', askEmail = true }: { initialEmail?: string; askEmail?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = React.useState(initialEmail);
  const [method, setMethod] = React.useState<EmailMethod>('otp');
  const [sentMethod, setSentMethod] = React.useState<EmailMethod | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: 'brand' | 'rose'; text: string } | null>(null);
  const [tsToken, setTsToken] = React.useState<string>();
  const [code, setCode] = React.useState('');
  const [codeError, setCodeError] = React.useState<string>();
  const [checking, setChecking] = React.useState(false);
  const turnstile = React.useRef<TurnstileHandle>(null);
  const cooldown = useCooldown();

  async function send(m: EmailMethod) {
    if (busy || cooldown.remaining > 0) return;
    if (!email.trim()) { setNotice({ tone: 'rose', text: 'Enter the email address you registered with.' }); return; }
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ message: string; retryAfterSeconds?: number }>('/auth/resend-verification', { email: email.trim(), turnstileToken: tsToken, method: m });
      setNotice({ tone: 'brand', text: r.message });
      setSentMethod(m);
      setMethod(m);
      setCode('');
      setCodeError(undefined);
      cooldown.start(r.retryAfterSeconds ?? 60);
    } catch (err) {
      const rateLimited = err instanceof ApiError && err.code === 'rate_limited';
      setNotice({ tone: 'rose', text: err instanceof ApiError ? err.message : 'We couldn’t send the email. Please try again.' });
      if (rateLimited) cooldown.start(60);
    } finally {
      setBusy(false);
      turnstile.current?.reset();
    }
  }

  async function verifyCode(c = code) {
    if (checking || c.length !== CODE_LENGTH) return;
    setChecking(true);
    setCodeError(undefined);
    try {
      const r = await api.post<{ result: string }>('/auth/verify-email/otp', { email: email.trim(), code: c });
      rememberOutcome(r.result === 'already_verified' ? 'already_verified' : 'verified');
      router.replace('/verification-success');
    } catch (err) {
      setCodeError(err instanceof ApiError ? err.message : 'We could not reach the server. Try again.');
      setCode('');
    } finally {
      setChecking(false);
    }
  }

  const waiting = cooldown.remaining > 0;
  return (
    <div className="space-y-4 text-left">
      <form onSubmit={(e) => { e.preventDefault(); void send(method); }} className="space-y-3" noValidate aria-busy={busy}>
        {askEmail && (
          <Field id="resend-email" label="Your university email">
            <Input id="resend-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        {!sentMethod && <MethodChoice kind="verify" value={method} onChange={setMethod} disabled={busy} />}
        <Turnstile ref={turnstile} form="resendVerification" onToken={setTsToken} />
        {!sentMethod ? (
          <Button type="submit" className="w-full" loading={busy} disabled={busy || waiting}>
            {waiting ? `Send again in ${cooldown.remaining}s` : method === 'otp' ? 'Email me a code' : 'Email me a link'}
          </Button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="outline" className="flex-1" loading={busy} disabled={busy || waiting}>
              {waiting ? `Resend in ${cooldown.remaining}s` : sentMethod === 'otp' ? 'Resend code' : 'Resend link'}
            </Button>
            <Button type="button" variant="ghost" className="flex-1" disabled={busy || waiting} onClick={() => void send(sentMethod === 'otp' ? 'link' : 'otp')}>
              {sentMethod === 'otp' ? 'Verify using an email link instead' : 'Verify using OTP instead'}
            </Button>
          </div>
        )}
        {notice && <Alert tone={notice.tone}><span role={notice.tone === 'rose' ? 'alert' : 'status'}>{notice.text}</span></Alert>}
      </form>
      {sentMethod === 'otp' && (
        <Step stepKey="code">
          <form onSubmit={(e) => { e.preventDefault(); void verifyCode(); }} className="space-y-3" noValidate aria-busy={checking}>
            <OtpInput id="verify-code" value={code} onChange={(v) => { setCode(v); setCodeError(undefined); }} onComplete={(v) => void verifyCode(v)} error={codeError} disabled={checking} />
            <Button type="submit" className="w-full" loading={checking} disabled={checking || code.length !== CODE_LENGTH}>Verify email</Button>
          </form>
        </Step>
      )}
    </div>
  );
}
