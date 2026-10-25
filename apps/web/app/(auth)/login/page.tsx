'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock, Mail, ArrowRight } from 'lucide-react';
import { loginSchema } from '@campuscare/shared';
import { AuthShell } from '@/components/layout/auth-shell';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { api, ApiError } from '@/lib/api';
import { useForm } from '@/lib/form';
import { usePublicSettings } from '@/lib/hooks';
import { AppHandoff } from '@/components/app-handoff';

const OAUTH_ERRORS: Record<string, string> = {
  google_unavailable: 'Google sign-in is not configured.',
  oauth_state: 'Your sign-in attempt expired. Please try again.',
  oauth_cancelled: 'Google sign-in was cancelled.',
  oauth_failed: 'We could not verify your Google account. Please try again.',
  google_email_unverified: 'Your Google email address is not verified.',
  domain_not_allowed: 'Use your university Google account.',
  google_link_required: 'An account already exists for this email. Sign in with your password, then link Google from Account security.',
  google_linked_elsewhere: 'That Google account is linked to a different CampusCare account.',
  account_suspended: 'This account has been suspended.',
  account_inactive: 'This account is not active yet.',
  registration_closed: 'Student registration is currently closed.',
  session_expired: 'Please sign in again.',
  use_app: 'Students and staff sign in with the CampusCare app. This website is for the Super Admin only.',
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12Z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: settings } = usePublicSettings();
  const turnstile = React.useRef<TurnstileHandle>(null);
  const [show, setShow] = React.useState(false);
  const [mfaStep, setMfaStep] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: 'rose' | 'amber' | 'brand'; text: string; resend?: boolean; app?: boolean } | null>(
    params.get('error') ? { tone: params.get('error') === 'use_app' ? 'amber' : 'rose', text: OAUTH_ERRORS[params.get('error')!] ?? 'Sign-in failed.', app: params.get('error') === 'use_app' } : params.get('reset') ? { tone: 'brand', text: 'Password updated. Sign in with your new password.' } : null,
  );
  const form = useForm(loginSchema, { email: '', password: '', rememberMe: true });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit(async (data) => {
      try {
        const r = await api.post<{ mfaRequired?: boolean; redirectTo?: string }>('/auth/login', { ...data, mfaCode: data.mfaCode || undefined });
        if (r.mfaRequired) { setMfaStep(true); return; }
        const next = params.get('next');
        router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : r.redirectTo ?? '/');
      } catch (err) {
        turnstile.current?.reset();
        if (err instanceof ApiError && err.code === 'email_not_verified') {
          setNotice({ tone: 'amber', text: err.message, resend: true });
          return;
        }
        if (err instanceof ApiError && err.code === 'use_app') {
          setNotice({ tone: 'amber', text: err.message, app: true });
          return;
        }
        if (err instanceof ApiError) setNotice({ tone: 'rose', text: err.message });
        throw err;
      }
    }, { toastErrors: false });
  }

  async function resend() {
    try {
      await api.post('/auth/resend-verification', { email: form.values.email, turnstileToken: form.values.turnstileToken });
      setNotice({ tone: 'brand', text: 'If your account needs verification, a new link is on its way.' });
    } catch (err) {
      setNotice({ tone: 'rose', text: err instanceof ApiError ? err.message : 'Could not send.' });
    }
  }

  return (
    <AuthShell
      title={mfaStep ? 'Two-step verification' : 'Super Admin sign in'}
      subtitle={mfaStep ? 'Enter the 6-digit code from your authenticator app.' : 'The CampusCare website is the Super Admin control centre.'}
      footer={<>Student or staff member? <Link href="/" className="font-semibold text-brand-700 hover:underline">Get the CampusCare app</Link></>}
    >
      {notice && (
        <Alert tone={notice.tone} className="mb-5">
          {notice.text}
          {notice.resend && <button type="button" onClick={resend} className="ml-1 font-semibold underline">Resend verification email</button>}
        </Alert>
      )}
      {notice?.app && <div className="mb-5"><AppHandoff path="/login" showAdminLink={false} /></div>}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {!mfaStep ? (
          <>
            <Field id="email" label="University email" error={form.errors.email}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink-soft" aria-hidden />
                <Input type="email" autoComplete="email" inputMode="email" placeholder="admin@srmap.edu.in" className="pl-10" {...form.bind('email')} />
              </div>
            </Field>
            <Field id="password" label="Password" error={form.errors.password}>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink-soft" aria-hidden />
                <Input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" className="px-10" {...form.bind('password')} />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-ink-soft hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </Field>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" className="h-4 w-4 rounded border-line accent-brand-600" checked={Boolean(form.values.rememberMe)} onChange={(e) => form.set('rememberMe', e.target.checked)} />
                Remember me
              </label>
              <Link href="/forgot-password" className="text-sm font-semibold text-brand-700 hover:underline">Forgot password?</Link>
            </div>
          </>
        ) : (
          <Field id="mfaCode" label="Authentication code" error={form.errors.mfaCode}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus className="text-center text-lg tracking-[0.5em]" value={String(form.values.mfaCode ?? '')} onChange={(e) => form.set('mfaCode', e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        <Turnstile ref={turnstile} form="login" onToken={(t) => form.set('turnstileToken', t)} />
        <Button type="submit" size="lg" className="w-full" loading={form.submitting}>{mfaStep ? 'Verify' : 'Sign in'} <ArrowRight className="h-4 w-4" /></Button>
      </form>

      {!mfaStep && settings?.googleSignInEnabled && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-ink-soft"><div className="h-px flex-1 bg-line" />or continue with<div className="h-px flex-1 bg-line" /></div>
          <Button variant="outline" size="lg" className="w-full" asChild>
            <a href="/api/v1/auth/google"><GoogleIcon /> Continue with Google</a>
          </Button>
        </>
      )}
      <p className="mt-6 text-center text-xs text-ink-soft">Two-step verification is required. Every action in the console is recorded in the tamper-evident audit log.</p>
    </AuthShell>
  );
}
