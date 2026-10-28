'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MailCheck, Smartphone } from 'lucide-react';
import { forgotPasswordSchema } from '@campuscare/shared';
import { AuthShell } from '@/components/layout/auth-shell';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { CODE_LENGTH, MethodChoice, OtpInput, PasswordInput, Step, maskEmail, type EmailMethod } from '@/components/email-code';
import { api, ApiError } from '@/lib/api';
import { useForm } from '@/lib/form';
import { useCooldown } from '@/lib/auth-links';
import { usePublicSettings } from '@/lib/hooks';
import { forgotPasswordBackTarget, rememberOutcome } from '@/lib/auth-flow';
import { appIntentHref } from '@/components/app-handoff';

type Sent = { message: string; expiresInMinutes?: number; retryAfterSeconds?: number; method?: EmailMethod };

/**
 * Forgot password, by a 6-digit code or by a reset link. User-facing: the reset email opens the
 * CampusCare app (or the /reset-password page). Answers never reveal whether an address has an account,
 * a correct code only unlocks the new-password step (nobody is signed in), and success is shown only
 * after the server changed the password. Only when opened from the Super Admin sign-in (?from=admin)
 * does it link back there; Super Admin accounts always receive a link, never a code.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const back = forgotPasswordBackTarget(useSearchParams().get('from'));
  const { data: settings } = usePublicSettings();
  const minLength = settings?.passwordMinLength ?? 10;
  const turnstile = React.useRef<TurnstileHandle>(null);
  const resetTurnstile = React.useRef<TurnstileHandle>(null);
  const cooldown = useCooldown();
  const [step, setStep] = React.useState<'request' | 'code' | 'password' | 'link'>('request');
  const [method, setMethod] = React.useState<EmailMethod>(back === 'admin' ? 'link' : 'otp');
  const [result, setResult] = React.useState<Sent | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [codeError, setCodeError] = React.useState<string>();
  const [checking, setChecking] = React.useState(false);
  const [resetToken, setResetToken] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [pwErrors, setPwErrors] = React.useState<Record<string, string>>({});
  const [resetTs, setResetTs] = React.useState<string>();
  const [saving, setSaving] = React.useState(false);
  const form = useForm(forgotPasswordSchema, { email: '' });
  const email = String(form.values.email ?? '');

  async function send(m: EmailMethod) {
    if (form.submitting || cooldown.remaining > 0) return;
    setProblem(null);
    await form.submit(async (data) => {
      try {
        // Same answer whether or not the address has an account.
        const r = await api.post<Sent>('/auth/forgot-password', { ...data, method: m });
        setResult(r);
        setMethod(m);
        setCode('');
        setCodeError(undefined);
        setStep(m === 'otp' ? 'code' : 'link');
        cooldown.start(r.retryAfterSeconds ?? 60);
      } catch (err) {
        // e.g. email_unavailable: email cannot be sent right now. Never shown as "sent".
        if (err instanceof ApiError) setProblem(err.code === 'email_unavailable' ? `We couldn't send the email. Please try again. ${err.message}` : err.message);
        if (err instanceof ApiError && err.code === 'rate_limited') cooldown.start(60);
        throw err;
      } finally {
        turnstile.current?.reset();
      }
    }, { toastErrors: false });
  }

  async function checkCode(c = code) {
    if (checking || c.length !== CODE_LENGTH) return;
    setChecking(true);
    setCodeError(undefined);
    try {
      const r = await api.post<{ resetToken: string }>('/auth/reset-password/otp', { email: email.trim(), code: c });
      setResetToken(r.resetToken);
      setStep('password');
    } catch (err) {
      setCodeError(err instanceof ApiError ? err.message : 'We could not reach the server. Try again.');
      setCode('');
    } finally {
      setChecking(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return; // no duplicate submits
    const errs: Record<string, string> = {};
    if (password.length < minLength) errs.password = `Use at least ${minLength} characters`;
    else if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) errs.password = 'Include upper and lower case letters and a number';
    if (confirm !== password) errs.confirmPassword = 'Passwords do not match';
    setPwErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await api.post('/auth/reset-password', { token: resetToken, password, confirmPassword: confirm, turnstileToken: resetTs });
      // Success is shown only now, after the server confirmed the change.
      rememberOutcome('password_reset');
      router.replace('/reset-password-success');
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'expired_token' || err.code === 'invalid_token')) {
        setProblem('This reset session has expired. Request a new code.');
        setStep('request');
      } else if (err instanceof ApiError && Object.keys(err.fields).length) {
        setPwErrors(err.fields);
      } else {
        setProblem(err instanceof ApiError ? err.message : 'We could not reach the server. Try again.');
      }
    } finally {
      setSaving(false);
      resetTurnstile.current?.reset();
    }
  }

  const subtitle = {
    request: 'Choose how you’d like to reset your password.',
    code: `Enter the code sent to your registered email (${maskEmail(email)}).`,
    password: 'Code verified. Choose a new password; all other sessions will be signed out.',
    link: 'Check your inbox for a secure reset link.',
  }[step];
  const waiting = cooldown.remaining > 0;

  return (
    <AuthShell title="Reset your password" subtitle={subtitle} footer={back === 'admin'
      ? <Link href="/login" className="font-semibold text-brand-700 hover:underline">Back to sign in</Link>
      : <a href={appIntentHref()} className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline"><Smartphone className="h-4 w-4" aria-hidden /> Back to the CampusCare app</a>}>
      <Step stepKey={step}>
        {problem && <Alert tone="rose" className="mb-4"><span role="alert">{problem}</span></Alert>}

        {step === 'request' && (
          <form onSubmit={(e) => { e.preventDefault(); void send(method); }} className="space-y-4" noValidate>
            <MethodChoice kind="reset" value={method} onChange={setMethod} disabled={form.submitting} />
            <Field id="email" label="Email address" error={form.errors.email}><Input type="email" autoComplete="email" {...form.bind('email')} /></Field>
            <Turnstile ref={turnstile} form="forgotPassword" onToken={(t) => form.set('turnstileToken', t)} />
            <Button type="submit" size="lg" className="w-full" loading={form.submitting} disabled={form.submitting || waiting}>
              {waiting ? `Try again in ${cooldown.remaining}s` : method === 'otp' ? 'Email me a code' : 'Send reset link'}
            </Button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={(e) => { e.preventDefault(); void checkCode(); }} className="space-y-4" noValidate aria-busy={checking}>
            {result && <Alert tone="brand"><span role="status">{result.message}</span></Alert>}
            <OtpInput id="reset-code" value={code} onChange={(v) => { setCode(v); setCodeError(undefined); }} onComplete={(v) => void checkCode(v)} error={codeError} disabled={checking} />
            <p className="text-xs text-ink-soft">The code works once and expires in {result?.expiresInMinutes ?? 10} minutes. Only the newest code works. Code expired? Request a new one.</p>
            <Button type="submit" size="lg" className="w-full" loading={checking} disabled={checking || code.length !== CODE_LENGTH}>Continue</Button>
            <Turnstile ref={turnstile} form="forgotPassword" onToken={(t) => form.set('turnstileToken', t)} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" className="flex-1" disabled={waiting || form.submitting} onClick={() => void send('otp')}>{waiting ? `Resend code in ${cooldown.remaining}s` : 'Resend code'}</Button>
              <Button type="button" variant="ghost" className="flex-1" disabled={waiting || form.submitting} onClick={() => void send('link')}>Send a reset link instead</Button>
            </div>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={savePassword} className="space-y-4" noValidate>
            <Field id="password" label="New password" error={pwErrors.password} hint={`At least ${minLength} characters with upper and lower case letters and a number.`}>
              <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field id="confirmPassword" label="Confirm new password" error={pwErrors.confirmPassword}>
              <PasswordInput id="confirmPassword" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Turnstile ref={resetTurnstile} form="resetPassword" onToken={setResetTs} />
            <Button type="submit" size="lg" className="w-full" loading={saving} disabled={saving}>Update password</Button>
          </form>
        )}

        {step === 'link' && result && (
          <div className="card flex flex-col items-center p-8 text-center" role="status">
            <MailCheck className="h-12 w-12 text-brand-600" aria-hidden />
            <p className="mt-4 text-sm text-ink">{result.message}</p>
            <p className="mt-2 text-xs text-ink-soft">The link expires in {result.expiresInMinutes ?? 30} minutes and can be used once. Only the newest link works.</p>
            <Turnstile ref={turnstile} form="forgotPassword" onToken={(t) => form.set('turnstileToken', t)} />
            <div className="mt-4 flex w-full flex-col gap-2">
              <Button type="button" variant="outline" disabled={waiting || form.submitting} onClick={() => void send('link')}>{waiting ? `Send again in ${cooldown.remaining}s` : 'Send another link'}</Button>
              {back !== 'admin' && <Button type="button" variant="ghost" disabled={waiting || form.submitting} onClick={() => void send('otp')}>Reset password with OTP instead</Button>}
            </div>
          </div>
        )}
      </Step>
    </AuthShell>
  );
}
