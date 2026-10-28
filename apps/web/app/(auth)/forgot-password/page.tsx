'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MailCheck, Smartphone } from 'lucide-react';
import { forgotPasswordSchema } from '@campuscare/shared';
import { AuthShell } from '@/components/layout/auth-shell';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { api, ApiError } from '@/lib/api';
import { useForm } from '@/lib/form';
import { forgotPasswordBackTarget } from '@/lib/auth-flow';
import { appIntentHref } from '@/components/app-handoff';

/**
 * Request a password-reset link. User-facing: the reset email opens the CampusCare app (or the
 * user-facing /reset-password page). Only when opened from the Super Admin sign-in (?from=admin)
 * does it link back there.
 */
export default function ForgotPasswordPage() {
  const back = forgotPasswordBackTarget(useSearchParams().get('from'));
  const turnstile = React.useRef<TurnstileHandle>(null);
  const [result, setResult] = React.useState<{ message: string; expiresInMinutes?: number } | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const form = useForm(forgotPasswordSchema, { email: '' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.submitting) return;
    setProblem(null);
    await form.submit(async (data) => {
      try {
        // Same answer whether or not the address has an account.
        setResult(await api.post<{ message: string; expiresInMinutes?: number }>('/auth/forgot-password', data));
      } catch (err) {
        // e.g. email_unavailable: email cannot be sent right now. Never shown as "sent".
        if (err instanceof ApiError) setProblem(err.message);
        throw err;
      } finally {
        turnstile.current?.reset();
      }
    }, { toastErrors: false });
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your registered email and we’ll send you a secure reset link." footer={back === 'admin'
      ? <Link href="/login" className="font-semibold text-brand-700 hover:underline">Back to sign in</Link>
      : <a href={appIntentHref()} className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline"><Smartphone className="h-4 w-4" aria-hidden /> Back to the CampusCare app</a>}>
      {result ? (
        <div className="card flex flex-col items-center p-8 text-center" role="status">
          <MailCheck className="h-12 w-12 text-brand-600" aria-hidden />
          <p className="mt-4 text-sm text-ink">{result.message}</p>
          <p className="mt-2 text-xs text-ink-soft">The link expires in {result.expiresInMinutes ?? 30} minutes and can be used once. Only the newest link works.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {problem && <Alert tone="rose"><span role="alert">{problem}</span></Alert>}
          <Field id="email" label="Email address" error={form.errors.email}><Input type="email" autoComplete="email" {...form.bind('email')} /></Field>
          <Turnstile ref={turnstile} form="forgotPassword" onToken={(t) => form.set('turnstileToken', t)} />
          <Button type="submit" size="lg" className="w-full" loading={form.submitting} disabled={form.submitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
