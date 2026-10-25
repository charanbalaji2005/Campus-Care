'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { resetPasswordSchema } from '@campuscare/shared';
import { AuthShell } from '@/components/layout/auth-shell';
import { Alert, Button, Field, Input, Skeleton } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { api } from '@/lib/api';
import { useForm } from '@/lib/form';
import { AppHandoff } from '@/components/app-handoff';

export default function ResetPasswordPage() {
  const [done, setDone] = React.useState(false);
  const token = useSearchParams().get('token') ?? '';
  const turnstile = React.useRef<TurnstileHandle>(null);
  const [valid, setValid] = React.useState<boolean | null>(null);
  const form = useForm(resetPasswordSchema, { token, password: '', confirmPassword: '' });

  React.useEffect(() => {
    if (!token) { setValid(false); return; }
    api.post<{ valid: boolean }>('/auth/reset-password/check', { token }).then((r) => setValid(r.valid)).catch(() => setValid(false));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit(async (data) => {
      try {
        await api.post('/auth/reset-password', data);
        setDone(true);
      } finally {
        turnstile.current?.reset();
      }
    });
  }

  if (done) {
    return (
      <AuthShell title="All set" subtitle="Your password was changed and other sessions were signed out. Sign in again with your new password.">
        <AppHandoff path="/login" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="All other sessions will be signed out." footer={<Link href="/login" className="font-semibold text-brand-700 hover:underline">Back to sign in</Link>}>
      {valid === null && <Skeleton className="h-40" />}
      {valid === false && (
        <Alert tone="rose" title="This link can’t be used">
          It is invalid, expired or already used. <Link href="/forgot-password" className="font-semibold underline">Request a new link</Link>.
        </Alert>
      )}
      {valid && (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="password" label="New password" error={form.errors.password} hint="At least 10 characters with upper and lower case letters and a number."><Input type="password" autoComplete="new-password" {...form.bind('password')} /></Field>
          <Field id="confirmPassword" label="Confirm new password" error={form.errors.confirmPassword}><Input type="password" autoComplete="new-password" {...form.bind('confirmPassword')} /></Field>
          <Turnstile ref={turnstile} form="resetPassword" onToken={(t) => form.set('turnstileToken', t)} />
          <Button type="submit" size="lg" className="w-full" loading={form.submitting}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
