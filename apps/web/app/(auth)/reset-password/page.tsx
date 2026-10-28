'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { resetPasswordSchema } from '@campuscare/shared';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button, Field, Input, Skeleton } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { api, ApiError } from '@/lib/api';
import { useForm } from '@/lib/form';
import { usePublicSettings } from '@/lib/hooks';
import { AppHandoff } from '@/components/app-handoff';
import { rememberOutcome, resetErrorPath } from '@/lib/auth-flow';

type LinkState = 'valid' | 'expired' | 'used' | 'invalid';

function PasswordInput({ id, show, onToggle, ...props }: { id: string; show: boolean; onToggle: () => void } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" className="pr-10" {...props} />
      <button type="button" onClick={onToggle} className="absolute right-3 top-3 text-ink-soft hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'} aria-controls={id}>
        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}

/**
 * Landing page for password-reset links when the CampusCare app did not open them (no app on this
 * device, or a computer). It is user-facing only: it offers to continue in the app first, keeps a
 * browser form as a fallback, and never leads to the Super Admin sign-in or console.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const { data: settings } = usePublicSettings();
  const minLength = settings?.passwordMinLength ?? 10;
  const turnstile = React.useRef<TurnstileHandle>(null);
  const [link, setLink] = React.useState<LinkState | null>(null);
  const [show, setShow] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const form = useForm(resetPasswordSchema, { token, password: '', confirmPassword: '' });

  // Read-only check: opening this page never uses up the link. Only "Update password" does.
  React.useEffect(() => {
    if (!token) { router.replace(resetErrorPath('invalid')); return; }
    api.get<{ valid: boolean; state?: LinkState }>(`/auth/reset-password/check?token=${encodeURIComponent(token.trim())}`)
      .then((r) => {
        const state = r.state ?? (r.valid ? 'valid' : 'invalid');
        if (state === 'valid') setLink('valid');
        else router.replace(resetErrorPath(state));
      })
      .catch(() => router.replace(resetErrorPath('invalid')));
  }, [token, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.submitting) return;
    if (String(form.values.password ?? '').length < minLength) {
      form.setErrors({ password: `Use at least ${minLength} characters` });
      return;
    }
    await form.submit(async (data) => {
      try {
        await api.post('/auth/reset-password', data);
        // Success is shown only now, after the server confirmed the change.
        rememberOutcome('password_reset');
        router.replace('/reset-password-success');
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'expired_token' || err.code === 'invalid_token')) {
          router.replace(resetErrorPath(err.code === 'expired_token' ? 'expired' : 'used'));
          return;
        }
        throw err;
      } finally {
        turnstile.current?.reset();
      }
    });
  }

  return (
    <AuthShell title="Choose a new password" subtitle="All other sessions will be signed out.">
      {link === null && <Skeleton className="h-40" />}
      {link === 'valid' && (
        <div className="mb-6">
          <AppHandoff
            path={`/reset-password?token=${encodeURIComponent(token.trim())}`}
            title="Reset your password in the app"
            message="CampusCare opens on its reset screen with this link. No app on this device? You can also set the new password below."
          />
        </div>
      )}
      {link === 'valid' && (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="password" label="New password" error={form.errors.password} hint={`At least ${minLength} characters with upper and lower case letters and a number.`}>
            <PasswordInput id="password" show={show} onToggle={() => setShow(!show)} {...form.bind('password')} />
          </Field>
          <Field id="confirmPassword" label="Confirm new password" error={form.errors.confirmPassword}>
            <PasswordInput id="confirmPassword" show={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} {...form.bind('confirmPassword')} />
          </Field>
          <Turnstile ref={turnstile} form="resetPassword" onToken={(t) => form.set('turnstileToken', t)} />
          <Button type="submit" size="lg" className="w-full" loading={form.submitting} disabled={form.submitting}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
