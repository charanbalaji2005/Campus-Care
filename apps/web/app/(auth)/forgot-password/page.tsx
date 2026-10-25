'use client';

import * as React from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { forgotPasswordSchema } from '@campuscare/shared';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { api } from '@/lib/api';
import { useForm } from '@/lib/form';

export default function ForgotPasswordPage() {
  const turnstile = React.useRef<TurnstileHandle>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const form = useForm(forgotPasswordSchema, { email: '' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit(async (data) => {
      try {
        const r = await api.post<{ message: string }>('/auth/forgot-password', data);
        setMessage(r.message);
      } finally {
        turnstile.current?.reset();
      }
    });
  }

  return (
    <AuthShell title="Reset your password" subtitle="Enter your registered email and we’ll send you a secure reset link." footer={<Link href="/login" className="font-semibold text-brand-700 hover:underline">Back to sign in</Link>}>
      {message ? (
        <div className="card flex flex-col items-center p-8 text-center" role="status">
          <MailCheck className="h-12 w-12 text-brand-600" />
          <p className="mt-4 text-sm text-ink">{message}</p>
          <p className="mt-2 text-xs text-ink-soft">The link expires in 30 minutes and can be used once.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="email" label="Email address" error={form.errors.email}><Input type="email" autoComplete="email" {...form.bind('email')} /></Field>
          <Turnstile ref={turnstile} form="forgotPassword" onToken={(t) => form.set('turnstileToken', t)} />
          <Button type="submit" size="lg" className="w-full" loading={form.submitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
